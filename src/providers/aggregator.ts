import { CatalogResponse, UnifiedFixture, SportFacet } from "../types/catalog.types";
import { StreamResponse, UnifiedStream } from "../types/stream.types";
import { decodeCncRawId } from "../types/upstream.types";
import { UpstreamClient } from "./upstream-client";
import { Normalizer } from "../core/normalizer";
import { StreamDeduplicator } from "../core/deduplicator";
import { HlsInspector } from "../core/hls-inspector";
import { DrmDetector } from "../core/drm";

interface FixtureIndexEntry {
  fixture: UnifiedFixture;
  expiresAt: number;
}

export class Aggregator {
  public static CATALOG_DEFINITIONS = [
    { key: "sportzx", id: "cnc_SportzXLiveEvents_tv", name: "SportzX" },
    { key: "playztv", id: "cnc_PlayZTVLiveEvents_tv", name: "PlayZ TV" },
    { key: "livxow", id: "cnc_LivXowLiveEvents_tv", name: "LivXow" },
    { key: "sktech", id: "cnc_SKTechLiveEvents_tv", name: "SKTech" },
    { key: "playfy", id: "cnc_PlayFyLiveEvents_tv", name: "PlayFy" },
    { key: "cricify", id: "cnc_CricifyLiveEvents_tv", name: "Cricify" },
  ];

  // Bounded in-memory catalog index mapping identifier -> UnifiedFixture with TTL
  private static fixtureIndex = new Map<string, FixtureIndexEntry>();
  private static MAX_INDEX_ENTRIES = 2000;

  // Cached last good catalog to serve during upstream 503 maintenance
  private static lastGoodCatalogResponse: CatalogResponse | null = null;

  private static indexFixture(key: string, fixture: UnifiedFixture, ttlMs = 3600_000): void {
    if (this.fixtureIndex.size >= this.MAX_INDEX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.fixtureIndex.entries()) {
        if (v.expiresAt <= now) {
          this.fixtureIndex.delete(k);
        }
      }
      if (this.fixtureIndex.size >= this.MAX_INDEX_ENTRIES) {
        const oldestKey = this.fixtureIndex.keys().next().value;
        if (oldestKey) this.fixtureIndex.delete(oldestKey);
      }
    }

    this.fixtureIndex.set(key, {
      fixture,
      expiresAt: Date.now() + ttlMs,
    });
  }

  private static getFixtureFromIndex(key: string): UnifiedFixture | null {
    const entry = this.fixtureIndex.get(key);
    if (!entry) return null;
    if (Date.now() < entry.expiresAt) {
      // Re-insert to provide genuine LRU order
      this.fixtureIndex.delete(key);
      this.fixtureIndex.set(key, entry);
      return entry.fixture;
    }
    this.fixtureIndex.delete(key);
    return null;
  }

  /**
   * Fetches all 6 catalogs concurrently with fast-failover & coalescing,
   * cascades rich metadata, and returns a unified catalog.
   */
  static async getUnifiedCatalog(
    sportFilter?: string,
    phaseFilter?: string,
    searchQuery?: string
  ): Promise<CatalogResponse> {
    const startTime = Date.now();

    // Query all 6 catalogs concurrently via resilient UpstreamClient
    const results = await Promise.allSettled(
      this.CATALOG_DEFINITIONS.map(async (def) => {
        const items = await UpstreamClient.fetchCatalog(def.id);
        return { def, items };
      })
    );

    // Group items by canonical fixture key
    const groupedCandidates = new Map<string, any[]>();

    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const { def, items } = res.value;

      for (const item of items) {
        const rawId = item.id || "";
        const name = item.name || "";
        const decoded = decodeCncRawId(rawId);
        const payload = decoded.data || {};
        const eventInfo = payload.eventInfo || {};
        const poster = item.poster || payload.poster;

        const rawSport = eventInfo.eventCat || payload.category || payload.cat || "";
        const canonicalKey = Normalizer.computeCanonicalKey(name, rawSport, eventInfo, poster);

        const candidateEntry = {
          providerKey: def.key,
          rawId,
          name,
          sport: rawSport,
          eventInfo,
          poster,
          formats: payload.formats,
        };

        const existing = groupedCandidates.get(canonicalKey) || [];
        existing.push(candidateEntry);
        groupedCandidates.set(canonicalKey, existing);
      }
    }

    // Reconcile 'nodate' keys into an existing dated key for the same match
    for (const [key, candidates] of Array.from(groupedCandidates.entries())) {
      if (key.endsWith("::nodate")) {
        const prefix = key.slice(0, -8);
        for (const [otherKey, otherCandidates] of groupedCandidates.entries()) {
          if (
            otherKey !== key &&
            otherKey.startsWith(`${prefix}::`) &&
            !otherKey.endsWith("::nodate")
          ) {
            otherCandidates.push(...candidates);
            groupedCandidates.delete(key);
            break;
          }
        }
      }
    }

    // Reconcile near-date keys crossing UTC midnight (within 4 hours)
    // Only reconcile if sport, teams, AND discriminators (format, stage, match #) match identically!
    for (const [key, candidates] of Array.from(groupedCandidates.entries())) {
      const dateMatch = key.match(/(.*?)::(\d{4}-\d{2}-\d{2}|nodate)(::s\d)?$/);
      if (dateMatch && dateMatch[2] !== "nodate") {
        const prefix = dateMatch[1];
        for (const [otherKey, otherCandidates] of groupedCandidates.entries()) {
          const otherDateMatch = otherKey.match(/(.*?)::(\d{4}-\d{2}-\d{2}|nodate)(::s\d)?$/);
          if (
            otherKey !== key &&
            otherDateMatch &&
            otherDateMatch[1] === prefix &&
            otherDateMatch[2] !== "nodate"
          ) {
            const t1 = new Date(candidates[0]?.eventInfo?.startTime || dateMatch[2]).getTime();
            const t2 = new Date(
              otherCandidates[0]?.eventInfo?.startTime || otherDateMatch[2]
            ).getTime();
            if (!isNaN(t1) && !isNaN(t2) && Math.abs(t1 - t2) <= 4 * 3600 * 1000) {
              otherCandidates.push(...candidates);
              groupedCandidates.delete(key);
              break;
            }
          }
        }
      }
    }

    // Cascade each grouped cluster into a UnifiedFixture
    const unifiedFixturesMap = new Map<string, UnifiedFixture>();

    for (const [canonicalKey, candidates] of groupedCandidates.entries()) {
      const fixture = Normalizer.cascadeFixture(canonicalKey, candidates);

      const existing = unifiedFixturesMap.get(fixture.canonicalKey);
      if (existing) {
        // Merge providerPointers and streams
        Object.assign(existing.providerPointers, fixture.providerPointers);
        if (fixture.phase === "live") existing.phase = "live";
        // Update in-memory index
        this.indexFixture(fixture.fixtureId, existing);
        this.indexFixture(fixture.canonicalKey, existing);
      } else {
        unifiedFixturesMap.set(fixture.canonicalKey, fixture);
        this.indexFixture(fixture.fixtureId, fixture);
        this.indexFixture(fixture.canonicalKey, fixture);
      }
    }

    const allFixtures: UnifiedFixture[] = Array.from(unifiedFixturesMap.values());
    const sportCounts = new Map<string, { total: number; live: number }>();
    let globalTotalLive = 0;
    let globalTotalUpcoming = 0;

    for (const fixture of allFixtures) {
      // Aggregate global facet statistics for active (non-ended) matches
      const sp = fixture.sportCategory;
      const current = sportCounts.get(sp) || { total: 0, live: 0 };
      if (fixture.phase !== "ended") {
        current.total += 1;
        if (fixture.phase === "live") {
          current.live += 1;
          globalTotalLive += 1;
        } else {
          globalTotalUpcoming += 1;
        }
      }
      sportCounts.set(sp, current);
    }

    // Filter fixtures based on query parameters
    let filteredFixtures = allFixtures;
    if (sportFilter && sportFilter.toLowerCase() !== "all") {
      filteredFixtures = filteredFixtures.filter(
        (f) => f.sportCategory.toLowerCase() === sportFilter.toLowerCase()
      );
    }
    // Default phase filtering: active matches only (live + upcoming), exclude ended matches
    if (!phaseFilter || phaseFilter.toLowerCase() === "active") {
      filteredFixtures = filteredFixtures.filter((f) => f.phase !== "ended");
    } else if (phaseFilter.toLowerCase() !== "all") {
      filteredFixtures = filteredFixtures.filter(
        (f) => f.phase.toLowerCase() === phaseFilter.toLowerCase()
      );
    }

    // Full-text tokenized search across teams, titles, leagues, sports, and broadcasters
    if (searchQuery && searchQuery.trim().length > 0) {
      const tokens = searchQuery
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      filteredFixtures = filteredFixtures.filter((f) => {
        const homeName = (f.teams?.home?.name || "").toLowerCase();
        const awayName = (f.teams?.away?.name || "").toLowerCase();
        const title = (f.title || "").toLowerCase();
        const tournamentName = (f.tournament?.name || "").toLowerCase();
        const sportCat = (f.sportCategory || "").toLowerCase();
        const broadcasters = (f.streamMetadata?.primaryBroadcasters || []).map((b) =>
          b.toLowerCase()
        );

        return tokens.every((token) => {
          return (
            title.includes(token) ||
            homeName.includes(token) ||
            awayName.includes(token) ||
            tournamentName.includes(token) ||
            sportCat.includes(token) ||
            broadcasters.some((b) => b.includes(token))
          );
        });
      });
    }

    // Sort: Live first, then upcoming by start time
    filteredFixtures.sort((a, b) => {
      if (a.phase === "live" && b.phase !== "live") return -1;
      if (a.phase !== "live" && b.phase === "live") return 1;
      return (
        new Date(a.schedule.startTimeUtc).getTime() - new Date(b.schedule.startTimeUtc).getTime()
      );
    });

    // Build sport facets based on GLOBAL active counts
    const totalActiveCount = globalTotalLive + globalTotalUpcoming;
    const sportFacets: SportFacet[] = [
      { id: "all", label: "All Sports", icon: "🌐", liveCount: globalTotalLive, totalCount: totalActiveCount },
      { id: "cricket", label: "Cricket", icon: "🏏", liveCount: 0, totalCount: 0 },
      { id: "football", label: "Football", icon: "⚽", liveCount: 0, totalCount: 0 },
      { id: "motorsport", label: "Motorsport", icon: "🏎️", liveCount: 0, totalCount: 0 },
      { id: "combat", label: "Combat Sports", icon: "🥊", liveCount: 0, totalCount: 0 },
      { id: "tennis", label: "Tennis", icon: "🎾", liveCount: 0, totalCount: 0 },
      { id: "basketball", label: "Basketball", icon: "🏀", liveCount: 0, totalCount: 0 },
      { id: "hockey", label: "Ice Hockey", icon: "🏒", liveCount: 0, totalCount: 0 },
      { id: "american_football", label: "American Football", icon: "🏈", liveCount: 0, totalCount: 0 },
      { id: "rugby", label: "Rugby", icon: "🏉", liveCount: 0, totalCount: 0 },
      { id: "table_tennis", label: "Table Tennis", icon: "🏓", liveCount: 0, totalCount: 0 },
      { id: "volleyball", label: "Volleyball", icon: "🏐", liveCount: 0, totalCount: 0 },
      { id: "golf", label: "Golf", icon: "⛳", liveCount: 0, totalCount: 0 },
      { id: "athletics", label: "Athletics", icon: "🏃", liveCount: 0, totalCount: 0 },
      { id: "badminton", label: "Badminton", icon: "🏸", liveCount: 0, totalCount: 0 },
      { id: "kabaddi", label: "Kabaddi", icon: "🤼", liveCount: 0, totalCount: 0 },
      { id: "darts", label: "Darts", icon: "🎯", liveCount: 0, totalCount: 0 },
      { id: "snooker", label: "Snooker", icon: "🎱", liveCount: 0, totalCount: 0 },
      { id: "cycling", label: "Cycling", icon: "🚴", liveCount: 0, totalCount: 0 },
    ].map((f) => {
      if (f.id === "all") return f;
      const stats = sportCounts.get(f.id) || { total: 0, live: 0 };
      return {
        ...f,
        totalCount: stats.total,
        liveCount: stats.live,
      };
    });

    // If upstream failed or returned 0 fixtures (e.g. upstream 503 maintenance)
    // and we have a previous successful catalog in memory, gracefully serve it
    if (allFixtures.length === 0 && this.lastGoodCatalogResponse) {
      return {
        ...this.lastGoodCatalogResponse,
        edge: {
          ...this.lastGoodCatalogResponse.edge,
          cacheControl: "stale-fallback; upstream-maintenance",
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    const response: CatalogResponse = {
      status: "success",
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      edge: {
        region: "BOM",
        cacheControl: "public, max-age=15, stale-while-revalidate=30",
        executionTimeMs: Date.now() - startTime,
      },
      facets: {
        activeSportFilter: sportFilter || "all",
        activePhaseFilter: phaseFilter || "all",
        sports: sportFacets,
        totalLiveMatches: globalTotalLive,
        totalUpcomingMatches: globalTotalUpcoming,
      },
      fixtures: filteredFixtures,
    };

    if (allFixtures.length > 0 && !sportFilter && !phaseFilter) {
      this.lastGoodCatalogResponse = response;
    }

    return response;
  }

  /**
   * Returns sports list and live match counts for the Explore screen.
   */
  static async getSportsSummary(): Promise<{
    status: "success";
    sports: SportFacet[];
    totalLiveMatches: number;
    totalUpcomingMatches: number;
  }> {
    const catalog = await this.getUnifiedCatalog();
    return {
      status: "success",
      sports: catalog.facets.sports,
      totalLiveMatches: catalog.facets.totalLiveMatches,
      totalUpcomingMatches: catalog.facets.totalUpcomingMatches,
    };
  }

  /**
   * Resolves, deduplicates, and extracts renditions for a fixture across all 6 providers.
   */
  static async getUnifiedStreams(
    identifier: string,
    queryPointers?: Record<string, string>
  ): Promise<StreamResponse> {
    // 1. Resolve fixture pointers from bounded index
    let pointers = queryPointers;
    let canonicalKey = identifier;

    if (!pointers || Object.keys(pointers).length === 0) {
      const cached = this.getFixtureFromIndex(identifier);
      if (cached) {
        pointers = cached.providerPointers;
        canonicalKey = cached.canonicalKey;
      }
    }

    // If still no pointers, perform an initial catalog refresh to populate pointers
    if (!pointers || Object.keys(pointers).length === 0) {
      await this.getUnifiedCatalog();
      const cached = this.getFixtureFromIndex(identifier);
      if (cached) {
        pointers = cached.providerPointers;
        canonicalKey = cached.canonicalKey;
      }
    }

    // 2. Concurrently fetch streams from all provider pointers via UpstreamClient
    const pointerEntries = Object.entries(pointers || {});
    const rawStreamsList: any[] = [];

    const streamResults = await Promise.allSettled(
      pointerEntries.map(async ([providerKey, rawId]) => {
        const streams = await UpstreamClient.fetchStreams(rawId);
        return streams.map((s) => ({ ...s, providerKey }));
      })
    );

    for (const res of streamResults) {
      if (res.status === "fulfilled") {
        rawStreamsList.push(...res.value);
      }
    }

    // 3. Deduplicate across providers with lossless quality preservation and transparent audit
    const { streams: deduplicatedStreams, audit } =
      StreamDeduplicator.deduplicateWithAudit(rawStreamsList);

    // 4. Inspect DRM configuration for all streams
    for (const stream of deduplicatedStreams) {
      const drm = DrmDetector.detectDrm(
        `${stream.channelName} ${stream.network.masterPlaylistUrl}`
      );
      if (drm && !stream.drm) {
        stream.drm = drm;
      }
    }

    // 5. Pre-parse HLS Master Playlists for the top streams
    await Promise.allSettled(
      deduplicatedStreams.slice(0, 4).map(async (stream) => {
        if (stream.protocol === "hls") {
          const renditions = await HlsInspector.inspectStream(
            stream.network.masterPlaylistUrl,
            stream.network.requiredHeaders
          );
          if (renditions.length > 1) {
            stream.hasPreParsedRenditions = true;
            stream.renditions = renditions;
          }
        }
      })
    );

    return {
      status: "success",
      apiVersion: "2.1.0",
      fixtureId: identifier,
      canonicalKey,
      generatedAt: new Date().toISOString(),
      edge: {
        region: "BOM",
        cached: true,
        ttlSeconds: 30,
      },
      summary: {
        totalProvidersQueried: pointerEntries.length,
        totalRawStreamsFound: rawStreamsList.length,
        deduplicatedStreamsCount: deduplicatedStreams.length,
        recommendedDefaultStreamId: deduplicatedStreams[0]?.streamId || "",
        audit,
      },
      streams: deduplicatedStreams,
    };
  }

  /**
   * Retrieves a single fixture by fixtureId or canonicalKey.
   */
  static async getFixtureById(idOrCanonicalKey: string): Promise<UnifiedFixture | null> {
    const cleanKey = idOrCanonicalKey.trim();
    let fixture = this.getFixtureFromIndex(cleanKey);
    if (fixture) return fixture;

    if (cleanKey.startsWith("fixture:")) {
      fixture = this.getFixtureFromIndex(cleanKey.replace(/^fixture:/, ""));
      if (fixture) return fixture;
    } else {
      fixture = this.getFixtureFromIndex(`fixture:${cleanKey}`);
      if (fixture) return fixture;
    }

    const catalog = await this.getUnifiedCatalog();
    return (
      catalog.fixtures.find(
        (f) =>
          f.fixtureId === cleanKey ||
          f.canonicalKey === cleanKey ||
          f.canonicalKey === `fixture:${cleanKey}` ||
          f.fixtureId === cleanKey.replace(/^fixture:/, "")
      ) || null
    );
  }
}

import {
  CatalogResponse,
  CatalogQueryOptions,
  UnifiedFixture,
  SportFacet,
  ReconciliationSummary,
  CompetitionSummary,
  CompetitionsResponse,
  CompetitionDetailResponse,
  SearchEntityResult,
} from "../types/catalog.types";
import { StreamResponse, StreamFilterOptions, UnifiedStream } from "../types/stream.types";
import { decodeCncRawId } from "../types/upstream.types";
import { UpstreamClient } from "./upstream-client";
import { Normalizer } from "../core/normalizer";
import { EventIdentityEngine } from "../core/event-identity";
import { StreamDeduplicator } from "../core/deduplicator";
import { HlsInspector } from "../core/hls-inspector";
import { DrmDetector } from "../core/drm";
import { EdgeCache } from "../core/cache";

interface FixtureIndexEntry {
  fixture: UnifiedFixture;
  expiresAt: number;
}

interface BaseCatalogSnapshot {
  generation: number;
  createdAt: number;
  allFixtures: UnifiedFixture[];
  sportFacets: SportFacet[];
  globalTotalLive: number;
  globalTotalUpcoming: number;
  globalTotalEnded: number;
  reconciliation: ReconciliationSummary;
  providerItemCounts: Record<string, number>;
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

  private static SPORT_FILTER_ALIASES: Record<string, string> = {
    soccer: "football",
    epl: "football",
    ucl: "football",
    mma: "combat",
    ufc: "combat",
    boxing: "combat",
    wwe: "combat",
    wrestling: "combat",
    f1: "motorsport",
    formula1: "motorsport",
    motogp: "motorsport",
    nba: "basketball",
    nhl: "hockey",
    ice_hockey: "hockey",
    icehockey: "hockey",
    nfl: "american_football",
    americanfootball: "american_football",
    pingpong: "table_tennis",
    tabletennis: "table_tennis",
  };

  // Bounded in-memory catalog index mapping identifier -> UnifiedFixture with TTL
  private static fixtureIndex = new Map<string, FixtureIndexEntry>();
  private static MAX_INDEX_ENTRIES = 2500;

  // Cached last good catalog to serve during upstream 503 maintenance
  private static lastGoodCatalogResponse: CatalogResponse | null = null;
  private static baseCatalogSnapshot: BaseCatalogSnapshot | null = null;
  private static inFlightCatalogBuild: Promise<BaseCatalogSnapshot | null> | null = null;
  private static BASE_SNAPSHOT_TTL_MS = 8_000;

  private static indexFixture(key: string, fixture: UnifiedFixture, ttlMs = 3600_000): void {
    if (this.fixtureIndex.size >= this.MAX_INDEX_ENTRIES && !this.fixtureIndex.has(key)) {
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

  static resolveSportCategoryFilter(sport?: string): string | undefined {
    if (!sport) return undefined;
    const clean = sport.trim().toLowerCase();
    if (!clean || clean === "all") return "all";
    return this.SPORT_FILTER_ALIASES[clean] || clean;
  }

  /**
   * Parses a match canonical key into its structural parts for multi-signal reconciliation.
   */
  private static parseMatchKeyParts(key: string, candidates: any[]) {
    if (
      key.endsWith("::channel") ||
      key.endsWith("::tournament") ||
      key.endsWith("::show")
    ) {
      return null;
    }
    const parts = key.split("::");
    if (parts.length < 4) return null;

    const sport = parts[0];
    const team1 = parts[1];
    const team2 = parts[2];
    const teamPair = `${team1}::${team2}`;

    const lastPart = parts[parts.length - 1];
    const hasSession = /^s\d$/.test(lastPart);
    const dateIdx = hasSession ? parts.length - 2 : parts.length - 1;
    const dateYmd = parts[dateIdx];
    const discParts = parts.slice(3, dateIdx);

    // Compute representative start time in ms
    let startTimeMs = NaN;
    for (const c of candidates) {
      const rawTime =
        c.eventInfo?.startTime ||
        Normalizer.extractParamsFromPosterUrl(c.poster).time;
      if (rawTime) {
        const t = new Date(Normalizer.parseDateTimeIso(rawTime)).getTime();
        if (!isNaN(t)) {
          startTimeMs = t;
          break;
        }
      }
    }
    if (isNaN(startTimeMs) && dateYmd !== "nodate") {
      startTimeMs = new Date(`${dateYmd}T00:00:00Z`).getTime();
    }

    const combinedText = candidates
      .map(
        (c) =>
          `${c.name || ""} ${c.eventInfo?.eventName || ""} ${c.eventInfo?.eventType || ""} ${c.sport || ""}`
      )
      .join(" ");
    const identity = EventIdentityEngine.parse(combinedText, sport);

    return {
      sport,
      team1,
      team2,
      teamPair,
      dateYmd,
      discParts,
      startTimeMs,
      identity,
    };
  }

  /**
   * Builds (or coalesces) the normalized base catalog across all 6 upstream providers.
   */
  private static async buildOrGetBaseCatalog(): Promise<BaseCatalogSnapshot | null> {
    const currentGen = EdgeCache.getGeneration();
    if (
      this.baseCatalogSnapshot &&
      this.baseCatalogSnapshot.generation === currentGen &&
      Date.now() - this.baseCatalogSnapshot.createdAt < this.BASE_SNAPSHOT_TTL_MS
    ) {
      return this.baseCatalogSnapshot;
    }

    if (this.inFlightCatalogBuild) {
      return this.inFlightCatalogBuild;
    }

    this.inFlightCatalogBuild = (async () => {
      try {
        // Query all 6 catalogs concurrently via resilient UpstreamClient
        const results = await Promise.allSettled(
          this.CATALOG_DEFINITIONS.map(async (def) => {
            const items = await UpstreamClient.fetchCatalog(def.id);
            return { def, items };
          })
        );

        const groupedCandidates = new Map<string, any[]>();
        const providerItemCounts: Record<string, number> = {};
        let healthyProvidersCount = 0;
        let totalRawItemsExtracted = 0;

        for (const res of results) {
          if (res.status !== "fulfilled") continue;
          const { def, items } = res.value;
          providerItemCounts[def.key] = items.length;
          if (items.length > 0) healthyProvidersCount += 1;
          totalRawItemsExtracted += items.length;

          for (const item of items) {
            const rawId = item.id || "";
            const name = item.name || "";
            const decoded = decodeCncRawId(rawId);
            const payload = decoded.data || {};
            const eventInfo = payload.eventInfo || {};
            const poster = item.poster || payload.poster;

            const rawSport = eventInfo.eventCat || payload.category || payload.cat || "";
            const canonicalKey = Normalizer.computeCanonicalKey(
              name,
              rawSport,
              eventInfo,
              poster
            );

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

        // Pass 1: Reconcile 'nodate' keys into an existing dated key for the same match
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

        // Pass 2: Multi-Signal Match Reconciliation across providers
        // Reconciles matches with the exact same teamPair within a 4-hour start window
        // when one provider omitted format/gender tags (e.g. SportzX "PAK vs SL" vs PlayZTV "Pakistan vs Sri Lanka" Test)
        // or when start times cross a 6-hour session boundary (e.g. 05:00Z s0 vs 06:00Z s1) or UTC midnight.
        let reconciledCrossFormatCount = 0;
        let reconciledNearTimeCount = 0;

        const matchEntries = Array.from(groupedCandidates.entries())
          .map(([key, candidates]) => ({
            key,
            candidates,
            parsed: this.parseMatchKeyParts(key, candidates),
          }))
          .filter((e): e is { key: string; candidates: any[]; parsed: NonNullable<ReturnType<typeof Aggregator.parseMatchKeyParts>> } => e.parsed !== null);

        // Sort so richer keys (more discriminators, more candidates) come first as merge targets
        matchEntries.sort(
          (a, b) =>
            b.parsed.discParts.length - a.parsed.discParts.length ||
            b.candidates.length - a.candidates.length
        );

        const mergedKeys = new Set<string>();

        for (let i = 0; i < matchEntries.length; i++) {
          const target = matchEntries[i];
          if (mergedKeys.has(target.key) || !groupedCandidates.has(target.key)) continue;

          for (let j = i + 1; j < matchEntries.length; j++) {
            const source = matchEntries[j];
            if (mergedKeys.has(source.key) || !groupedCandidates.has(source.key)) continue;

            // Must be the exact same normalized team pair
            if (target.parsed.teamPair !== source.parsed.teamPair) continue;

            // Sport must match (or one is generic fallback "football" while the other is specific "cricket" within 1h)
            const sameSport = target.parsed.sport === source.parsed.sport;
            const timeDiffMs =
              !isNaN(target.parsed.startTimeMs) && !isNaN(source.parsed.startTimeMs)
                ? Math.abs(target.parsed.startTimeMs - source.parsed.startTimeMs)
                : target.parsed.dateYmd === source.parsed.dateYmd
                ? 0
                : Infinity;

            // Must be within 4 hours of each other
            if (timeDiffMs > 4 * 3600 * 1000) continue;

            if (!sameSport) {
              // Only allow cross-sport reconciliation if within 1 hour and one was fallback football
              const isCricketVsFallback =
                timeDiffMs <= 3600 * 1000 &&
                ((target.parsed.sport === "cricket" && source.parsed.sport === "football") ||
                  (target.parsed.sport === "football" && source.parsed.sport === "cricket"));
              if (!isCricketVsFallback) continue;
            }

            // Check EventIdentity compatibility (never merge Test with T20, or 1st Test with 2nd Test, or U19 with Senior)
            if (!EventIdentityEngine.areCompatible(target.parsed.identity, source.parsed.identity)) {
              continue;
            }

            // Merge source into target
            target.candidates.push(...source.candidates);
            groupedCandidates.delete(source.key);
            mergedKeys.add(source.key);

            if (target.parsed.discParts.join("::") !== source.parsed.discParts.join("::")) {
              reconciledCrossFormatCount += 1;
            } else {
              reconciledNearTimeCount += 1;
            }
          }
        }

        // Cascade each grouped cluster into a UnifiedFixture
        const unifiedFixturesMap = new Map<string, UnifiedFixture>();

        for (const [canonicalKey, candidates] of groupedCandidates.entries()) {
          const fixture = Normalizer.cascadeFixture(canonicalKey, candidates);

          const existing = unifiedFixturesMap.get(fixture.canonicalKey);
          if (existing) {
            Object.assign(existing.providerPointers, fixture.providerPointers);
            if (fixture.providerRawIds) {
              existing.providerRawIds = existing.providerRawIds || {};
              for (const [pk, rids] of Object.entries(fixture.providerRawIds)) {
                const cur = existing.providerRawIds[pk] || [];
                for (const rid of rids) {
                  if (!cur.includes(rid)) cur.push(rid);
                }
                existing.providerRawIds[pk] = cur;
              }
            }
            existing.providerCount = Object.keys(existing.providerPointers).length;
            if (fixture.phase === "live") {
              existing.phase = "live";
              existing.schedule.status = "live";
              existing.schedule.isLive = true;
              existing.schedule.liveBadgeText = "LIVE NOW";
            }
            this.indexFixture(fixture.fixtureId, existing);
            this.indexFixture(fixture.canonicalKey, existing);
          } else {
            unifiedFixturesMap.set(fixture.canonicalKey, fixture);
            this.indexFixture(fixture.fixtureId, fixture);
            this.indexFixture(fixture.canonicalKey, fixture);
          }
        }

        const allFixtures: UnifiedFixture[] = Array.from(unifiedFixturesMap.values());
        if (allFixtures.length === 0) {
          return null;
        }

        const sportCounts = new Map<
          string,
          { total: number; live: number; upcoming: number; ended: number }
        >();
        let globalTotalLive = 0;
        let globalTotalUpcoming = 0;
        let globalTotalEnded = 0;
        let multiProviderFixturesCount = 0;
        const mappedRawIdsSet = new Set<string>();

        for (const fixture of allFixtures) {
          if (Object.keys(fixture.providerPointers).length > 1) {
            multiProviderFixturesCount += 1;
          }
          for (const rid of Object.values(fixture.providerPointers)) {
            mappedRawIdsSet.add(rid);
          }
          if (fixture.providerRawIds) {
            for (const rids of Object.values(fixture.providerRawIds)) {
              for (const rid of rids) mappedRawIdsSet.add(rid);
            }
          }

          const sp = fixture.sportCategory;
          const current = sportCounts.get(sp) || {
            total: 0,
            live: 0,
            upcoming: 0,
            ended: 0,
          };
          if (fixture.phase !== "ended") {
            current.total += 1;
            if (fixture.phase === "live") {
              current.live += 1;
              globalTotalLive += 1;
            } else {
              current.upcoming += 1;
              globalTotalUpcoming += 1;
            }
          } else {
            current.ended += 1;
            globalTotalEnded += 1;
          }
          sportCounts.set(sp, current);
        }

        const totalActiveCount = globalTotalLive + globalTotalUpcoming;
        const sportFacets: SportFacet[] = [
          {
            id: "all",
            label: "All Sports",
            icon: "🌐",
            liveCount: globalTotalLive,
            totalCount: totalActiveCount,
            upcomingCount: globalTotalUpcoming,
            endedCount: globalTotalEnded,
          },
          { id: "cricket", label: "Cricket", icon: "🏏", liveCount: 0, totalCount: 0 },
          { id: "football", label: "Football", icon: "⚽", liveCount: 0, totalCount: 0 },
          { id: "motorsport", label: "Motorsport", icon: "🏎️", liveCount: 0, totalCount: 0 },
          { id: "combat", label: "Combat Sports", icon: "🥊", liveCount: 0, totalCount: 0 },
          { id: "tennis", label: "Tennis", icon: "🎾", liveCount: 0, totalCount: 0 },
          { id: "basketball", label: "Basketball", icon: "🏀", liveCount: 0, totalCount: 0 },
          { id: "hockey", label: "Ice Hockey", icon: "🏒", liveCount: 0, totalCount: 0 },
          {
            id: "american_football",
            label: "American Football",
            icon: "🏈",
            liveCount: 0,
            totalCount: 0,
          },
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
          const stats = sportCounts.get(f.id) || {
            total: 0,
            live: 0,
            upcoming: 0,
            ended: 0,
          };
          return {
            ...f,
            totalCount: stats.total,
            liveCount: stats.live,
            upcomingCount: stats.upcoming,
            endedCount: stats.ended,
          };
        });

        const unmappedRawItemsCount = Math.max(
          0,
          totalRawItemsExtracted - mappedRawIdsSet.size
        );

        const reconciliation: ReconciliationSummary = {
          totalProvidersQueried: this.CATALOG_DEFINITIONS.length,
          healthyProvidersCount,
          totalRawItemsExtracted,
          totalUnifiedFixtures: allFixtures.length,
          activeUnifiedFixtures: totalActiveCount,
          endedUnifiedFixtures: globalTotalEnded,
          multiProviderFixturesCount,
          deduplicatedItemsMerged: Math.max(0, totalRawItemsExtracted - allFixtures.length),
          reconciledCrossFormatCount,
          reconciledNearTimeCount,
          unmappedRawItemsCount,
        };

        const snapshot: BaseCatalogSnapshot = {
          generation: currentGen,
          createdAt: Date.now(),
          allFixtures,
          sportFacets,
          globalTotalLive,
          globalTotalUpcoming,
          globalTotalEnded,
          reconciliation,
          providerItemCounts,
        };

        this.baseCatalogSnapshot = snapshot;
        return snapshot;
      } finally {
        this.inFlightCatalogBuild = null;
      }
    })();

    return this.inFlightCatalogBuild;
  }

  /**
   * Fetches all 6 catalogs concurrently with fast-failover & coalescing,
   * cascades rich metadata, and returns a unified catalog with filtering, search, sorting, and pagination.
   */
  static async getUnifiedCatalog(
    sportFilter?: string,
    phaseFilter?: string,
    searchQuery?: string,
    extraOptions?: CatalogQueryOptions
  ): Promise<CatalogResponse> {
    const startTime = Date.now();
    const snapshot = await this.buildOrGetBaseCatalog();

    // If upstream failed or returned 0 fixtures (e.g. upstream 503 maintenance)
    // and we have a previous successful catalog in memory, gracefully serve it
    if (!snapshot) {
      if (this.lastGoodCatalogResponse) {
        return {
          ...this.lastGoodCatalogResponse,
          edge: {
            ...this.lastGoodCatalogResponse.edge,
            cacheControl: "stale-fallback; upstream-maintenance",
            executionTimeMs: Date.now() - startTime,
          },
        };
      }
      return {
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
          sports: [],
          totalLiveMatches: 0,
          totalUpcomingMatches: 0,
          totalEndedMatches: 0,
        },
        fixtures: [],
      };
    }

    const resolvedSport = this.resolveSportCategoryFilter(
      sportFilter ?? extraOptions?.sport
    );
    const resolvedPhase = (phaseFilter ?? extraOptions?.phase)?.trim().toLowerCase();
    const resolvedSearch = searchQuery ?? extraOptions?.search;

    let filteredFixtures = [...snapshot.allFixtures];

    // 1. Sport filter
    if (resolvedSport && resolvedSport !== "all") {
      filteredFixtures = filteredFixtures.filter(
        (f) => f.sportCategory.toLowerCase() === resolvedSport
      );
    }

    // 2. Phase filter (default: active matches only = live + upcoming)
    if (!resolvedPhase || resolvedPhase === "active") {
      filteredFixtures = filteredFixtures.filter((f) => f.phase !== "ended");
    } else if (resolvedPhase !== "all") {
      filteredFixtures = filteredFixtures.filter(
        (f) => f.phase.toLowerCase() === resolvedPhase
      );
    }

    // 3. Kind filter (match | tournament_channel | show)
    if (extraOptions?.kind && extraOptions.kind.toLowerCase() !== "all") {
      const k = extraOptions.kind.toLowerCase();
      filteredFixtures = filteredFixtures.filter((f) => f.kind === k);
    }

    // 4. Tournament filter
    if (extraOptions?.tournament) {
      const tFilter = extraOptions.tournament.toLowerCase().trim();
      filteredFixtures = filteredFixtures.filter(
        (f) =>
          f.tournament.id.toLowerCase() === tFilter ||
          f.tournament.name.toLowerCase().includes(tFilter)
      );
    }

    // 5. Provider filter
    if (extraOptions?.provider) {
      const pFilter = extraOptions.provider.toLowerCase().trim();
      filteredFixtures = filteredFixtures.filter((f) =>
        Boolean(f.providerPointers[pFilter])
      );
    }

    // 6. Hot match filter
    if (extraOptions?.hot === true) {
      filteredFixtures = filteredFixtures.filter((f) => f.isHotMatch);
    }

    // 7. Date filter (YYYY-MM-DD)
    if (extraOptions?.date) {
      const dateStr = extraOptions.date.trim();
      filteredFixtures = filteredFixtures.filter((f) =>
        f.schedule.startTimeUtc.startsWith(dateStr)
      );
    }

    // 8. Full-text tokenized search across teams, codes, titles, leagues, sports, stage, format, and broadcasters
    if (resolvedSearch && resolvedSearch.trim().length > 0) {
      const tokens = resolvedSearch
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      filteredFixtures = filteredFixtures.filter((f) => {
        const homeName = (f.teams?.home?.name || "").toLowerCase();
        const awayName = (f.teams?.away?.name || "").toLowerCase();
        const homeCode = (f.teams?.home?.code || "").toLowerCase();
        const awayCode = (f.teams?.away?.code || "").toLowerCase();
        const title = (f.title || "").toLowerCase();
        const tournamentName = (f.tournament?.name || "").toLowerCase();
        const sportCat = (f.sportCategory || "").toLowerCase();
        const sportLabel = (f.sport || "").toLowerCase();
        const format = (f.eventDetails?.format || "").toLowerCase();
        const stage = (f.eventDetails?.stage || "").toLowerCase();
        const broadcasters = (f.streamMetadata?.primaryBroadcasters || []).map((b) =>
          b.toLowerCase()
        );

        return tokens.every((token) => {
          return (
            title.includes(token) ||
            homeName.includes(token) ||
            awayName.includes(token) ||
            homeCode === token ||
            awayCode === token ||
            tournamentName.includes(token) ||
            sportCat.includes(token) ||
            sportLabel.includes(token) ||
            format === token ||
            stage.includes(token) ||
            broadcasters.some((b) => b.includes(token))
          );
        });
      });
    }

    // 9. Sorting
    const sortMode = extraOptions?.sort || "default";
    filteredFixtures.sort((a, b) => {
      if (sortMode === "time_asc") {
        return (
          new Date(a.schedule.startTimeUtc).getTime() -
          new Date(b.schedule.startTimeUtc).getTime()
        );
      }
      if (sortMode === "time_desc") {
        return (
          new Date(b.schedule.startTimeUtc).getTime() -
          new Date(a.schedule.startTimeUtc).getTime()
        );
      }
      if (sortMode === "popularity") {
        if (a.phase === "live" && b.phase !== "live") return -1;
        if (a.phase !== "live" && b.phase === "live") return 1;
        const pDiff =
          Object.keys(b.providerPointers).length -
          Object.keys(a.providerPointers).length;
        if (pDiff !== 0) return pDiff;
        return (
          b.streamMetadata.totalWorkingFeeds - a.streamMetadata.totalWorkingFeeds
        );
      }
      if (sortMode === "title_asc") {
        return a.title.localeCompare(b.title);
      }
      // Default: Live first, then upcoming by start time
      if (a.phase === "live" && b.phase !== "live") return -1;
      if (a.phase !== "live" && b.phase === "live") return 1;
      return (
        new Date(a.schedule.startTimeUtc).getTime() -
        new Date(b.schedule.startTimeUtc).getTime()
      );
    });

    // 10. Optional Pagination
    const totalItems = filteredFixtures.length;
    let pagination: CatalogResponse["pagination"] | undefined;
    if (
      extraOptions?.limit !== undefined &&
      extraOptions.limit > 0
    ) {
      const limit = Math.min(500, Math.max(1, extraOptions.limit));
      const page = Math.max(1, extraOptions.page || 1);
      const offset =
        extraOptions.offset !== undefined
          ? Math.max(0, extraOptions.offset)
          : (page - 1) * limit;
      filteredFixtures = filteredFixtures.slice(offset, offset + limit);
      const totalPages = Math.max(1, Math.ceil(totalItems / limit));
      pagination = {
        totalItems,
        returnedItems: filteredFixtures.length,
        page,
        limit,
        totalPages,
        hasNextPage: offset + limit < totalItems,
        hasPrevPage: offset > 0,
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
        activeSportFilter: sportFilter || extraOptions?.sport || "all",
        activePhaseFilter: phaseFilter || extraOptions?.phase || "all",
        sports: snapshot.sportFacets,
        totalLiveMatches: snapshot.globalTotalLive,
        totalUpcomingMatches: snapshot.globalTotalUpcoming,
        totalEndedMatches: snapshot.globalTotalEnded,
      },
      ...(pagination ? { pagination } : {}),
      reconciliation: snapshot.reconciliation,
      fixtures: filteredFixtures,
    };

    if (
      snapshot.allFixtures.length > 0 &&
      !sportFilter &&
      !phaseFilter &&
      !searchQuery &&
      !extraOptions
    ) {
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
   * Dedicated Live Center: returns all currently live events grouped by sport with broadcast intelligence.
   */
  static async getLiveCenter(sportFilter?: string) {
    const startTime = Date.now();
    const catalog = await this.getUnifiedCatalog(sportFilter, "live");
    const bySport: Record<string, UnifiedFixture[]> = {};
    for (const f of catalog.fixtures) {
      if (!bySport[f.sportCategory]) bySport[f.sportCategory] = [];
      bySport[f.sportCategory].push(f);
    }

    return {
      status: "success" as const,
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime,
      totalLiveEvents: catalog.fixtures.length,
      hotMatchesCount: catalog.fixtures.filter((f) => f.isHotMatch).length,
      activeSports: Object.keys(bySport),
      bySport,
      fixtures: catalog.fixtures,
    };
  }

  /**
   * Upcoming Schedule API: returns upcoming fixtures chronologically and grouped by UTC date (YYYY-MM-DD).
   */
  static async getUpcomingSchedule(sportFilter?: string, windowHours?: number) {
    const startTime = Date.now();
    const catalog = await this.getUnifiedCatalog(sportFilter, "upcoming", undefined, {
      sort: "time_asc",
    });

    let fixtures = catalog.fixtures;
    if (windowHours && windowHours > 0) {
      const cutoff = Date.now() + windowHours * 3600 * 1000;
      fixtures = fixtures.filter(
        (f) => new Date(f.schedule.startTimeUtc).getTime() <= cutoff
      );
    }

    const scheduleByDate: Record<string, UnifiedFixture[]> = {};
    for (const f of fixtures) {
      const ymd = f.schedule.startTimeUtc.slice(0, 10);
      if (!scheduleByDate[ymd]) scheduleByDate[ymd] = [];
      scheduleByDate[ymd].push(f);
    }

    return {
      status: "success" as const,
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime,
      totalUpcomingEvents: fixtures.length,
      dates: Object.keys(scheduleByDate).sort(),
      scheduleByDate,
      fixtures,
    };
  }

  /**
   * Competitions & Tournaments Discovery API: aggregates all tournaments across the 6 providers.
   */
  static async getCompetitions(
    sportFilter?: string,
    phaseFilter?: string
  ): Promise<CompetitionsResponse> {
    const catalog = await this.getUnifiedCatalog(
      sportFilter,
      phaseFilter || "active"
    );
    const compMap = new Map<
      string,
      {
        summary: CompetitionSummary;
        providersSet: Set<string>;
        teamsSet: Set<string>;
      }
    >();

    for (const f of catalog.fixtures) {
      const compId = f.tournament.id;
      let entry = compMap.get(compId);
      if (!entry) {
        entry = {
          summary: {
            id: compId,
            name: f.tournament.name,
            shortName: f.tournament.shortName,
            sportCategory: f.sportCategory,
            sportLabel: f.sport,
            logo: f.tournament.logo,
            liveMatchesCount: 0,
            upcomingMatchesCount: 0,
            endedMatchesCount: 0,
            totalFixturesCount: 0,
            providers: [],
            sampleTeams: [],
            nextMatchTimeUtc: undefined,
          },
          providersSet: new Set<string>(),
          teamsSet: new Set<string>(),
        };
        compMap.set(compId, entry);
      }

      entry.summary.totalFixturesCount += 1;
      if (f.phase === "live") entry.summary.liveMatchesCount += 1;
      else if (f.phase === "upcoming") {
        entry.summary.upcomingMatchesCount += 1;
        if (
          !entry.summary.nextMatchTimeUtc ||
          f.schedule.startTimeUtc < entry.summary.nextMatchTimeUtc
        ) {
          entry.summary.nextMatchTimeUtc = f.schedule.startTimeUtc;
        }
      } else {
        entry.summary.endedMatchesCount += 1;
      }

      for (const pk of Object.keys(f.providerPointers)) {
        entry.providersSet.add(pk);
      }
      if (f.teams) {
        entry.teamsSet.add(f.teams.home.name);
        entry.teamsSet.add(f.teams.away.name);
      }
    }

    const competitions = Array.from(compMap.values())
      .map((e) => ({
        ...e.summary,
        providers: Array.from(e.providersSet),
        sampleTeams: Array.from(e.teamsSet).slice(0, 8),
      }))
      .sort(
        (a, b) =>
          b.liveMatchesCount - a.liveMatchesCount ||
          b.totalFixturesCount - a.totalFixturesCount ||
          a.name.localeCompare(b.name)
      );

    return {
      status: "success",
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      totalCompetitions: competitions.length,
      competitions,
    };
  }

  /**
   * Retrieves a single competition and all its fixtures by competition ID or slug.
   */
  static async getCompetitionById(
    idOrSlug: string
  ): Promise<CompetitionDetailResponse | null> {
    const clean = decodeURIComponent(idOrSlug).trim().toLowerCase();
    const comps = await this.getCompetitions(undefined, "all");
    const target = comps.competitions.find(
      (c) =>
        c.id.toLowerCase() === clean ||
        c.id.toLowerCase() === `tourn_${clean}` ||
        Normalizer.slugify(c.name) === clean
    );
    if (!target) return null;

    const catalog = await this.getUnifiedCatalog(undefined, "all", undefined, {
      tournament: target.id,
    });

    return {
      status: "success",
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      competition: target,
      fixtures: catalog.fixtures,
    };
  }

  /**
   * Multi-entity search across Fixtures, Teams, Competitions, and Broadcasters.
   */
  static async searchMultiEntity(query: string): Promise<SearchEntityResult> {
    const startTime = Date.now();
    const cleanQuery = (query || "").trim();
    const catalog = await this.getUnifiedCatalog(undefined, "all");

    if (!cleanQuery) {
      return {
        status: "success",
        apiVersion: "2.1.0",
        timestamp: new Date().toISOString(),
        query: cleanQuery,
        executionTimeMs: Date.now() - startTime,
        counts: { fixtures: 0, teams: 0, competitions: 0, broadcasters: 0 },
        results: { fixtures: [], teams: [], competitions: [], broadcasters: [] },
      };
    }

    const matchedCatalog = await this.getUnifiedCatalog(
      undefined,
      "all",
      cleanQuery
    );

    const tokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const teamsMap = new Map<
      string,
      { id: string; name: string; code: string; logo: string; sportCategory: string; activeFixturesCount: number }
    >();
    const broadcastersMap = new Map<
      string,
      { name: string; activeFixturesCount: number; sports: Set<string> }
    >();

    for (const f of catalog.fixtures) {
      if (f.teams) {
        for (const side of [f.teams.home, f.teams.away]) {
          const lowerName = side.name.toLowerCase();
          const lowerCode = side.code.toLowerCase();
          if (tokens.every((t) => lowerName.includes(t) || lowerCode === t)) {
            const existing = teamsMap.get(side.id);
            if (existing) {
              if (f.phase !== "ended") existing.activeFixturesCount += 1;
            } else {
              teamsMap.set(side.id, {
                ...side,
                sportCategory: f.sportCategory,
                activeFixturesCount: f.phase !== "ended" ? 1 : 0,
              });
            }
          }
        }
      }

      for (const b of f.streamMetadata.primaryBroadcasters) {
        const lowerB = b.toLowerCase();
        if (tokens.every((t) => lowerB.includes(t))) {
          const existing = broadcastersMap.get(b);
          if (existing) {
            if (f.phase !== "ended") existing.activeFixturesCount += 1;
            existing.sports.add(f.sportCategory);
          } else {
            broadcastersMap.set(b, {
              name: b,
              activeFixturesCount: f.phase !== "ended" ? 1 : 0,
              sports: new Set([f.sportCategory]),
            });
          }
        }
      }
    }

    const allComps = await this.getCompetitions(undefined, "all");
    const matchedComps = allComps.competitions.filter((c) => {
      const text = `${c.name} ${c.shortName} ${c.sportLabel}`.toLowerCase();
      return tokens.every((t) => text.includes(t));
    });

    const teams = Array.from(teamsMap.values()).sort(
      (a, b) => b.activeFixturesCount - a.activeFixturesCount
    );
    const broadcasters = Array.from(broadcastersMap.values())
      .map((b) => ({
        name: b.name,
        activeFixturesCount: b.activeFixturesCount,
        sports: Array.from(b.sports),
      }))
      .sort((a, b) => b.activeFixturesCount - a.activeFixturesCount);

    return {
      status: "success",
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      query: cleanQuery,
      executionTimeMs: Date.now() - startTime,
      counts: {
        fixtures: matchedCatalog.fixtures.length,
        teams: teams.length,
        competitions: matchedComps.length,
        broadcasters: broadcasters.length,
      },
      results: {
        fixtures: matchedCatalog.fixtures,
        teams,
        competitions: matchedComps,
        broadcasters,
      },
    };
  }

  /**
   * Provider Federation Health & Coverage Diagnostics across all 6 integrated providers.
   */
  static async getProvidersReport() {
    const snapshot = await this.buildOrGetBaseCatalog();
    const upstreamDiag = UpstreamClient.getDiagnostics();
    const fixtures = snapshot?.allFixtures || [];

    const providers = this.CATALOG_DEFINITIONS.map((def) => {
      const telemetry = upstreamDiag.providerMetrics[def.id];
      let totalFixtures = 0;
      let liveFixtures = 0;
      let exclusiveFixtures = 0;
      const sportsSet = new Set<string>();

      for (const f of fixtures) {
        if (f.providerPointers[def.key]) {
          totalFixtures += 1;
          if (f.phase === "live") liveFixtures += 1;
          if (Object.keys(f.providerPointers).length === 1) {
            exclusiveFixtures += 1;
          }
          sportsSet.add(f.sportCategory);
        }
      }

      return {
        key: def.key,
        id: def.id,
        name: def.name,
        status: telemetry?.status || (totalFixtures > 0 ? "healthy" : "unknown"),
        rawCatalogItems: snapshot?.providerItemCounts[def.key] ?? telemetry?.lastItemCount ?? 0,
        unifiedFixturesCount: totalFixtures,
        liveFixturesCount: liveFixtures,
        exclusiveFixturesCount: exclusiveFixtures,
        sharedFixturesCount: Math.max(0, totalFixtures - exclusiveFixtures),
        sportsCovered: Array.from(sportsSet),
        telemetry: telemetry || null,
      };
    });

    return {
      status: "success" as const,
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      totalProviders: this.CATALOG_DEFINITIONS.length,
      healthyProviders: providers.filter((p) => p.status === "healthy").length,
      upstreamHosts: upstreamDiag.hosts,
      coalescing: {
        totalRequests: upstreamDiag.totalRequests,
        coalescedHits: upstreamDiag.coalescedHits,
        inFlightCount: upstreamDiag.inFlightCount,
      },
      providers,
    };
  }

  /**
   * Platform Observability, Cache Statistics, and Data-Quality Diagnostics.
   */
  static async getPlatformDiagnostics() {
    const snapshot = await this.buildOrGetBaseCatalog();
    const providersReport = await this.getProvidersReport();
    const cacheStats = EdgeCache.getStats();

    return {
      status: "success" as const,
      apiVersion: "2.1.0",
      timestamp: new Date().toISOString(),
      reconciliation: snapshot?.reconciliation || null,
      cache: cacheStats,
      indexSize: this.fixtureIndex.size,
      maxIndexSize: this.MAX_INDEX_ENTRIES,
      providersSummary: {
        total: providersReport.totalProviders,
        healthy: providersReport.healthyProviders,
        coalescedHits: providersReport.coalescing.coalescedHits,
      },
      sportDistribution: (snapshot?.sportFacets || []).filter(
        (s) => s.id !== "all" && (s.totalCount > 0 || (s.endedCount || 0) > 0)
      ),
    };
  }

  /**
   * Resolves, deduplicates, and extracts renditions for a fixture across all 6 providers.
   */
  static async getUnifiedStreams(
    identifier: string,
    queryPointers?: Record<string, string>,
    filterOptions?: StreamFilterOptions
  ): Promise<StreamResponse> {
    // 1. Resolve fixture pointers from bounded index
    let pointers = queryPointers;
    let providerRawIds: Record<string, string[]> | undefined;
    let canonicalKey = identifier;

    if (!pointers || Object.keys(pointers).length === 0) {
      const cached =
        this.getFixtureFromIndex(identifier) ||
        this.getFixtureFromIndex(identifier.replace(/^fixture:/, "")) ||
        this.getFixtureFromIndex(`fixture:${identifier}`);
      if (cached) {
        pointers = cached.providerPointers;
        providerRawIds = cached.providerRawIds;
        canonicalKey = cached.canonicalKey;
      }
    }

    // If still no pointers, perform an initial catalog refresh to populate pointers
    if (!pointers || Object.keys(pointers).length === 0) {
      await this.getUnifiedCatalog();
      const cached =
        this.getFixtureFromIndex(identifier) ||
        this.getFixtureFromIndex(identifier.replace(/^fixture:/, "")) ||
        this.getFixtureFromIndex(`fixture:${identifier}`);
      if (cached) {
        pointers = cached.providerPointers;
        providerRawIds = cached.providerRawIds;
        canonicalKey = cached.canonicalKey;
      }
    }

    // Build lossless list of (providerKey, rawId) pairs
    const fetchPairs: Array<[string, string]> = [];
    if (providerRawIds && Object.keys(providerRawIds).length > 0) {
      for (const [pk, rids] of Object.entries(providerRawIds)) {
        for (const rid of rids) {
          fetchPairs.push([pk, rid]);
        }
      }
    } else {
      for (const [pk, rid] of Object.entries(pointers || {})) {
        fetchPairs.push([pk, rid]);
      }
    }

    const uniqueProvidersQueried = new Set(fetchPairs.map(([pk]) => pk)).size;

    // 2. Concurrently fetch streams from all provider pointers via UpstreamClient
    const rawStreamsList: any[] = [];

    const streamResults = await Promise.allSettled(
      fetchPairs.map(async ([providerKey, rawId]) => {
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

    // 5. Pre-parse HLS Master Playlists for the top streams (unless explicitly disabled)
    if (filterOptions?.inspectHls !== false) {
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
    }

    // Pick recommendedDefaultStreamId intelligently (prefer multi-source HD/Auto feeds over 396p/SD fallback feeds)
    const rankedForDefault = [...deduplicatedStreams].sort((a, b) => {
      const score = (s: UnifiedStream) => {
        let pts = s.reliabilityScore;
        if (s.provenance.isMultiSource) pts += 10;
        if (s.qualityVariant === "1080p" || s.qualityVariant === "4K") pts += 8;
        else if (s.qualityVariant === "Auto" || s.qualityVariant === "720p") pts += 6;
        else if (s.qualityVariant === "396p" || s.qualityVariant === "360p") pts -= 5;
        if (s.channelName === "Standard Feed") pts -= 4;
        return pts;
      };
      return score(b) - score(a);
    });

    const recommendedDefaultStreamId =
      rankedForDefault[0]?.streamId || deduplicatedStreams[0]?.streamId || "";

    // Apply optional stream filters if requested
    let finalStreams = deduplicatedStreams;
    if (filterOptions?.language) {
      const langFilter = filterOptions.language.toLowerCase().trim();
      finalStreams = finalStreams.filter(
        (s) =>
          s.language.code.toLowerCase() === langFilter ||
          s.language.name.toLowerCase() === langFilter
      );
    }
    if (filterOptions?.quality) {
      const qFilter = filterOptions.quality.toLowerCase().trim();
      finalStreams = finalStreams.filter(
        (s) => (s.qualityVariant || "auto").toLowerCase() === qFilter
      );
    }
    if (filterOptions?.protocol) {
      const protoFilter = filterOptions.protocol.toLowerCase().trim();
      finalStreams = finalStreams.filter(
        (s) => s.protocol.toLowerCase() === protoFilter
      );
    }
    if (filterOptions?.provider) {
      const provFilter = filterOptions.provider.toLowerCase().trim();
      finalStreams = finalStreams.filter(
        (s) =>
          s.provenance.originProvider.toLowerCase() === provFilter ||
          s.provenance.mirroredBy.some((m) => m.toLowerCase() === provFilter)
      );
    }

    const availableLanguages = Array.from(
      new Set(deduplicatedStreams.map((s) => s.language.name))
    );
    const availableQualities = Array.from(
      new Set(deduplicatedStreams.map((s) => s.qualityVariant || "Auto"))
    );
    const channelGroups = Array.from(
      new Set(deduplicatedStreams.map((s) => s.channelGroup))
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
        totalProvidersQueried: uniqueProvidersQueried,
        totalRawStreamsFound: rawStreamsList.length,
        deduplicatedStreamsCount: finalStreams.length,
        recommendedDefaultStreamId,
        availableLanguages,
        availableQualities,
        channelGroups,
        audit,
      },
      streams: finalStreams,
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

    const catalog = await this.getUnifiedCatalog(undefined, "all");
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

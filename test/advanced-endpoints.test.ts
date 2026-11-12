import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "../src/index";
import { EdgeCache } from "../src/core/cache";
import { UpstreamClient } from "../src/providers/upstream-client";
import { HlsInspector } from "../src/core/hls-inspector";

describe("Advanced API Capabilities & Endpoints", () => {
  beforeEach(() => {
    EdgeCache.clearMemory();
    HlsInspector.clearCache();
    vi.restoreAllMocks();
  });

  function encodeCncId(provider: string, data: object): string {
    const raw = `${provider}::${JSON.stringify(data)}`;
    return `cnc:${btoa(raw)}`;
  }

  function mockRichCatalog() {
    const now = Date.now();
    const liveStart = new Date(now - 30 * 60_000).toISOString();
    const liveEnd = new Date(now + 90 * 60_000).toISOString();
    const upcomingStart = new Date(now + 4 * 3600_000).toISOString();
    const upcomingEnd = new Date(now + 7 * 3600_000).toISOString();

    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async (catalogId: string) => {
      if (catalogId === "cnc_SportzXLiveEvents_tv") {
        return [
          {
            id: encodeCncId("sportzx", {
              eventId: "live_1",
              title: "Arsenal vs Chelsea",
              eventInfo: {
                teamA: "Arsenal",
                teamB: "Chelsea",
                eventName: "Premier League",
                eventCat: "Football",
                isHot: 1,
                isLive: 1,
                startTime: liveStart,
                endTime: liveEnd,
              },
            }),
            type: "tv",
            name: "Arsenal vs Chelsea",
          },
        ];
      }
      if (catalogId === "cnc_PlayZTVLiveEvents_tv") {
        return [
          {
            id: encodeCncId("playztv", {
              eventId: "live_1_pzt",
              title: "Arsenal vs Chelsea",
              eventInfo: {
                teamA: "Arsenal",
                teamB: "Chelsea",
                eventName: "Premier League",
                eventCat: "Football",
                isHot: 1,
                isLive: 1,
                startTime: liveStart,
                endTime: liveEnd,
              },
            }),
            type: "tv",
            name: "Arsenal vs Chelsea",
          },
        ];
      }
      if (catalogId === "cnc_CricifyLiveEvents_tv") {
        return [
          {
            id: encodeCncId("cricify", {
              eventId: "upcoming_1",
              title: "India vs Australia",
              eventInfo: {
                teamA: "India",
                teamB: "Australia",
                eventName: "Border-Gavaskar Trophy",
                eventCat: "Cricket",
                startTime: upcomingStart,
                endTime: upcomingEnd,
              },
            }),
            type: "tv",
            name: "India vs Australia",
          },
        ];
      }
      return [];
    });
  }

  it("supports pagination, sorting, and hot/provider filtering on /api/catalog", async () => {
    mockRichCatalog();

    const res = await app.request("http://localhost/api/catalog?limit=1&page=1&sort=popularity");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.fixtures).toHaveLength(1);
    expect(body.fixtures[0].title).toBe("Arsenal vs Chelsea");
    expect(body.pagination).toEqual({
      totalItems: 2,
      returnedItems: 1,
      page: 1,
      limit: 1,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });

    const hotRes = await app.request("http://localhost/api/catalog?hot=true");
    const hotBody = (await hotRes.json()) as any;
    expect(hotBody.fixtures).toHaveLength(1);
    expect(hotBody.fixtures[0].isHotMatch).toBe(true);
  });

  it("serves /api/live and /api/upcoming with real-time status filtering", async () => {
    mockRichCatalog();

    const liveRes = await app.request("http://localhost/api/live");
    expect(liveRes.status).toBe(200);
    const liveBody = (await liveRes.json()) as any;
    expect(liveBody.totalLiveEvents).toBe(1);
    expect(liveBody.fixtures[0].title).toBe("Arsenal vs Chelsea");
    expect(liveBody.bySport.football).toHaveLength(1);

    const upcomingRes = await app.request("http://localhost/api/upcoming?hours=12");
    expect(upcomingRes.status).toBe(200);
    const upcomingBody = (await upcomingRes.json()) as any;
    expect(upcomingBody.totalUpcomingEvents).toBe(1);
    expect(upcomingBody.fixtures[0].title).toBe("India vs Australia");
  });

  it("serves /api/competitions and /api/competitions/:id discovery endpoints", async () => {
    mockRichCatalog();

    const compRes = await app.request("http://localhost/api/competitions");
    expect(compRes.status).toBe(200);
    const compBody = (await compRes.json()) as any;
    expect(compBody.totalCompetitions).toBe(2);

    const premierLeague = compBody.competitions.find((c: any) => c.name === "Premier League");
    expect(premierLeague).toBeDefined();
    expect(premierLeague.liveMatchesCount).toBe(1);

    const detailRes = await app.request(`http://localhost/api/competitions/${premierLeague.id}`);
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as any;
    expect(detailBody.competition.name).toBe("Premier League");
    expect(detailBody.fixtures).toHaveLength(1);
  });

  it("serves multi-entity /api/search with fixtures, competitions, and matched teams", async () => {
    mockRichCatalog();

    const searchRes = await app.request("http://localhost/api/search?q=Arsenal");
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as any;
    expect(searchBody.counts.fixtures).toBe(1);
    expect(searchBody.counts.teams).toBeGreaterThanOrEqual(1);
    expect(searchBody.results.teams[0].name).toBe("Arsenal");
  });

  it("serves /api/providers and /api/stats with reconciliation, latency telemetry, and cache diagnostics", async () => {
    mockRichCatalog();

    const statsRes = await app.request("http://localhost/api/stats");
    expect(statsRes.status).toBe(200);
    const statsBody = (await statsRes.json()) as any;
    expect(statsBody.reconciliation.totalUnifiedFixtures).toBe(2);
    expect(statsBody.reconciliation.unmappedRawItemsCount).toBe(0);
    expect(statsBody.cache).toBeDefined();
    expect(statsBody.providersSummary.total).toBe(6);
    expect(statsBody.telemetry).toBeDefined();
    expect(typeof statsBody.telemetry.latency.p50Ms).toBe("number");
    expect(typeof statsBody.telemetry.latency.p95Ms).toBe("number");
    expect(typeof statsBody.telemetry.latency.p99Ms).toBe("number");

    const provRes = await app.request("http://localhost/api/providers");
    expect(provRes.status).toBe(200);
    const provBody = (await provRes.json()) as any;
    expect(provBody.providers).toHaveLength(6);
  });

  it("serves /api/reconciliation audit report with explainable merge decisions and confidence scores", async () => {
    mockRichCatalog();

    const reconRes = await app.request("http://localhost/api/reconciliation");
    expect(reconRes.status).toBe(200);
    const reconBody = (await reconRes.json()) as any;
    expect(reconBody.status).toBe("verified_zero_loss");
    expect(reconBody.summary.unmappedRawItemsCount).toBe(0);
    expect(reconBody.summary.totalUnifiedFixtures).toBe(2);
    expect(reconBody.providerAccounting).toHaveLength(6);
    expect(reconBody.mergeDecisions).toHaveLength(1);
    const arsenalMerge = reconBody.mergeDecisions.find(
      (d: any) => d.title === "Arsenal vs Chelsea"
    );
    expect(arsenalMerge).toBeDefined();
    expect(arsenalMerge.rawItemCount).toBe(2);
    expect(arsenalMerge.confidenceScore).toBeGreaterThanOrEqual(0.9);
  });

  it("serves /api/teams and /api/teams/:id for team discovery and fixture schedules", async () => {
    mockRichCatalog();

    const teamsRes = await app.request("http://localhost/api/teams?sport=football");
    expect(teamsRes.status).toBe(200);
    const teamsBody = (await teamsRes.json()) as any;
    expect(teamsBody.totalTeams).toBe(2);
    const arsenal = teamsBody.teams.find((t: any) => t.name === "Arsenal");
    expect(arsenal).toBeDefined();
    expect(arsenal.liveMatchesCount).toBe(1);

    const detailRes = await app.request(`http://localhost/api/teams/${arsenal.id}`);
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as any;
    expect(detailBody.team.name).toBe("Arsenal");
    expect(detailBody.fixtures).toHaveLength(1);
    expect(detailBody.fixtures[0].title).toBe("Arsenal vs Chelsea");
  });

  it("serves /api/timeline chronological EPG buckets", async () => {
    mockRichCatalog();

    const timelineRes = await app.request("http://localhost/api/timeline");
    expect(timelineRes.status).toBe(200);
    const timelineBody = (await timelineRes.json()) as any;
    expect(timelineBody.totalActiveEvents).toBe(2);
    expect(timelineBody.buckets).toHaveLength(5);
    const liveBucket = timelineBody.buckets.find((b: any) => b.id === "live_now");
    expect(liveBucket).toBeDefined();
    expect(liveBucket.count).toBe(1);
    expect(liveBucket.fixtures[0].title).toBe("Arsenal vs Chelsea");
  });

  it("supports drmFree=true filter and mirrorGroups on /api/stream/:fixtureKey", async () => {
    mockRichCatalog();

    vi.spyOn(UpstreamClient, "fetchStreams").mockImplementation(async (rawId: string) => {
      if (rawId.startsWith("cnc:")) {
        return [
          {
            name: "Sky Sports Main Event",
            title: "Sky Sports 1080p (DRM)",
            url: "https://cdn.example.com/sky/master.mpd?clearkey=0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210",
          },
          {
            name: "Sky Sports Main Event",
            title: "Sky Sports 720p (HLS)",
            url: "https://cdn.example.com/sky/720p.m3u8",
          },
        ];
      }
      return [];
    });

    const catRes = await app.request("http://localhost/api/catalog");
    const catBody = (await catRes.json()) as any;
    const arsenalKey = catBody.fixtures.find(
      (f: any) => f.title === "Arsenal vs Chelsea"
    ).canonicalKey;

    const allStreamsRes = await app.request(
      `http://localhost/api/stream/${encodeURIComponent(arsenalKey)}?inspect=false`
    );
    expect(allStreamsRes.status).toBe(200);
    const allStreamsBody = (await allStreamsRes.json()) as any;
    expect(allStreamsBody.streams).toHaveLength(2);
    expect(allStreamsBody.summary.mirrorGroups).toBeDefined();
    expect(allStreamsBody.summary.mirrorGroups.length).toBeGreaterThanOrEqual(1);

    const drmFreeRes = await app.request(
      `http://localhost/api/stream/${encodeURIComponent(arsenalKey)}?inspect=false&drmFree=true`
    );
    expect(drmFreeRes.status).toBe(200);
    const drmFreeBody = (await drmFreeRes.json()) as any;
    expect(drmFreeBody.streams).toHaveLength(1);
    expect(drmFreeBody.streams[0].drm).toBeNull();
  });

  it("serves /api/broadcasters discovery and preserves all multi-entry providerRawIds on /api/fixture/:id?includeStreams=true", async () => {
    const now = Date.now();
    const liveStart = new Date(now - 20 * 60_000).toISOString();
    const liveEnd = new Date(now + 90 * 60_000).toISOString();

    const rawId1 = encodeCncId("sportzx", {
      eventId: "szx_1",
      title: "New Zealand vs India",
      formats: ["PRIME ENG"],
      eventInfo: {
        teamA: "New Zealand",
        teamB: "India",
        eventName: "One Day International",
        eventCat: "Cricket",
        isLive: 1,
        startTime: liveStart,
        endTime: liveEnd,
      },
    });
    const rawId2 = encodeCncId("sportzx", {
      eventId: "szx_2",
      title: "New Zealand vs India (Hindi)",
      formats: ["PRIME HINDI"],
      eventInfo: {
        teamA: "New Zealand",
        teamB: "India",
        eventName: "One Day International",
        eventCat: "Cricket",
        isLive: 1,
        startTime: liveStart,
        endTime: liveEnd,
      },
    });

    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async (catalogId: string) => {
      if (catalogId === "cnc_SportzXLiveEvents_tv") {
        return [
          { id: rawId1, type: "tv", name: "New Zealand vs India" },
          { id: rawId2, type: "tv", name: "New Zealand vs India" },
        ];
      }
      return [];
    });

    vi.spyOn(UpstreamClient, "fetchStreams").mockImplementation(async (rawId: string) => {
      if (rawId === rawId1) {
        return [
          {
            name: "PRIME ENG FHD",
            title: "Prime English 1080p",
            url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fcdn.example.com%2Feng%2Fcenc.mpd&clearkey=0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210&maxh=1080",
          },
        ];
      }
      if (rawId === rawId2) {
        return [
          {
            name: "PRIME HINDI FHD",
            title: "Prime Hindi 1080p",
            url: "https://cdn.example.com/hindi/master.mpd?clearkey=0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210",
          },
        ];
      }
      return [];
    });

    const bRes = await app.request("http://localhost/api/broadcasters");
    expect(bRes.status).toBe(200);
    const bBody = (await bRes.json()) as any;
    expect(bBody.totalBroadcasters).toBeGreaterThanOrEqual(1);
    expect(bBody.broadcasters[0].name).toBe("Amazon Prime Video");
    expect(bBody.broadcasters[0].group).toBe("Amazon Prime");

    const catRes = await app.request("http://localhost/api/catalog");
    const catBody = (await catRes.json()) as any;
    expect(catBody.fixtures).toHaveLength(1);
    const fixtureId = catBody.fixtures[0].fixtureId;

    // Verify /api/fixture/:id?includeStreams=true queries BOTH rawId1 and rawId2 from sportzx
    const fixRes = await app.request(
      `http://localhost/api/fixture/${encodeURIComponent(fixtureId)}?includeStreams=true`
    );
    expect(fixRes.status).toBe(200);
    const fixBody = (await fixRes.json()) as any;
    expect(fixBody.streams).toHaveLength(2);
    expect(fixBody.streamSummary.providersBreakdown).toHaveLength(1);
    expect(fixBody.streamSummary.providersBreakdown[0].rawIdsQueried).toBe(2);
    expect(fixBody.streamSummary.providersBreakdown[0].rawStreamsReturned).toBe(2);

    // Filter streams by playableOn=web_hls (only the bridged HLS stream is webHlsCompatible, not raw .mpd with ClearKey)
    const webHlsRes = await app.request(
      `http://localhost/api/stream/${encodeURIComponent(fixtureId)}?playableOn=web_hls&inspect=false`
    );
    expect(webHlsRes.status).toBe(200);
    const webHlsBody = (await webHlsRes.json()) as any;
    expect(webHlsBody.streams).toHaveLength(1);
    expect(webHlsBody.streams[0].network.isBridgedStream).toBe(true);
    expect(webHlsBody.streams[0].network.directOriginUrl).toBe(
      "https://cdn.example.com/eng/cenc.mpd"
    );
  });

  it("blocks SSRF private/loopback targets on /api/proxy", async () => {
    const ssrfRes = await app.request(
      "http://localhost/api/proxy?url=" + encodeURIComponent("http://127.0.0.1:8080/admin")
    );
    expect(ssrfRes.status).toBe(400);

    const metaSsrfRes = await app.request(
      "http://localhost/api/proxy?url=" +
        encodeURIComponent("http://169.254.169.254/latest/meta-data/")
    );
    expect(metaSsrfRes.status).toBe(400);
  });
});


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

  it("serves /api/providers and /api/stats with reconciliation and cache diagnostics", async () => {
    mockRichCatalog();

    const statsRes = await app.request("http://localhost/api/stats");
    expect(statsRes.status).toBe(200);
    const statsBody = (await statsRes.json()) as any;
    expect(statsBody.reconciliation.totalUnifiedFixtures).toBe(2);
    expect(statsBody.reconciliation.unmappedRawItemsCount).toBe(0);
    expect(statsBody.cache).toBeDefined();
    expect(statsBody.providersSummary.total).toBe(6);

    const provRes = await app.request("http://localhost/api/providers");
    expect(provRes.status).toBe(200);
    const provBody = (await provRes.json()) as any;
    expect(provBody.providers).toHaveLength(6);
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

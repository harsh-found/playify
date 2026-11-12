import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/index";
import { UpstreamClient } from "../src/providers/upstream-client";
import { EdgeCache } from "../src/core/cache";

describe("Search, Direct Fixture Lookup, and Streams Endpoints", () => {
  beforeEach(() => {
    EdgeCache.clearMemory();
    vi.restoreAllMocks();
  });

  const mockCatalogItems = [
    {
      id: "cnc:U3BvcnR6WExpdmVFdmVudHM6OnsiZXZlbnRJZCI6MTAwMSwidGl0bGUiOiJJbmRpYSB2cyBBdXN0cmFsaWEgM3JkIFQyMEkiLCJjYXQiOiJDcmlja2V0In0=",
      name: "India vs Australia 3rd T20I",
      poster: "https://images.example.com/ind-aus.jpg",
    },
    {
      id: "cnc:UGxheVpUVkxpdmVFdmVudHM6OnsiZXZlbnRJZCI6MjAwMiwidGl0bGUiOiJSZWFsIE1hZHJpZCB2cyBCYXJjZWxvbmEiLCJjYXQiOiJGb290YmFsbCJ9",
      name: "Real Madrid vs Barcelona El Clasico",
      poster: "https://images.example.com/el-clasico.jpg",
    },
    {
      id: "cnc:TGl2WG93TGl2ZUV2ZW50czp7ImV2ZW50SWQiOjMwMDMsInRpdGxlIjoiTW9uYWNvIEdyYW5kIFByaXgiLCJjYXQiOiJNb3RvcnNwb3J0In0=",
      name: "Formula 1 Monaco Grand Prix",
      poster: "https://images.example.com/monaco-gp.jpg",
    },
  ];

  it("filters catalog fixtures with search query parameter across title, sport, and teams", async () => {
    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async (catalogId: string) => {
      if (catalogId === "cnc_SportzXLiveEvents_tv") {
        return mockCatalogItems;
      }
      return [];
    });

    // 1. Search for 'cricket'
    const resCricket = await app.request("/api/catalog?search=cricket");
    expect(resCricket.status).toBe(200);
    const dataCricket = (await resCricket.json()) as any;
    expect(dataCricket.status).toBe("success");
    expect(dataCricket.fixtures).toHaveLength(1);
    expect(dataCricket.fixtures[0].title).toContain("India vs Australia");

    // 2. Search for 'barcelona'
    const resMadrid = await app.request("/api/catalog?search=barcelona");
    expect(resMadrid.status).toBe(200);
    const dataMadrid = (await resMadrid.json()) as any;
    expect(dataMadrid.fixtures).toHaveLength(1);
    expect(dataMadrid.fixtures[0].title).toContain("Real Madrid vs Barcelona");

    // 3. Search for non-existent match
    const resNone = await app.request("/api/catalog?search=curling");
    expect(resNone.status).toBe(200);
    const dataNone = (await resNone.json()) as any;
    expect(dataNone.fixtures).toHaveLength(0);
  });

  it("provides direct fixture lookup by id with /api/fixture/:id", async () => {
    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async () => mockCatalogItems);

    // Initial catalog request to populate in-memory index
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;
    const testFixture = catalogData.fixtures[0];
    expect(testFixture).toBeDefined();

    // Query fixture directly by ID
    const fixtureRes = await app.request(`/api/fixture/${encodeURIComponent(testFixture.fixtureId)}`);
    expect(fixtureRes.status).toBe(200);
    const fixtureData = (await fixtureRes.json()) as any;
    expect(fixtureData.status).toBe("success");
    expect(fixtureData.fixture.fixtureId).toBe(testFixture.fixtureId);
    expect(fixtureData.fixture.canonicalKey).toBe(testFixture.canonicalKey);

    // Query non-existent fixture
    const missingRes = await app.request("/api/fixture/non-existent-fixture-id-999");
    expect(missingRes.status).toBe(404);
    const missingData = (await missingRes.json()) as any;
    expect(missingData.status).toBe("error");
    expect(missingData.error.code).toBe("FIXTURE_NOT_FOUND");
  });

  it("supports both /api/stream/:fixtureKey and /api/streams/:fixtureKey aliases with audit meta", async () => {
    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async () => mockCatalogItems);
    vi.spyOn(UpstreamClient, "fetchStreams").mockImplementation(async () => [
      {
        title: "Sony TEN 1 HD [1080p]",
        url: "https://linear.example.com/hls/sony1080.m3u8",
      },
      {
        title: "DONATE VIA TELEGRAM FOR LIVE FEED",
        url: "https://t.me/spam_channel",
      },
    ]);

    // Populate catalog
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;
    const fixtureKey = catalogData.fixtures[0].canonicalKey;

    // Test plural alias /api/streams/:fixtureKey
    const resStreams = await app.request(`/api/streams/${encodeURIComponent(fixtureKey)}`);
    expect(resStreams.status).toBe(200);
    const dataStreams = (await resStreams.json()) as any;

    expect(dataStreams.status).toBe("success");
    expect(dataStreams.streams).toHaveLength(1);
    expect(dataStreams.streams[0].channelName).toContain("Sony");

    // Verify transparent audit summary in meta
    expect(dataStreams.summary.audit).toBeDefined();
    expect(dataStreams.summary.audit.totalRawStreams).toBeGreaterThanOrEqual(2);
    expect(dataStreams.summary.audit.validStreamsCount).toBe(1);
    expect(dataStreams.summary.audit.excludedStreamsCount).toBeGreaterThanOrEqual(1);
    expect(dataStreams.summary.audit.exclusions[0].reason).toBe("DONATION_SPAM");
  });
});

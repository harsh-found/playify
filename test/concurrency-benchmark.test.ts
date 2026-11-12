import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/index";
import { UpstreamClient } from "../src/providers/upstream-client";
import { EdgeCache } from "../src/core/cache";

describe("Edge Concurrency & Performance Benchmark Suite", () => {
  beforeEach(() => {
    EdgeCache.clearMemory();
    vi.restoreAllMocks();
  });

  const mockCatalogData = {
    metas: [
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
    ],
  };

  const mockStreamData = {
    streams: [
      {
        title: "Sony TEN 1 HD [1080p]",
        url: "https://stream.example.com/live.m3u8",
      },
    ],
  };

  it("handles 30 concurrent catalog requests with single-flight request coalescing and zero race conditions", async () => {
    let speculativeFetchCount = 0;
    // Mock the inner speculativeFetch so UpstreamClient.coalesce operates naturally
    vi.spyOn(UpstreamClient as any, "speculativeFetch").mockImplementation(async (path: string) => {
      speculativeFetchCount++;
      // Simulate 15ms upstream network latency
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (path.includes("/catalog/")) {
        return mockCatalogData;
      }
      return mockStreamData;
    });

    const start = Date.now();
    const concurrentRequests = Array.from({ length: 30 }, () =>
      app.request("/api/catalog?sport=cricket")
    );

    const responses = await Promise.all(concurrentRequests);
    const durationMs = Date.now() - start;

    // All 30 requests must succeed with 200 OK
    for (const res of responses) {
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("success");
      expect(data.fixtures).toHaveLength(1);
    }

    // Upstream calls MUST be coalesced across 6 providers (max 6 calls for 30 concurrent requests)
    expect(speculativeFetchCount).toBeLessThanOrEqual(6);

    // Concurrency benchmark: 30 requests should resolve rapidly
    expect(durationMs).toBeLessThan(1000);
  });

  it("handles 25 concurrent stream requests without race conditions or memory corruption", async () => {
    vi.spyOn(UpstreamClient as any, "speculativeFetch").mockImplementation(async (path: string) => {
      if (path.includes("/catalog/")) {
        return mockCatalogData;
      }
      return mockStreamData;
    });

    // Populate catalog first
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;
    const fixtureKey = catalogData.fixtures[0].canonicalKey;

    const start = Date.now();
    const streamRequests = Array.from({ length: 25 }, () =>
      app.request(`/api/stream/${encodeURIComponent(fixtureKey)}`)
    );

    const responses = await Promise.all(streamRequests);
    const durationMs = Date.now() - start;

    for (const res of responses) {
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("success");
      expect(data.streams).toHaveLength(1);
    }

    expect(durationMs).toBeLessThan(1000);
  });

  it("gracefully maintains high performance even under unexpected query spikes and rapid cache hits", async () => {
    vi.spyOn(UpstreamClient as any, "speculativeFetch").mockImplementation(async () => mockCatalogData);

    // Seed cache
    await app.request("/api/catalog");

    const start = Date.now();
    const rapidCacheHits = Array.from({ length: 50 }, () => app.request("/api/catalog"));

    const responses = await Promise.all(rapidCacheHits);
    const totalTimeMs = Date.now() - start;

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // 50 cache hits in-memory should take < 150ms total
    expect(totalTimeMs).toBeLessThan(150);
  });
});

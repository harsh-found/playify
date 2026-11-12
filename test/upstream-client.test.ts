import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpstreamClient } from "../src/providers/upstream-client";

describe("UpstreamClient Resilience", () => {
  beforeEach(() => {
    // Reset circuit breaker host states
    (UpstreamClient as any).hostStates?.clear();
  });

  it("coalesces identical concurrent requests into a single upstream call", async () => {
    let fetchCount = 0;
    const mockFetcher = vi.fn(async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 50));
      return [{ id: "cnc:1", name: "Test" }];
    });

    const [p1, p2, p3] = await Promise.all([
      UpstreamClient.coalesce("key1", mockFetcher),
      UpstreamClient.coalesce("key1", mockFetcher),
      UpstreamClient.coalesce("key1", mockFetcher),
    ]);

    expect(fetchCount).toBe(1);
    expect(p1).toEqual(p2);
    expect(p2).toEqual(p3);
  });

  it("trips circuit breaker on repeated host failures and fast-fails", () => {
    UpstreamClient.recordFailure("https://bad-host.com");
    UpstreamClient.recordFailure("https://bad-host.com");
    UpstreamClient.recordFailure("https://bad-host.com");

    expect(UpstreamClient.isHostHealthy("https://bad-host.com")).toBe(false);
  });

  it("records failure when a host times out internally", async () => {
    const testHost = "https://timeout-host.example.com";
    // Mock global fetch to simulate hanging request exceeding 50ms timeout
    const originalFetch = globalThis.fetch;
    (globalThis.fetch as any) = vi.fn((_url: any, opts: any) => {
      return new Promise<Response>((_, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    try {
      await (UpstreamClient as any).fetchSingle(testHost, "/test.json", 30);
      expect(UpstreamClient.isHostHealthy(testHost)).toBe(true);
      // After 3 timeouts, circuit breaker should trip
      await (UpstreamClient as any).fetchSingle(testHost, "/test.json", 30);
      await (UpstreamClient as any).fetchSingle(testHost, "/test.json", 30);
      expect(UpstreamClient.isHostHealthy(testHost)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("speculatively fails over to secondary host immediately when primary fails fast", async () => {
    const originalHosts = UpstreamClient.UPSTREAM_HOSTS;
    UpstreamClient.UPSTREAM_HOSTS = [
      "https://primary-fast-fail.com",
      "https://secondary-success.com",
    ];

    const originalFetch = globalThis.fetch;
    const fetchTimestamps: { host: string; time: number }[] = [];
    const startTime = Date.now();

    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("primary-fast-fail")) {
        fetchTimestamps.push({ host: "primary", time: Date.now() - startTime });
        return Promise.resolve(new Response(null, { status: 502 }));
      }
      if (urlStr.includes("secondary-success")) {
        fetchTimestamps.push({ host: "secondary", time: Date.now() - startTime });
        return Promise.resolve(
          new Response(JSON.stringify({ metas: [{ id: "cnc:win", name: "Hedged Win" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error("Unknown host"));
    });

    try {
      const res = await (UpstreamClient as any).speculativeFetch("/catalog/tv/test.json", 3000, 1000);
      expect(res).not.toBeNull();
      expect(res.metas[0].name).toBe("Hedged Win");
      // Secondary should have been triggered fast upon primary failure, well before 1000ms hedge delay!
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(800);
    } finally {
      globalThis.fetch = originalFetch;
      UpstreamClient.UPSTREAM_HOSTS = originalHosts;
    }
  });
});

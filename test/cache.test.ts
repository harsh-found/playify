import { describe, it, expect, beforeEach } from "vitest";
import { EdgeCache } from "../src/core/cache";

describe("EdgeCache Resilience and Bounded Memory", () => {
  beforeEach(() => EdgeCache.clearMemory());

  it("computes deterministic ETag and returns 304 on matching If-None-Match", async () => {
    const req = new Request("http://localhost/api/catalog");
    const res = new Response(JSON.stringify({ test: "data" }), {
      headers: { "Content-Type": "application/json" },
    });
    await EdgeCache.put("catalog:all", req, res, 60);

    const hit = await EdgeCache.get("catalog:all", req);
    expect(hit).not.toBeNull();
    const etag = hit?.headers.get("ETag");
    expect(etag).toBeDefined();

    const conditionalReq = new Request("http://localhost/api/catalog", {
      headers: { "If-None-Match": etag! },
    });
    const conditionalHit = await EdgeCache.get("catalog:all", conditionalReq);
    expect(conditionalHit?.status).toBe(304);
  });

  it("enforces strict LRU bounds of max 200 items", async () => {
    const req = new Request("http://localhost/api/test");
    for (let i = 0; i < 220; i++) {
      const res = new Response(JSON.stringify({ i }), {
        headers: { "Content-Type": "application/json" },
      });
      await EdgeCache.put(`key:${i}`, req, res, 60);
    }

    // Earliest keys should have been evicted
    const first = await EdgeCache.get("key:0", req);
    expect(first).toBeNull();

    // Latest keys should be present
    const latest = await EdgeCache.get("key:219", req);
    expect(latest).not.toBeNull();
  });
});

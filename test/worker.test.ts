import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { Aggregator } from "../src/providers/aggregator";
import { EdgeCache } from "../src/core/cache";

describe("Arena Edge Worker Integration Test Suite", () => {
  beforeEach(() => {
    EdgeCache.clearMemory();
  });

  describe("Aggregator & 6 Sports Providers", () => {
    it("declares exactly 6 live sports providers in federation", () => {
      expect(Aggregator.CATALOG_DEFINITIONS).toHaveLength(6);
      const keys = Aggregator.CATALOG_DEFINITIONS.map((c) => c.key);
      expect(keys).toContain("sportzx");
      expect(keys).toContain("playztv");
      expect(keys).toContain("livxow");
      expect(keys).toContain("sktech");
      expect(keys).toContain("playfy");
      expect(keys).toContain("cricify");
    });
  });

  describe("API Endpoints & Router", () => {
    it("serves root discovery with documentation and endpoints", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("healthy");
      expect(data.version).toBe("2.1.0");
      expect(data.endpoints.unifiedCatalog).toBe("/api/catalog");
      expect(data.endpoints.sportsExplore).toBe("/api/sports");
      expect(data.endpoints.unifiedStream).toBe("/api/stream/:fixtureKey");
      expect(data.endpoints.streamProxy).toBeDefined();
    });

    it("serves health check with PoP diagnostics", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("ok");
      expect(data.version).toBe("2.1.0");
      expect(data.edge).toBeDefined();
    });

    it("handles /api/proxy missing parameter validation", async () => {
      const res = await app.request("/api/proxy");
      expect(res.status).toBe(400);
    });

    it("handles /api/proxy OPTIONS preflight request with 204 No Content", async () => {
      const res = await app.request("/api/proxy?url=https://example.com/stream.m3u8", {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    });

    it("rejects invalid non-http proxy targets", async () => {
      const res = await app.request("/api/proxy?url=ftp://evil.com/payload");
      expect(res.status).toBe(400);
    });

    it("returns standardized RFC 7807 JSON error when endpoint not found or invalid", async () => {
      const res = await app.request("/api/non-existent-route");
      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.status).toBe("error");
      expect(data.error.code).toBe("NOT_FOUND");
    });

    it("attaches X-Response-Time-Ms and X-Worker-Version headers on every response", async () => {
      const res = await app.request("/health");
      expect(res.headers.get("X-Worker-Version")).toBe("2.1.0");
      expect(res.headers.get("X-Response-Time-Ms")).toBeDefined();
    });
  });

  describe("DrmDetector Unit Tests", () => {
    it("detects ClearKey format kid:key", async () => {
      const { DrmDetector } = await import("../src/core/drm");
      const text = "Willow HD clearkey: 1234567890abcdef1234567890abcdef:fedcba0987654321fedcba0987654321";
      const drm = DrmDetector.detectDrm(text);
      expect(drm).toBeDefined();
      expect(drm?.type).toBe("clearkey");
      expect(drm?.keys).toHaveLength(1);
      expect(drm?.keys?.[0].kid).toBe("1234567890abcdef1234567890abcdef");
      expect(drm?.keys?.[0].key).toBe("fedcba0987654321fedcba0987654321");
    });

    it("detects URL-encoded ClearKey", async () => {
      const { DrmDetector } = await import("../src/core/drm");
      const text = "https://cdn.example.com/live.mpd?clearkey=1234567890abcdef1234567890abcdef%3Afedcba0987654321fedcba0987654321";
      const drm = DrmDetector.detectDrm(text);
      expect(drm).toBeDefined();
      expect(drm?.type).toBe("clearkey");
      expect(drm?.keys?.[0].kid).toBe("1234567890abcdef1234567890abcdef");
      expect(drm?.keys?.[0].key).toBe("fedcba0987654321fedcba0987654321");
    });

    it("detects keyId= and key= query parameters", async () => {
      const { DrmDetector } = await import("../src/core/drm");
      const text = "https://cdn.example.com/dash.mpd?keyId=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&key=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const drm = DrmDetector.detectDrm(text);
      expect(drm).toBeDefined();
      expect(drm?.type).toBe("clearkey");
      expect(drm?.keys?.[0].kid).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(drm?.keys?.[0].key).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    });

    it("returns null when no DRM indicator present", async () => {
      const { DrmDetector } = await import("../src/core/drm");
      const text = "https://cdn.example.com/clear_hls.m3u8";
      expect(DrmDetector.detectDrm(text)).toBeNull();
    });
  });
});

import { HlsInspector } from "./hls-inspector";
import { UpstreamClient } from "../providers/upstream-client";

/**
 * Cloudflare Edge Cache API wrapper with in-memory fallback for local dev & testing.
 * Provides ETag generation, conditional 304 Not Modified responses, bounded LRU eviction,
 * and real-time cache telemetry.
 */
interface CacheEntry {
  body: string;
  headers: [string, string][];
  etag: string;
  expiry: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  notModified304: number;
  evictions: number;
  currentEntries: number;
  maxEntries: number;
  hitRatePercent: number;
}

export class EdgeCache {
  private static memoryCache = new Map<string, CacheEntry>();
  private static MAX_MEMORY_ITEMS = 200;
  private static generation = 1;

  private static stats = {
    hits: 0,
    misses: 0,
    notModified304: 0,
    evictions: 0,
  };

  static getGeneration(): number {
    return this.generation;
  }

  static getStats(): CacheStats {
    const total = this.stats.hits + this.stats.notModified304 + this.stats.misses;
    const hitRatePercent =
      total > 0
        ? Number((((this.stats.hits + this.stats.notModified304) / total) * 100).toFixed(2))
        : 0;
    return {
      ...this.stats,
      currentEntries: this.memoryCache.size,
      maxEntries: this.MAX_MEMORY_ITEMS,
      hitRatePercent,
    };
  }

  /**
   * Fast, deterministic 32-bit FNV-1a hash for ETag calculation.
   */
  static computeEtag(body: string): string {
    let hash = 2166136261;
    for (let i = 0; i < body.length; i++) {
      hash ^= body.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, "0");
    return `W/"${body.length.toString(16)}-${hex}"`;
  }

  /**
   * Look up a cached Response by cache key.
   * Handles HTTP conditional requests (If-None-Match) with 304 Not Modified.
   */
  static async get(key: string, request: Request): Promise<Response | null> {
    const ifNoneMatch = request.headers.get("If-None-Match");

    try {
      if (typeof caches !== "undefined" && caches.default) {
        const cache = caches.default;
        const cacheUrl = new URL(`/__edge_cache__/${encodeURIComponent(key)}`, request.url);
        const match = await cache.match(cacheUrl.toString());
        if (match) {
          const cachedEtag = match.headers.get("ETag");
          if (ifNoneMatch && cachedEtag && ifNoneMatch === cachedEtag) {
            this.stats.notModified304 += 1;
            return new Response(null, {
              status: 304,
              statusText: "Not Modified",
              headers: match.headers,
            });
          }

          this.stats.hits += 1;
          const headers = new Headers(match.headers);
          headers.set("X-Edge-Cache", "HIT");
          return new Response(match.body, {
            status: match.status,
            statusText: match.statusText,
            headers,
          });
        }
      }
    } catch {
      // Fallback to memory cache
    }

    // In-memory fallback
    const item = this.memoryCache.get(key);
    if (item) {
      if (Date.now() < item.expiry) {
        const headers = new Headers(item.headers);

        if (ifNoneMatch && item.etag && ifNoneMatch === item.etag) {
          this.stats.notModified304 += 1;
          headers.set("X-Edge-Cache", "HIT-MEM-304");
          return new Response(null, {
            status: 304,
            statusText: "Not Modified",
            headers,
          });
        }

        this.stats.hits += 1;
        headers.set("X-Edge-Cache", "HIT-MEM");
        // Re-insert to mark as recently used in LRU
        this.memoryCache.delete(key);
        this.memoryCache.set(key, item);

        return new Response(item.body, { status: 200, headers });
      }
      this.memoryCache.delete(key);
    }

    this.stats.misses += 1;
    return null;
  }

  /**
   * Cache a Response with specified TTL seconds.
   */
  static async put(
    key: string,
    request: Request,
    response: Response,
    ttlSeconds: number
  ): Promise<void> {
    const cloned = response.clone();
    const bodyText = await cloned.text();
    const etag = this.computeEtag(bodyText);

    const headers = new Headers(response.headers);
    headers.set(
      "Cache-Control",
      `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=15`
    );
    headers.set("X-Edge-Cache", "MISS");
    headers.set("ETag", etag);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "*");

    // Also populate incoming response headers so first-time cache misses carry ETag and Cache-Control
    try {
      response.headers.set("ETag", etag);
      response.headers.set(
        "Cache-Control",
        `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=15`
      );
      response.headers.set("X-Edge-Cache", "MISS");
    } catch {}

    const cacheResponse = new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    try {
      if (typeof caches !== "undefined" && caches.default) {
        const cache = caches.default;
        const cacheUrl = new URL(`/__edge_cache__/${encodeURIComponent(key)}`, request.url);
        await cache.put(cacheUrl.toString(), cacheResponse.clone());
      }
    } catch {
      // Fallback
    }

    // Populate in-memory fallback with strict bounded LRU capacity (max 200 items)
    if (this.memoryCache.size >= this.MAX_MEMORY_ITEMS && !this.memoryCache.has(key)) {
      const now = Date.now();
      for (const [k, v] of this.memoryCache.entries()) {
        if (v.expiry <= now) {
          this.memoryCache.delete(k);
          this.stats.evictions += 1;
        }
      }
      while (this.memoryCache.size >= this.MAX_MEMORY_ITEMS) {
        const oldestKey = this.memoryCache.keys().next().value;
        if (oldestKey) {
          this.memoryCache.delete(oldestKey);
          this.stats.evictions += 1;
        } else {
          break;
        }
      }
    }

    this.memoryCache.set(key, {
      body: bodyText,
      headers: Array.from(headers.entries()),
      etag,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  static clearMemory(): void {
    this.memoryCache.clear();
    this.generation += 1;
    this.stats = {
      hits: 0,
      misses: 0,
      notModified304: 0,
      evictions: 0,
    };
    HlsInspector.clearCache();
    UpstreamClient.clearStreamCache();
  }
}

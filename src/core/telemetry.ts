/**
 * Lightweight, zero-allocation circular ring buffer telemetry tracker for Cloudflare Edge.
 * Tracks rolling p50/p95/p99 response latencies, per-endpoint performance, and error rates.
 */

export interface RouteMetricSummary {
  route: string;
  requests: number;
  errors: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastLatencyMs: number;
}

export interface TelemetrySnapshot {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  errorRatePercent: number;
  latency: {
    sampleSize: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
  };
  routes: RouteMetricSummary[];
}

class RingBuffer {
  private buffer: Float64Array;
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Float64Array(capacity);
  }

  push(val: number): void {
    this.buffer[this.head] = val;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count += 1;
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  getStats() {
    if (this.count === 0) {
      return {
        sampleSize: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        minMs: 0,
        maxMs: 0,
      };
    }

    const slice = Array.from(this.buffer.subarray(0, this.count)).sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += slice[i];
    }

    const pick = (p: number) => {
      const idx = Math.min(slice.length - 1, Math.max(0, Math.floor(p * slice.length)));
      return Number(slice[idx].toFixed(2));
    };

    return {
      sampleSize: this.count,
      avgMs: Number((sum / slice.length).toFixed(2)),
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      p99Ms: pick(0.99),
      minMs: Number(slice[0].toFixed(2)),
      maxMs: Number(slice[slice.length - 1].toFixed(2)),
    };
  }
}

interface RouteEntry {
  requests: number;
  errors: number;
  lastLatencyMs: number;
  ring: RingBuffer;
}

export class EdgeTelemetry {
  private static startedAt = Date.now();
  private static totalRequests = 0;
  private static totalErrors = 0;
  private static globalRing = new RingBuffer(512);
  private static routes = new Map<string, RouteEntry>();
  private static MAX_ROUTES = 40;

  static recordRequest(path: string, status: number, elapsedMs: number): void {
    const normalizedRoute = this.normalizeRoute(path);
    this.totalRequests += 1;
    if (status >= 500) {
      this.totalErrors += 1;
    }
    this.globalRing.push(elapsedMs);

    let entry = this.routes.get(normalizedRoute);
    if (!entry) {
      if (this.routes.size >= this.MAX_ROUTES) {
        const oldestKey = this.routes.keys().next().value;
        if (oldestKey) this.routes.delete(oldestKey);
      }
      entry = {
        requests: 0,
        errors: 0,
        lastLatencyMs: 0,
        ring: new RingBuffer(128),
      };
      this.routes.set(normalizedRoute, entry);
    }

    entry.requests += 1;
    if (status >= 500) {
      entry.errors += 1;
    }
    entry.lastLatencyMs = Number(elapsedMs.toFixed(2));
    entry.ring.push(elapsedMs);
  }

  static normalizeRoute(path: string): string {
    if (!path || path === "/") return "/";
    const clean = path.split("?")[0];
    if (clean.startsWith("/api/stream/")) return "/api/stream/:fixtureKey";
    if (clean.startsWith("/api/streams/")) return "/api/streams/:fixtureKey";
    if (clean.startsWith("/api/fixture/")) return "/api/fixture/:id";
    if (clean.startsWith("/api/fixtures/")) return "/api/fixtures/:id";
    if (clean.startsWith("/api/competitions/")) return "/api/competitions/:id";
    if (clean.startsWith("/api/tournaments/")) return "/api/tournaments/:id";
    if (clean.startsWith("/api/teams/")) return "/api/teams/:id";
    if (clean.startsWith("/api/catalog/")) return "/api/catalog/:sport";
    return clean;
  }

  static getSnapshot(): TelemetrySnapshot {
    const routeSummaries: RouteMetricSummary[] = [];
    for (const [route, entry] of this.routes.entries()) {
      const stats = entry.ring.getStats();
      routeSummaries.push({
        route,
        requests: entry.requests,
        errors: entry.errors,
        avgMs: stats.avgMs,
        p50Ms: stats.p50Ms,
        p95Ms: stats.p95Ms,
        p99Ms: stats.p99Ms,
        lastLatencyMs: entry.lastLatencyMs,
      });
    }
    routeSummaries.sort((a, b) => b.requests - a.requests);

    const errorRatePercent =
      this.totalRequests > 0
        ? Number(((this.totalErrors / this.totalRequests) * 100).toFixed(2))
        : 0;

    return {
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRatePercent,
      latency: this.globalRing.getStats(),
      routes: routeSummaries,
    };
  }

  static reset(): void {
    this.startedAt = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.globalRing.clear();
    this.routes.clear();
  }
}

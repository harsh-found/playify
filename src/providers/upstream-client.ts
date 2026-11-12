import {
  UpstreamMeta,
  UpstreamStream,
  CatalogExclusion,
  validateUpstreamMetasWithAudit,
  validateUpstreamStreams,
} from "../types/upstream.types";

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  successes?: number;
  lastLatencyMs?: number;
}

export interface ProviderFetchTelemetry {
  catalogId: string;
  lastLatencyMs: number;
  avgLatencyMs: number;
  lastRawCount?: number;
  lastItemCount: number;
  lastExcludedCount?: number;
  lastExclusions?: CatalogExclusion[];
  totalFetches: number;
  totalFailures: number;
  lastSuccessAt?: string;
  status: "healthy" | "degraded" | "offline";
}

export class UpstreamClient {
  public static UPSTREAM_HOSTS = [
    "https://cncverse.dpdns.org/u/p_ai41ykrzepbq",
    "https://cncverse.pages.dev/u/p_ai41ykrzepbq",
  ];

  private static inFlightRequests = new Map<string, Promise<any>>();
  private static hostStates = new Map<string, CircuitBreakerState>();
  private static providerMetrics = new Map<string, ProviderFetchTelemetry>();
  private static streamCache = new Map<string, { streams: UpstreamStream[]; expiresAt: number }>();

  private static totalRequests = 0;
  private static coalescedHits = 0;

  private static CIRCUIT_BREAKER_THRESHOLD = 3;
  private static CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute cooldown
  private static STREAM_CACHE_TTL_MS = 25_000; // 25s hot stream cache
  private static MAX_STREAM_CACHE_ITEMS = 250;

  static clearStreamCache(): void {
    this.streamCache.clear();
  }

  static resetCircuitBreakers(): void {
    this.hostStates.clear();
    this.inFlightRequests.clear();
    this.providerMetrics.clear();
    this.streamCache.clear();
    this.totalRequests = 0;
    this.coalescedHits = 0;
  }

  /**
   * In-flight promise coalescing: deduplicates concurrent requests with the same key.
   */
  static async coalesce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    this.totalRequests += 1;
    const existing = this.inFlightRequests.get(key);
    if (existing) {
      this.coalescedHits += 1;
      return existing as Promise<T>;
    }

    const promise = fetcher().finally(() => {
      this.inFlightRequests.delete(key);
    });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  /**
   * Circuit breaker failure recorder.
   */
  static recordFailure(host: string): void {
    const state = this.hostStates.get(host) || { failures: 0, lastFailureTime: 0, successes: 0 };
    state.failures += 1;
    state.lastFailureTime = Date.now();
    this.hostStates.set(host, state);
  }

  /**
   * Circuit breaker success recorder.
   */
  static recordSuccess(host: string, latencyMs?: number): void {
    const prev = this.hostStates.get(host);
    if (prev && prev.failures > 0) {
      this.hostStates.delete(host);
    } else if (latencyMs !== undefined) {
      this.hostStates.set(host, {
        failures: 0,
        lastFailureTime: 0,
        successes: (prev?.successes || 0) + 1,
        lastLatencyMs: latencyMs,
      });
    } else {
      this.hostStates.delete(host);
    }
  }

  /**
   * Checks if an upstream host is healthy according to circuit breaker status.
   */
  static isHostHealthy(host: string): boolean {
    const state = this.hostStates.get(host);
    if (!state) return true;
    if (state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      if (Date.now() - state.lastFailureTime > this.CIRCUIT_BREAKER_RESET_MS) {
        // Half-open transition: give it a trial chance
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Returns real-time diagnostics for upstream hosts, request coalescing, and provider catalogs.
   */
  static getDiagnostics() {
    const hosts = this.UPSTREAM_HOSTS.map((host) => {
      const state = this.hostStates.get(host);
      const healthy = this.isHostHealthy(host);
      let circuitState: "closed" | "open" | "half-open" = "closed";
      if (state && state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        circuitState = healthy ? "half-open" : "open";
      }
      return {
        host,
        healthy,
        circuitState,
        consecutiveFailures: state?.failures || 0,
        lastFailureTime: state?.lastFailureTime
          ? new Date(state.lastFailureTime).toISOString()
          : null,
        lastLatencyMs: state?.lastLatencyMs ?? null,
      };
    });

    return {
      totalRequests: this.totalRequests,
      coalescedHits: this.coalescedHits,
      inFlightCount: this.inFlightRequests.size,
      hosts,
      providerMetrics: Object.fromEntries(this.providerMetrics.entries()),
    };
  }

  /**
   * Speculative racing fetch across upstream hosts:
   * Queries primary host, and if primary does not respond within hedgeDelayMs (or fails fast),
   * launches parallel fetch on fallback host. Returns whichever fulfills first with valid data.
   */
  private static async speculativeFetch(
    path: string,
    timeoutMs = 8000,
    hedgeDelayMs = 2000
  ): Promise<any | null> {
    const candidateHosts = this.UPSTREAM_HOSTS.filter((h) => this.isHostHealthy(h));
    const hostsToTry = candidateHosts.length > 0 ? candidateHosts : this.UPSTREAM_HOSTS;

    if (hostsToTry.length === 1) {
      return this.fetchSingle(hostsToTry[0], path, timeoutMs);
    }

    const primaryHost = hostsToTry[0];
    const secondaryHost = hostsToTry[1];

    const controller = new AbortController();
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    let triggerHedgeNow: (() => void) | null = null;
    const earlyHedgeTrigger = new Promise<void>((resolve) => {
      triggerHedgeNow = resolve;
    });

    const hedgedSecondary = Promise.race([
      new Promise<void>((resolve) => {
        hedgeTimer = setTimeout(resolve, hedgeDelayMs);
      }),
      earlyHedgeTrigger,
    ]).then(async () => {
      return this.fetchSingle(secondaryHost, path, timeoutMs, controller.signal);
    });

    const primaryAttempt = this.fetchSingle(primaryHost, path, timeoutMs, controller.signal).then(
      (res) => {
        if (!res && triggerHedgeNow) {
          triggerHedgeNow();
        }
        return res;
      }
    );

    try {
      const winner = await Promise.any([
        primaryAttempt.then((res) => {
          if (res) return res;
          throw new Error("Primary failed");
        }),
        hedgedSecondary.then((res) => {
          if (res) return res;
          throw new Error("Secondary failed");
        }),
      ]);
      controller.abort();
      return winner;
    } catch {
      return null;
    } finally {
      if (hedgeTimer) clearTimeout(hedgeTimer);
    }
  }

  private static async fetchSingle(
    host: string,
    path: string,
    timeoutMs: number,
    parentSignal?: AbortSignal
  ): Promise<any | null> {
    const controller = new AbortController();
    let isTimeoutAbort = false;
    const timeout = setTimeout(() => {
      isTimeoutAbort = true;
      controller.abort();
    }, timeoutMs);

    const abortHandler = () => controller.abort();
    if (parentSignal) {
      parentSignal.addEventListener("abort", abortHandler);
    }

    const start = Date.now();
    try {
      const resp = await fetch(`${host}${path}`, {
        signal: controller.signal,
        headers: {
          "User-Agent": "PlayifyEdgeWorker/2.1.0 (Cloudflare Edge)",
          Accept: "application/json",
        },
      });

      if (resp.ok) {
        const data = await resp.json();
        this.recordSuccess(host, Date.now() - start);
        return data;
      } else {
        this.recordFailure(host);
        return null;
      }
    } catch {
      const isParentHedgeAbort = parentSignal?.aborted;
      // Record failure on timeout, network error, or host unresponsiveness
      if (!isParentHedgeAbort || isTimeoutAbort) {
        this.recordFailure(host);
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortHandler);
      }
    }
  }

  /**
   * Fetches an individual catalog across federated upstream hosts with coalescing, exclusion audit, and telemetry.
   */
  static async fetchCatalog(catalogId: string): Promise<UpstreamMeta[]> {
    const cacheKey = `upstream:catalog:${catalogId}`;
    return this.coalesce(cacheKey, async () => {
      const start = Date.now();
      const path = `/catalog/tv/${catalogId}.json`;
      const data = await this.speculativeFetch(path, 8000, 1800);
      const latency = Date.now() - start;
      const { valid, exclusions, totalRaw } = validateUpstreamMetasWithAudit(
        data?.metas,
        catalogId
      );

      const prev = this.providerMetrics.get(catalogId);
      const totalFetches = (prev?.totalFetches || 0) + 1;
      const totalFailures = (prev?.totalFailures || 0) + (data ? 0 : 1);
      const avgLatencyMs = prev
        ? Math.round((prev.avgLatencyMs * prev.totalFetches + latency) / totalFetches)
        : latency;

      this.providerMetrics.set(catalogId, {
        catalogId,
        lastLatencyMs: latency,
        avgLatencyMs,
        lastRawCount: totalRaw,
        lastItemCount: valid.length,
        lastExcludedCount: exclusions.length,
        lastExclusions: exclusions,
        totalFetches,
        totalFailures,
        lastSuccessAt: data ? new Date().toISOString() : prev?.lastSuccessAt,
        status: valid.length > 0 ? "healthy" : data ? "degraded" : "offline",
      });

      return valid;
    });
  }

  /**
   * Fetches raw streams for a specific ID across federated upstream hosts with coalescing and hot LRU cache.
   */
  static async fetchStreams(rawId: string): Promise<UpstreamStream[]> {
    const cached = this.streamCache.get(rawId);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        // Re-insert for LRU order
        this.streamCache.delete(rawId);
        this.streamCache.set(rawId, cached);
        return cached.streams;
      }
      this.streamCache.delete(rawId);
    }

    const cacheKey = `upstream:stream:${rawId}`;
    return this.coalesce(cacheKey, async () => {
      const path = `/stream/tv/${encodeURIComponent(rawId)}.json`;
      const data = await this.speculativeFetch(path, 6000, 1500);
      const valid = validateUpstreamStreams(data?.streams);
      if (valid.length > 0) {
        if (this.streamCache.size >= this.MAX_STREAM_CACHE_ITEMS) {
          const oldestKey = this.streamCache.keys().next().value;
          if (oldestKey) this.streamCache.delete(oldestKey);
        }
        this.streamCache.set(rawId, {
          streams: valid,
          expiresAt: Date.now() + this.STREAM_CACHE_TTL_MS,
        });
      }
      return valid;
    });
  }
}

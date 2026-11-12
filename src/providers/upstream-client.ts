import {
  UpstreamMeta,
  UpstreamStream,
  validateUpstreamMetas,
  validateUpstreamStreams,
} from "../types/upstream.types";

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
}

export class UpstreamClient {
  public static UPSTREAM_HOSTS = [
    "https://cncverse.dpdns.org/u/p_ai41ykrzepbq",
    "https://cncverse.pages.dev/u/p_ai41ykrzepbq",
  ];

  private static inFlightRequests = new Map<string, Promise<any>>();
  private static hostStates = new Map<string, CircuitBreakerState>();

  private static CIRCUIT_BREAKER_THRESHOLD = 3;
  private static CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute cooldown

  /**
   * In-flight promise coalescing: deduplicates concurrent requests with the same key.
   */
  static async coalesce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inFlightRequests.get(key);
    if (existing) {
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
    const state = this.hostStates.get(host) || { failures: 0, lastFailureTime: 0 };
    state.failures += 1;
    state.lastFailureTime = Date.now();
    this.hostStates.set(host, state);
  }

  /**
   * Circuit breaker success recorder.
   */
  static recordSuccess(host: string): void {
    this.hostStates.delete(host);
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
        this.recordSuccess(host);
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
   * Fetches an individual catalog across federated upstream hosts with coalescing.
   */
  static async fetchCatalog(catalogId: string): Promise<UpstreamMeta[]> {
    const cacheKey = `upstream:catalog:${catalogId}`;
    return this.coalesce(cacheKey, async () => {
      const path = `/catalog/tv/${catalogId}.json`;
      const data = await this.speculativeFetch(path, 8000, 1800);
      return validateUpstreamMetas(data?.metas);
    });
  }

  /**
   * Fetches raw streams for a specific ID across federated upstream hosts with coalescing.
   */
  static async fetchStreams(rawId: string): Promise<UpstreamStream[]> {
    const cacheKey = `upstream:stream:${rawId}`;
    return this.coalesce(cacheKey, async () => {
      const path = `/stream/tv/${encodeURIComponent(rawId)}.json`;
      const data = await this.speculativeFetch(path, 6000, 1500);
      return validateUpstreamStreams(data?.streams);
    });
  }
}

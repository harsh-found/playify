import { Hono } from "hono";
import { cors } from "hono/cors";
import { EdgeCache } from "./core/cache";
import { EdgeTelemetry } from "./core/telemetry";
import { Aggregator } from "./providers/aggregator";
import { StreamProxy } from "./core/proxy";
import { API_VERSION, CatalogQueryOptions } from "./types/catalog.types";

export const app = new Hono();

// 1. Observability Diagnostics, Security Headers, Latency Percentile Tracking & Timing Middleware
app.use("*", async (c, next) => {
  const start = performance.now();
  const reqId =
    c.req.header("cf-ray") ||
    c.req.header("x-request-id") ||
    `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await next();
  const elapsed = performance.now() - start;
  EdgeTelemetry.recordRequest(c.req.path, c.res.status, elapsed);
  c.header("X-Response-Time-Ms", Math.round(elapsed).toString());
  c.header("X-Worker-Version", API_VERSION);
  c.header("X-Request-Id", reqId);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});

// 2. Global CORS Middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["*"],
    maxAge: 86400,
  })
);

// 3. RFC 7807 Standard Error Handlers
app.notFound((c) => {
  return c.json(
    {
      status: "error",
      error: {
        code: "NOT_FOUND",
        message: `Resource not found: ${c.req.path}`,
        path: c.req.path,
        timestamp: new Date().toISOString(),
      },
    },
    404
  );
});

app.onError((err, c) => {
  return c.json(
    {
      status: "error",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: err.message || "An unexpected edge error occurred",
        path: c.req.path,
        timestamp: new Date().toISOString(),
      },
    },
    500
  );
});

// Helper to parse and validate catalog query parameters
function parseCatalogQueryOptions(c: any): {
  options: CatalogQueryOptions;
  cacheKeySuffix: string;
} {
  const sport = c.req.query("sport");
  const phase = c.req.query("phase");
  const search = c.req.query("search") ?? c.req.query("q");
  const kind = c.req.query("kind");
  const tournament = c.req.query("tournament");
  const provider = c.req.query("provider");
  const broadcaster = c.req.query("broadcaster") ?? c.req.query("channel");
  const language = c.req.query("language") ?? c.req.query("lang");
  const minProvidersRaw = c.req.query("minProviders");
  const hotRaw = c.req.query("hot");
  const date = c.req.query("date");
  const sort = c.req.query("sort") as CatalogQueryOptions["sort"];
  const pageRaw = c.req.query("page");
  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");

  const hot = hotRaw === "true" || hotRaw === "1" ? true : undefined;
  const minProviders = minProvidersRaw ? parseInt(minProvidersRaw, 10) : undefined;
  const page = pageRaw ? parseInt(pageRaw, 10) : undefined;
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : undefined;

  const hasExtra = Boolean(
    kind ||
      tournament ||
      provider ||
      broadcaster ||
      language ||
      (minProviders !== undefined && !isNaN(minProviders)) ||
      hot !== undefined ||
      date ||
      sort ||
      (limit !== undefined && !isNaN(limit))
  );

  const options: CatalogQueryOptions = {
    sport,
    phase,
    search,
    kind,
    tournament,
    provider,
    broadcaster,
    language,
    minProviders: minProviders !== undefined && !isNaN(minProviders) ? minProviders : undefined,
    hot,
    date,
    sort,
    page: page !== undefined && !isNaN(page) ? page : undefined,
    limit: limit !== undefined && !isNaN(limit) ? limit : undefined,
    offset: offset !== undefined && !isNaN(offset) ? offset : undefined,
  };

  const cacheKeySuffix = hasExtra
    ? `:${kind ?? ""}:${tournament ?? ""}:${provider ?? ""}:${broadcaster ?? ""}:${language ?? ""}:${minProviders ?? ""}:${hot ?? ""}:${date ?? ""}:${sort ?? ""}:${page ?? ""}:${limit ?? ""}:${offset ?? ""}`
    : "";

  return { options, cacheKeySuffix };
}

// 4. Root Discovery & Documentation
app.get("/", (c) => {
  return c.json({
    service: "Playify Edge Live Sports Gateway",
    version: API_VERSION,
    architecture: "Edge-Federated Multi-Provider Engine",
    status: "healthy",
    providersIntegrated: Aggregator.CATALOG_DEFINITIONS.length,
    providers: Aggregator.CATALOG_DEFINITIONS.map((p) => ({
      key: p.key,
      name: p.name,
    })),
    endpoints: {
      unifiedCatalog: "/api/catalog",
      catalogBySport: "/api/catalog/:sport",
      liveCenter: "/api/live",
      upcomingSchedule: "/api/upcoming",
      eventTimeline: "/api/timeline",
      competitions: "/api/competitions",
      competitionDetail: "/api/competitions/:id",
      teams: "/api/teams",
      teamDetail: "/api/teams/:id",
      broadcasters: "/api/broadcasters",
      broadcasterDetail: "/api/broadcasters/:id",
      channelsAlias: "/api/channels",
      multiEntitySearch: "/api/search?q=<query>",
      fixtureLookup: "/api/fixture/:id",
      sportsExplore: "/api/sports",
      unifiedStream: "/api/stream/:fixtureKey",
      unifiedStreamsAlias: "/api/streams/:fixtureKey",
      reconciliationAudit: "/api/reconciliation",
      providersHealth: "/api/providers",
      platformStats: "/api/stats",
      openApiSpec: "/api/openapi.json",
      streamProxy: "/api/proxy?url=<target_m3u8_url>",
      health: "/health",
    },
  });
});

// 5. Sports Explore API: /api/sports
app.get("/api/sports", async (c) => {
  const cacheKey = "sports:summary";
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const summary = await Aggregator.getSportsSummary();
  const response = c.json(summary);
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
});

// 6. Unified Sports Catalog API: /api/catalog?sport=cricket&phase=live&search=india
app.get("/api/catalog", async (c) => {
  const { options, cacheKeySuffix } = parseCatalogQueryOptions(c);
  const cacheKey = `catalog:unified:${options.sport ?? "all"}:${options.phase ?? "all"}:${options.search ?? ""}${cacheKeySuffix}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const catalog = await Aggregator.getUnifiedCatalog(
    options.sport,
    options.phase,
    options.search,
    cacheKeySuffix ? options : undefined
  );
  const response = c.json(catalog);

  // Dynamic TTL: 15s if live sports are active, 60s otherwise (only cache valid non-empty responses)
  if (catalog.fixtures.length > 0) {
    const ttl = catalog.facets.totalLiveMatches > 0 ? 15 : 60;
    await EdgeCache.put(cacheKey, c.req.raw, response, ttl);
  }
  return response;
});

// 7. Dedicated Sport Catalog: /api/catalog/:sport?search=arsenal
app.get("/api/catalog/:sport", async (c) => {
  const sport = c.req.param("sport");
  const { options, cacheKeySuffix } = parseCatalogQueryOptions(c);

  const cacheKey = `catalog:sport:${sport}:${options.phase ?? "all"}:${options.search ?? ""}${cacheKeySuffix}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const catalog = await Aggregator.getUnifiedCatalog(
    sport,
    options.phase,
    options.search,
    cacheKeySuffix ? { ...options, sport } : undefined
  );
  const response = c.json(catalog);

  if (catalog.fixtures.length > 0) {
    const ttl = catalog.facets.totalLiveMatches > 0 ? 15 : 60;
    await EdgeCache.put(cacheKey, c.req.raw, response, ttl);
  }
  return response;
});

// 8. Dedicated Live Events Center: /api/live
app.get("/api/live", async (c) => {
  const sport = c.req.query("sport");
  const cacheKey = `live:center:${sport ?? "all"}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const liveData = await Aggregator.getLiveCenter(sport);
  const response = c.json(liveData);
  await EdgeCache.put(cacheKey, c.req.raw, response, 15);
  return response;
});

// 9. Upcoming Schedule & Calendar API: /api/upcoming & /api/schedule
const handleUpcomingRequest = async (c: any) => {
  const sport = c.req.query("sport");
  const hoursRaw = c.req.query("hours");
  const hours = hoursRaw ? parseInt(hoursRaw, 10) : undefined;

  const cacheKey = `upcoming:schedule:${sport ?? "all"}:${hours ?? "all"}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const schedule = await Aggregator.getUpcomingSchedule(
    sport,
    hours !== undefined && !isNaN(hours) ? hours : undefined
  );
  const response = c.json(schedule);
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
};

app.get("/api/upcoming", handleUpcomingRequest);
app.get("/api/schedule", handleUpcomingRequest);

// 10. Chronological Event Timeline EPG API: /api/timeline
app.get("/api/timeline", async (c) => {
  const sport = c.req.query("sport");
  const cacheKey = `timeline:epg:${sport ?? "all"}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const timeline = await Aggregator.getTimeline(sport);
  const response = c.json(timeline);
  await EdgeCache.put(cacheKey, c.req.raw, response, 15);
  return response;
});

// 11. Competitions & Tournaments Discovery API: /api/competitions & /api/tournaments
const handleCompetitionsRequest = async (c: any) => {
  const sport = c.req.query("sport");
  const phase = c.req.query("phase");
  const cacheKey = `competitions:list:${sport ?? "all"}:${phase ?? "active"}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const competitions = await Aggregator.getCompetitions(sport, phase);
  const response = c.json(competitions);
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
};

app.get("/api/competitions", handleCompetitionsRequest);
app.get("/api/tournaments", handleCompetitionsRequest);

// 12. Single Competition / Tournament Detail API: /api/competitions/:id & /api/tournaments/:id
const handleCompetitionDetailRequest = async (c: any) => {
  const id = c.req.param("id");
  const decodedId = decodeURIComponent(id);

  const detail = await Aggregator.getCompetitionById(decodedId);
  if (!detail) {
    return c.json(
      {
        status: "error",
        error: {
          code: "COMPETITION_NOT_FOUND",
          message: `Competition not found: ${decodedId}`,
          id: decodedId,
          timestamp: new Date().toISOString(),
        },
      },
      404
    );
  }

  return c.json(detail);
};

app.get("/api/competitions/:id", handleCompetitionDetailRequest);
app.get("/api/tournaments/:id", handleCompetitionDetailRequest);

// 13. Teams & Franchises Discovery API: /api/teams
app.get("/api/teams", async (c) => {
  const sport = c.req.query("sport");
  const search = c.req.query("search") ?? c.req.query("q");
  const cacheKey = `teams:list:${sport ?? "all"}:${search ?? ""}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const teams = await Aggregator.getTeams(sport, search);
  const response = c.json(teams);
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
});

// 14. Single Team Detail & Schedule API: /api/teams/:id
app.get("/api/teams/:id", async (c) => {
  const id = c.req.param("id");
  const decodedId = decodeURIComponent(id);
  const sport = c.req.query("sport");

  const detail = await Aggregator.getTeamById(decodedId, sport);
  if (!detail) {
    return c.json(
      {
        status: "error",
        error: {
          code: "TEAM_NOT_FOUND",
          message: `Team not found: ${decodedId}`,
          id: decodedId,
          timestamp: new Date().toISOString(),
        },
      },
      404
    );
  }

  return c.json(detail);
});

// 14b. Broadcasters & Channels Intelligence API: /api/broadcasters & /api/channels
const handleBroadcastersRequest = async (c: any) => {
  const sport = c.req.query("sport");
  const phase = c.req.query("phase");
  const cacheKey = `broadcasters:list:${sport ?? "all"}:${phase ?? "active"}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const broadcasters = await Aggregator.getBroadcasters(sport, phase);
  const response = c.json(broadcasters);
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
};

app.get("/api/broadcasters", handleBroadcastersRequest);
app.get("/api/channels", handleBroadcastersRequest);

// 14c. Single Broadcaster / Channel Detail API: /api/broadcasters/:id & /api/channels/:id
const handleBroadcasterDetailRequest = async (c: any) => {
  const id = c.req.param("id");
  const decodedId = decodeURIComponent(id);
  const sport = c.req.query("sport");
  const phase = c.req.query("phase");

  const detail = await Aggregator.getBroadcasterById(decodedId, sport, phase);
  if (!detail) {
    return c.json(
      {
        status: "error",
        error: {
          code: "BROADCASTER_NOT_FOUND",
          message: `Broadcaster not found: ${decodedId}`,
          id: decodedId,
          timestamp: new Date().toISOString(),
        },
      },
      404
    );
  }

  return c.json(detail);
};

app.get("/api/broadcasters/:id", handleBroadcasterDetailRequest);
app.get("/api/channels/:id", handleBroadcasterDetailRequest);

// 15. Multi-Entity Search API: /api/search?q=india
app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? c.req.query("search") ?? "";
  const cacheKey = `search:multi:${q.toLowerCase().trim()}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const results = await Aggregator.searchMultiEntity(q);
  const response = c.json(results);
  await EdgeCache.put(cacheKey, c.req.raw, response, 20);
  return response;
});

// 16. Direct Fixture Lookup: /api/fixture/:id & /api/fixtures/:id
const handleFixtureLookup = async (c: any) => {
  const id = c.req.param("id");
  const decodedId = decodeURIComponent(id);
  const includeStreams =
    c.req.query("includeStreams") === "true" ||
    c.req.query("includeStreams") === "1";

  const fixture = await Aggregator.getFixtureById(decodedId);
  if (!fixture) {
    return c.json(
      {
        status: "error",
        error: {
          code: "FIXTURE_NOT_FOUND",
          message: `Fixture not found: ${decodedId}`,
          id: decodedId,
          timestamp: new Date().toISOString(),
        },
      },
      404
    );
  }

  if (includeStreams) {
    const streamData = await Aggregator.getUnifiedStreams(
      fixture.canonicalKey,
      fixture.providerPointers
    );
    return c.json({
      status: "success",
      apiVersion: API_VERSION,
      fixture,
      streams: streamData.streams,
      streamSummary: streamData.summary,
    });
  }

  return c.json({
    status: "success",
    apiVersion: API_VERSION,
    fixture,
  });
};

app.get("/api/fixture/:id", handleFixtureLookup);
app.get("/api/fixtures/:id", handleFixtureLookup);

// 17. Unified Stream Studio API: /api/stream/:fixtureKey & /api/streams/:fixtureKey
const handleStreamRequest = async (c: any) => {
  const fixtureKey = c.req.param("fixtureKey");
  const decodedKey = decodeURIComponent(fixtureKey);
  const language = c.req.query("language");
  const quality = c.req.query("quality");
  const protocol = c.req.query("protocol");
  const provider = c.req.query("provider");
  const channel = c.req.query("channel");
  const tier = c.req.query("tier") as "primary" | "secondary" | "tertiary" | undefined;
  const playableOn = c.req.query("playableOn") as "web_hls" | "all" | undefined;
  const drmFreeRaw = c.req.query("drmFree");
  const drmFree = drmFreeRaw === "true" || drmFreeRaw === "1" ? true : undefined;
  const inspectRaw = c.req.query("inspect");
  const inspectHls =
    inspectRaw === "false" || inspectRaw === "0" ? false : true;

  const filterSuffix =
    language ||
    quality ||
    protocol ||
    provider ||
    channel ||
    tier ||
    playableOn ||
    drmFree !== undefined ||
    !inspectHls
      ? `:${language ?? ""}:${quality ?? ""}:${protocol ?? ""}:${provider ?? ""}:${channel ?? ""}:${tier ?? ""}:${playableOn ?? ""}:${drmFree ?? ""}:${inspectHls}`
      : "";

  const cacheKey = `stream:unified:${decodedKey}${filterSuffix}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const streams = await Aggregator.getUnifiedStreams(
    decodedKey,
    undefined,
    filterSuffix
      ? {
          language,
          quality,
          protocol,
          provider,
          channel,
          tier,
          playableOn,
          drmFree,
          inspectHls,
        }
      : undefined
  );
  const response = c.json(streams);

  // Cache streams for 30 seconds
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
};

app.get("/api/stream/:fixtureKey", handleStreamRequest);
app.get("/api/streams/:fixtureKey", handleStreamRequest);

// 18. Deep Source-to-Output Reconciliation Audit: /api/reconciliation
app.get("/api/reconciliation", async (c) => {
  const report = await Aggregator.getReconciliationReport();
  if (!report) {
    return c.json(
      {
        status: "error",
        error: {
          code: "RECONCILIATION_UNAVAILABLE",
          message: "No upstream catalog data available for reconciliation",
          timestamp: new Date().toISOString(),
        },
      },
      503
    );
  }
  return c.json(report);
});

// 19. Provider Federation Health & Coverage Diagnostics: /api/providers
app.get("/api/providers", async (c) => {
  const report = await Aggregator.getProvidersReport();
  return c.json(report);
});

// 20. Platform Observability, Latency Percentiles & Reconciliation Diagnostics: /api/stats & /api/diagnostics
const handleDiagnosticsRequest = async (c: any) => {
  const diagnostics = await Aggregator.getPlatformDiagnostics();
  return c.json(diagnostics);
};

app.get("/api/stats", handleDiagnosticsRequest);
app.get("/api/diagnostics", handleDiagnosticsRequest);

// 21. OpenAPI 3.1.0 Specification: /api/openapi.json
app.get("/api/openapi.json", (c) => {
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Playify Edge Live Sports Gateway API",
      version: API_VERSION,
      description:
        "High-performance Cloudflare Edge Worker aggregating 6 live sports providers with continuous cross-provider reconciliation, stream intelligence, DRM & ClearKey extraction, and CORS header proxy.",
    },
    paths: {
      "/": { get: { summary: "Service Discovery & Metadata" } },
      "/health": { get: { summary: "Edge PoP Health, Cache & Latency Telemetry" } },
      "/api/sports": { get: { summary: "18 Canonical Sport Facets & Live Match Counts" } },
      "/api/catalog": {
        get: {
          summary: "Unified Multi-Provider Sports Catalog",
          parameters: [
            { name: "sport", in: "query", schema: { type: "string" } },
            { name: "phase", in: "query", schema: { type: "string", enum: ["active", "live", "upcoming", "ended", "all"] } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "kind", in: "query", schema: { type: "string", enum: ["match", "tournament_channel", "show"] } },
            { name: "tournament", in: "query", schema: { type: "string" } },
            { name: "provider", in: "query", schema: { type: "string", enum: ["sportzx", "playztv", "livxow", "sktech", "playfy", "cricify"] } },
            { name: "broadcaster", in: "query", schema: { type: "string" } },
            { name: "language", in: "query", schema: { type: "string" } },
            { name: "minProviders", in: "query", schema: { type: "integer", minimum: 1, maximum: 6 } },
            { name: "hot", in: "query", schema: { type: "boolean" } },
            { name: "date", in: "query", schema: { type: "string", format: "date" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["default", "time_asc", "time_desc", "popularity", "title_asc", "smart"] } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
        },
      },
      "/api/catalog/{sport}": { get: { summary: "Sport-Scoped Unified Catalog" } },
      "/api/live": { get: { summary: "Live Events Center Grouped by Sport" } },
      "/api/upcoming": { get: { summary: "Upcoming Schedule Grouped by UTC Date" } },
      "/api/timeline": { get: { summary: "Chronological EPG Timeline Buckets" } },
      "/api/competitions": { get: { summary: "Competitions & Tournaments Discovery" } },
      "/api/competitions/{id}": { get: { summary: "Single Competition Detail & Fixtures" } },
      "/api/teams": { get: { summary: "Teams & Franchises Discovery" } },
      "/api/teams/{id}": { get: { summary: "Single Team Detail & Schedule" } },
      "/api/broadcasters": { get: { summary: "Canonical Broadcast Networks Discovery" } },
      "/api/broadcasters/{id}": { get: { summary: "Single Broadcaster Detail & Fixtures" } },
      "/api/search": { get: { summary: "Multi-Entity Search (Fixtures, Teams, Competitions, Broadcasters)" } },
      "/api/fixture/{id}": { get: { summary: "Direct Fixture Lookup by fixtureId, canonicalKey, or raw cnc ID" } },
      "/api/stream/{fixtureKey}": {
        get: {
          summary: "Unified Multi-Provider Stream Studio & Mirror Groups",
          parameters: [
            { name: "language", in: "query", schema: { type: "string" } },
            { name: "quality", in: "query", schema: { type: "string" } },
            { name: "protocol", in: "query", schema: { type: "string", enum: ["hls", "dash", "mp4"] } },
            { name: "provider", in: "query", schema: { type: "string" } },
            { name: "channel", in: "query", schema: { type: "string" } },
            { name: "tier", in: "query", schema: { type: "string", enum: ["primary", "secondary", "tertiary"] } },
            { name: "playableOn", in: "query", schema: { type: "string", enum: ["web_hls", "all"] } },
            { name: "drmFree", in: "query", schema: { type: "boolean" } },
            { name: "inspect", in: "query", schema: { type: "boolean" } },
          ],
        },
      },
      "/api/reconciliation": { get: { summary: "Full Source-to-Output Reconciliation & Zero-Loss Audit" } },
      "/api/providers": { get: { summary: "Provider Federation Health & Circuit Breaker Telemetry" } },
      "/api/stats": { get: { summary: "Platform Observability, Cache Metrics & Latency Percentiles" } },
      "/api/proxy": { get: { summary: "SSRF-Hardened Stream Header Masquerading & M3U8 Rewrite Proxy" } },
    },
  });
});

// 22. Stream Header Masquerading & CORS Proxy: /api/proxy?url=...
app.get("/api/proxy", async (c) => {
  return StreamProxy.handleProxyRequest(c.req.raw);
});

// 23. Edge Health Diagnostics
app.get("/health", (c) => {
  const cf = (
    c.req.raw as unknown as {
      cf?: { colo?: string; country?: string; city?: string };
    }
  ).cf;

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    edge: {
      colo: cf?.colo ?? "LOCAL",
      country: cf?.country ?? "IN",
      city: cf?.city ?? "Local-PoP",
    },
    cache: EdgeCache.getStats(),
    telemetry: EdgeTelemetry.getSnapshot().latency,
    version: API_VERSION,
    service: "playify-edge",
  });
});

export default app;

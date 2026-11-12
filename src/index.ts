import { Hono } from "hono";
import { cors } from "hono/cors";
import { EdgeCache } from "./core/cache";
import { EdgeTelemetry } from "./core/telemetry";
import { Aggregator } from "./providers/aggregator";
import { StreamProxy } from "./core/proxy";
import { CatalogQueryOptions } from "./types/catalog.types";

export const app = new Hono();

// 1. Observability Diagnostics, Latency Percentile Tracking & Timing Middleware
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const elapsed = performance.now() - start;
  EdgeTelemetry.recordRequest(c.req.path, c.res.status, elapsed);
  c.header("X-Response-Time-Ms", Math.round(elapsed).toString());
  c.header("X-Worker-Version", "2.1.0");
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
  const hotRaw = c.req.query("hot");
  const date = c.req.query("date");
  const sort = c.req.query("sort") as CatalogQueryOptions["sort"];
  const pageRaw = c.req.query("page");
  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");

  const hot = hotRaw === "true" || hotRaw === "1" ? true : undefined;
  const page = pageRaw ? parseInt(pageRaw, 10) : undefined;
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : undefined;

  const hasExtra = Boolean(
    kind ||
      tournament ||
      provider ||
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
    hot,
    date,
    sort,
    page: page !== undefined && !isNaN(page) ? page : undefined,
    limit: limit !== undefined && !isNaN(limit) ? limit : undefined,
    offset: offset !== undefined && !isNaN(offset) ? offset : undefined,
  };

  const cacheKeySuffix = hasExtra
    ? `:${kind ?? ""}:${tournament ?? ""}:${provider ?? ""}:${hot ?? ""}:${date ?? ""}:${sort ?? ""}:${page ?? ""}:${limit ?? ""}:${offset ?? ""}`
    : "";

  return { options, cacheKeySuffix };
}

// 4. Root Discovery & Documentation
app.get("/", (c) => {
  return c.json({
    service: "Playify Edge Live Sports Gateway",
    version: "2.1.0",
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
      multiEntitySearch: "/api/search?q=<query>",
      fixtureLookup: "/api/fixture/:id",
      sportsExplore: "/api/sports",
      unifiedStream: "/api/stream/:fixtureKey",
      unifiedStreamsAlias: "/api/streams/:fixtureKey",
      reconciliationAudit: "/api/reconciliation",
      providersHealth: "/api/providers",
      platformStats: "/api/stats",
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

  const detail = await Aggregator.getTeamById(decodedId);
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
      apiVersion: "2.1.0",
      fixture,
      streams: streamData.streams,
      streamSummary: streamData.summary,
    });
  }

  return c.json({
    status: "success",
    apiVersion: "2.1.0",
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
  const drmFreeRaw = c.req.query("drmFree");
  const drmFree = drmFreeRaw === "true" || drmFreeRaw === "1" ? true : undefined;
  const inspectRaw = c.req.query("inspect");
  const inspectHls =
    inspectRaw === "false" || inspectRaw === "0" ? false : true;

  const filterSuffix =
    language || quality || protocol || provider || drmFree !== undefined || !inspectHls
      ? `:${language ?? ""}:${quality ?? ""}:${protocol ?? ""}:${provider ?? ""}:${drmFree ?? ""}:${inspectHls}`
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
      ? { language, quality, protocol, provider, drmFree, inspectHls }
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

// 21. Stream Header Masquerading & CORS Proxy: /api/proxy?url=...
app.get("/api/proxy", async (c) => {
  return StreamProxy.handleProxyRequest(c.req.raw);
});

// 22. Edge Health Diagnostics
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
    version: "2.1.0",
    service: "playify-edge",
  });
});

export default app;

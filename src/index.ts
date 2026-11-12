import { Hono } from "hono";
import { cors } from "hono/cors";
import { EdgeCache } from "./core/cache";
import { Aggregator } from "./providers/aggregator";
import { StreamProxy } from "./core/proxy";

export const app = new Hono();

// 1. Observability Diagnostics & Timing Middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const elapsed = Date.now() - start;
  c.header("X-Response-Time-Ms", elapsed.toString());
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

// 4. Root Discovery & Documentation
app.get("/", (c) => {
  return c.json({
    service: "Playify Edge Live Sports Gateway",
    version: "2.1.0",
    architecture: "Edge-Federated Multi-Provider Engine",
    status: "healthy",
    providersIntegrated: Aggregator.CATALOG_DEFINITIONS.length,
    endpoints: {
      unifiedCatalog: "/api/catalog",
      catalogBySport: "/api/catalog/:sport",
      fixtureLookup: "/api/fixture/:id",
      sportsExplore: "/api/sports",
      unifiedStream: "/api/stream/:fixtureKey",
      unifiedStreamsAlias: "/api/streams/:fixtureKey",
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
  const sport = c.req.query("sport");
  const phase = c.req.query("phase");
  const search = c.req.query("search");

  const cacheKey = `catalog:unified:${sport ?? "all"}:${phase ?? "all"}:${search ?? ""}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const catalog = await Aggregator.getUnifiedCatalog(sport, phase, search);
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
  const phase = c.req.query("phase");
  const search = c.req.query("search");

  const cacheKey = `catalog:sport:${sport}:${phase ?? "all"}:${search ?? ""}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const catalog = await Aggregator.getUnifiedCatalog(sport, phase, search);
  const response = c.json(catalog);

  if (catalog.fixtures.length > 0) {
    const ttl = catalog.facets.totalLiveMatches > 0 ? 15 : 60;
    await EdgeCache.put(cacheKey, c.req.raw, response, ttl);
  }
  return response;
});

// 8. Direct Fixture Lookup: /api/fixture/:id
app.get("/api/fixture/:id", async (c) => {
  const id = c.req.param("id");
  const decodedId = decodeURIComponent(id);

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

  return c.json({
    status: "success",
    apiVersion: "2.1.0",
    fixture,
  });
});

// 9. Unified Stream Studio API: /api/stream/:fixtureKey & /api/streams/:fixtureKey
const handleStreamRequest = async (c: any) => {
  const fixtureKey = c.req.param("fixtureKey");
  const decodedKey = decodeURIComponent(fixtureKey);

  const cacheKey = `stream:unified:${decodedKey}`;
  const cachedResponse = await EdgeCache.get(cacheKey, c.req.raw);
  if (cachedResponse) {
    return cachedResponse;
  }

  const streams = await Aggregator.getUnifiedStreams(decodedKey);
  const response = c.json(streams);

  // Cache streams for 30 seconds
  await EdgeCache.put(cacheKey, c.req.raw, response, 30);
  return response;
};

app.get("/api/stream/:fixtureKey", handleStreamRequest);
app.get("/api/streams/:fixtureKey", handleStreamRequest);

// 9. Stream Header Masquerading & CORS Proxy: /api/proxy?url=...
app.get("/api/proxy", async (c) => {
  return StreamProxy.handleProxyRequest(c.req.raw);
});

// 10. Edge Health Diagnostics
app.get("/health", (c) => {
  const cf = (c.req.raw as unknown as { cf?: { colo?: string; country?: string; city?: string } })
    .cf;

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    edge: {
      colo: cf?.colo ?? "LOCAL",
      country: cf?.country ?? "IN",
      city: cf?.city ?? "Local-PoP",
    },
    version: "2.1.0",
    service: "playify-edge",
  });
});

export default app;

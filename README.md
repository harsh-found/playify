# Playify Edge API

<p align="center">
  <strong>Edge-Federated Multi-Provider Live Sports Aggregation, Reconciliation & Stream Intelligence Gateway</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg?style=flat-square" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020.svg?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/framework-Hono%20v4-E36002.svg?style=flat-square" alt="Hono v4" />
  <img src="https://img.shields.io/badge/language-TypeScript%205.6-3178C6.svg?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.6" />
  <img src="https://img.shields.io/badge/providers-6%20Federated-10B981.svg?style=flat-square" alt="6 Providers" />
  <img src="https://img.shields.io/badge/reconciliation-Zero%20Data%20Loss-059669.svg?style=flat-square" alt="Zero Data Loss" />
  <img src="https://img.shields.io/badge/openapi-3.1.0-6BA539.svg?style=flat-square" alt="OpenAPI 3.1.0" />
</p>

---

**Playify Edge API (`playify-edge-worker` v1.0.0)** is a high-performance, zero-cold-start Cloudflare Edge Worker that aggregates, normalizes, reconciles, and serves live sports catalogs and multi-source playback streams across **six independent upstream providers** (`SportzX`, `PlayZ TV`, `LivXow`, `SKTech`, `PlayFy`, and `Cricify`).

Engineered for production reliability, Playify Edge eliminates duplicate match pollution, repairs UTF-8 mojibake, prevents false cross-series merges, preserves every valid stream resolution and mirror URL, extracts ClearKey DRM configurations, pre-parses HLS master playlists, and provides a hardened CORS/header-masquerading edge proxy.

---

## Table of Contents

1. [Feature Highlights](#1-feature-highlights)
2. [System Architecture](#2-system-architecture)
3. [Provider Federation Details](#3-provider-federation-details)
4. [Extraction & Continuous Reconciliation Engine](#4-extraction--continuous-reconciliation-engine)
5. [Stream Intelligence & Lossless Deduplication](#5-stream-intelligence--lossless-deduplication)
6. [Caching & Performance Architecture](#6-caching--performance-architecture)
7. [Complete Endpoint Reference](#7-complete-endpoint-reference)
8. [Query Parameters & Filtering Guide](#8-query-parameters--filtering-guide)
9. [Verified Request & Response Examples](#9-verified-request--response-examples)
10. [Error Handling & Status Codes](#10-error-handling--status-codes)
11. [Security & SSRF Hardening](#11-security--ssrf-hardening)
12. [Setup, Development & Deployment](#12-setup-development--deployment)
13. [Configuration & Environment](#13-configuration--environment)
14. [Testing, Auditing & Benchmarking](#14-testing-auditing--benchmarking)
15. [Usage Examples & Troubleshooting](#15-usage-examples--troubleshooting)

---

## 1. Feature Highlights

- **6-Provider Federated Extraction**: Queries `SportzX`, `PlayZ TV`, `LivXow`, `SKTech`, `PlayFy`, and `Cricify` concurrently with speculative dual-host racing, circuit breakers, and in-flight request coalescing.
- **Continuous Source-to-Output Reconciliation (`unmappedRawItemsCount === 0`)**: Guarantees 100% accounting of every valid upstream catalog item with multi-pass reconciliation (`exact_canonical_key`, `nodate_reconciliation`, `cross_format_reconciliation`, `near_time_reconciliation`) and explainable confidence scoring (`0.00 - 1.00`).
- **False-Merge Guardrails**: Multi-dimensional `EventIdentityEngine` extracts format (`T20`, `ODI`, `Test`), match numbers (`1st Match`, `Game 2`), tournament stages (`Final`, `Semi-Final`), gender (`Women`), and age groups (`U19`, `U21`, `U23`) to ensure distinct matches between the same teams are never falsely collapsed.
- **18 Canonical Sport Categories**: Multi-signal sport classifier overrides upstream misclassifications (e.g., `Formula 1`, `MotoGP`, `WWE`, `UFC`, `NBA`, `NBL`, `NHL`, `NFL`, `UEFA`, `ATP/WTA` tagged as `"Cricket"` or `"tv"` upstream) into 18 canonical categories.
- **Lossless Stream Intelligence**:
  - Preserves distinct quality variants (`4K`, `1080p`, `720p`, `576p`, `540p`, `480p`, `396p`, `360p`, `288p`, `Auto`) while collapsing identical or equivalent CDN edge mirrors (`otte.cache.aiv-cdn.net` / `otte.live.fly.ww.aiv-cdn.net`).
  - Records every contributing provider's exact playback URL in `network.mirrorUrls` and groups channels by `(channelName, language.code)` in `summary.mirrorGroups`.
  - Normalizes scraper-polluted channel titles into canonical broadcast networks (`Willow Cricket HD`, `Sky Sports Main Event`, `Sony LIV`, `TNT Sports 1`, `Star Sports 1 Hindi`, `Amazon Prime Video`, `beIN Sports English`, etc.) with URL-assisted fallback inference.
  - Detects **17 broadcast languages** from stream titles and URL paths (`eng`, `hin`, `tam`, `tel`, `kan`, `ben`, `mal`, `mar`, `guj`, `pun`, `urd`, `spa`, `ara`, `fra`, `por`, `deu`, `ita`, `rus`).
  - Extracts ClearKey DRM (`kid:key`, hex/URL-encoded query params), unwraps MediaFlow/HLS bridge URLs (`directOriginUrl`), and computes player compatibility hints (`hls.js`, `shaka-player`, `mpegts.js`, `native`).
- **Two-Tier Edge Caching + Stale-While-Revalidate**: Sub-5ms warm catalog responses via pre-indexed in-memory snapshots (`BaseCatalogSnapshot`), L1 isolate memory cache, and L2 Cloudflare PoP `caches.default`.
- **SSRF-Hardened Stream Proxy (`/api/proxy`)**: Injects custom `User-Agent`, `Referer`, `Origin`, and `Range` headers and optionally rewrites relative `.m3u8` segment URLs while blocking RFC 1918, loopback, link-local, CGNAT, IPv6 ULA, and cloud metadata targets.

---

## 2. System Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │         Client / Player Application          │
                         └──────────────────────┬───────────────────────┘
                                                │ HTTPS (GET / HEAD / OPTIONS)
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                         Playify Edge Worker (Hono v4 Router)                          │
│  • Security & Tracing Headers (X-Worker-Version: 1.0.0, X-Request-Id, X-Response-Time)│
│  • Zero-Allocation Float64Array RingBuffer Telemetry (p50 / p95 / p99 per route)      │
├───────────────────────────────────────────────┬───────────────────────────────────────┤
│          Two-Tier Edge Cache Layer            │         SSRF-Hardened Proxy           │
│  • L1: Bounded Isolate Memory (500 entries)   │  • Header Masquerading (UA/Referer)   │
│  • L2: Cloudflare PoP Cache API               │  • M3U8 Relative Segment Rewriting    │
│  • BaseCatalogSnapshot SWR (45s soft / 5m)    │  • RFC 1918 / IPv6 / Metadata Guard   │
└───────────────────────┬───────────────────────┴───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                     Federation & Reconciliation Core (Aggregator)                     │
│  1. Normalizer & 18-Sport Classifier       4. StreamDeduplicator & Mirror Grouping    │
│  2. EventIdentityEngine (Format/Stage/Age) 5. ChannelNormalizer & 17-Lang Detector    │
│  3. ReconciliationEngine (Zero-Loss Audit) 6. DrmDetector & HlsInspector              │
└───────────────────────┬───────────────────────────────────────────────────────────────┘
                        │ Concurrent Promise.allSettled + Coalescing + Speculative Race
                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                          6 Federated Upstream Sports Catalogs                         │
│   [SportzX]     [PlayZ TV]     [LivXow]     [SKTech]     [PlayFy]     [Cricify]       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Folder Structure

```
├── src/
│   ├── index.ts                     # Hono router, middleware, OpenAPI 3.1.0 spec & 23 endpoints
│   ├── core/
│   │   ├── cache.ts                 # L1 isolate memory + L2 Cloudflare Cache API manager
│   │   ├── channel-normalizer.ts    # Broadcaster normalization & URL-assisted inference
│   │   ├── deduplicator.ts          # Lossless stream deduplication, language & mirror grouping
│   │   ├── drm.ts                   # ClearKey DRM extraction (kid:key & query params)
│   │   ├── event-identity.ts        # Format, match #, stage, gender & age-group discriminator
│   │   ├── hls-inspector.ts         # #EXT-X-STREAM-INF master playlist rendition parser
│   │   ├── normalizer.ts            # 18-sport classifier, team aliases & fixture cascading
│   │   ├── proxy.ts                 # SSRF-hardened CORS & header masquerading stream proxy
│   │   ├── reconciliation.ts        # Confidence scoring & zero-loss reconciliation engine
│   │   └── telemetry.ts             # Float64Array circular ring buffer latency tracker
│   ├── providers/
│   │   ├── aggregator.ts            # Multi-provider catalog & stream orchestration
│   │   └── upstream-client.ts       # Speculative dual-host racing, circuit breaker & LRU cache
│   └── types/
│       ├── catalog.types.ts         # UnifiedFixture, CatalogResponse & discovery contracts
│       ├── stream.types.ts          # UnifiedStream, MirrorGroup, DRM & audit contracts
│       └── upstream.types.ts        # Base64 cnc: ID decoder, mojibake repair & schema validation
├── test/                            # 15 Vitest suites (94 unit, regression, fuzz & benchmark tests)
├── package.json
├── tsconfig.json
└── wrangler.toml
```

---

## 3. Provider Federation Details

Playify Edge queries six live sports providers concurrently across redundant upstream hosts (`https://cncverse.dpdns.org/u/p_ai41ykrzepbq` and `https://cncverse.pages.dev/u/p_ai41ykrzepbq`):

| Provider Key | Catalog ID | Display Name | Primary Strengths |
| :--- | :--- | :--- | :--- |
| `sportzx` | `cnc_SportzXLiveEvents_tv` | **SportzX** | Broadest global coverage (Football, Cricket, NBA, NBL, NHL, NFL, Combat, Motorsport) |
| `playztv` | `cnc_PlayZTVLiveEvents_tv` | **PlayZ TV** | High-bitrate FHD/1080p bridged streams, rich SofaScore logos & country flags |
| `livxow` | `cnc_LivXowLiveEvents_tv` | **LivXow** | Multi-resolution adaptive renditions (`1080p`, `720p`, `540p`, `396p`) & European football |
| `sktech` | `cnc_SKTechLiveEvents_tv` | **SKTech** | Regional Indian & South Asian cricket feeds (`Hindi`, `Tamil`, `Telugu`, `Kannada`, `Urdu`) |
| `playfy` | `cnc_PlayFyLiveEvents_tv` | **PlayFy** | Redundant ClearKey DASH/HLS mirrors on AIV/Akamai CDNs & dedicated league channels |
| `cricify` | `cnc_CricifyLiveEvents_tv` | **Cricify** | Premier international & domestic cricket coverage with rich competition metadata |

### Speculative Racing & Circuit Breaker Isolation

- **Speculative Dual-Host Racing**: `UpstreamClient` dispatches requests to the primary host and triggers a hedged parallel request to the secondary host if the primary does not respond within `1800ms` (catalogs) or `1500ms` (streams), or immediately upon primary error.
- **Circuit Breaker**: Hosts recording 3 consecutive failures transition to `open` state for `60,000ms` before entering a `half-open` trial state.
- **In-Flight Request Coalescing**: Concurrent requests for the same catalog or stream ID share a single in-flight Promise, preventing thundering-herd spikes against upstream origins.

---

## 4. Extraction & Continuous Reconciliation Engine

Every catalog build executes a deterministic 3-pass reconciliation pipeline tracked by `ReconciliationEngine`:

1. **Base64 `cnc:` Payload Decoding & Mojibake Repair**:
   - Decodes embedded JSON metadata inside `cnc:<base64>` raw IDs (`eventInfo`, `formats`, `startTime`, `endTime`, `poster`).
   - Repairs double-encoded UTF-8 sequences (e.g., `Ã©` → `é`, `â€¢` → `•`).
   - Collapses self-referential upstream noise titles (`"GOLF EVENTOS vs GOLF EVENTOS"` → `"GOLF EVENTOS"`).
2. **Pass 0 — Canonical Key Generation (`exact_canonical_key`)**:
   - Normalizes team names across 170+ international country codes, club prefixes (`1. FC`, `VfL`, `CD`, `UD`), and pro franchise mascots (`76ers` → `Philadelphia 76ers`, contextual `Kings` → `Los Angeles Kings` in NHL vs `Sacramento Kings` in NBA).
   - Sorts team slugs alphabetically (`teamA` vs `teamB` symmetry) so reversed Home/Away listings across providers produce the exact same key:
     `{sportCategory}::{firstTeamSlug}::{secondTeamSlug}[::{discriminator}]::{YYYY-MM-DD}[::s{6hSlot}]`
3. **Pass 1 — Dateless Match Reconciliation (`nodate_reconciliation`)**:
   - Reconciles provider items lacking a start timestamp (`::nodate`) into an existing dated cluster for the same normalized team pair and discriminator.
4. **Pass 2 — Multi-Signal Cross-Format & Near-Time Reconciliation**:
   - Reconciles candidate clusters sharing the exact normalized team pair within a **4-hour start-time window** when their `EventIdentity` attributes are compatible (`cross_format_reconciliation` and `near_time_reconciliation`).
   - Records every prevented false merge (`CONFLICTING_FORMAT`, `CONFLICTING_MATCH_NUMBER`, `CONFLICTING_STAGE`, `CONFLICTING_AGE_GROUP`, `CONFLICTING_GENDER`, `EXCEEDED_TIME_WINDOW`, `INCOMPATIBLE_SPORT`) in `/api/reconciliation`.
5. **Multi-Entry Provider Preservation (`providerRawIds`)**:
   - When a single provider lists multiple separate catalog cards for the same match (e.g., separate Hindi and English entries, or a main feed plus a backup entry), `providerRawIds[providerKey]` preserves **all** raw IDs so stream extraction queries every underlying feed without loss.

---

## 5. Stream Intelligence & Lossless Deduplication

When `/api/stream/:fixtureKey` is queried, `StreamDeduplicator` processes all candidate streams across every matched provider:

- **Exclusion Audit (`summary.audit`)**: Filters donation banners (`DONATION_SPAM`), empty URLs (`MISSING_URL`), non-HTTP schemes (`INVALID_SCHEME`), and non-playable JSON API endpoints (`NON_MEDIA_URL`) with full per-provider accounting.
- **Quality-Preserving URL Fingerprinting**:
  - Strips ephemeral CDN tokens (`token`, `expires`, `session`, `auth`, `sig`, `hmac`, `hdnea`, `hdnts`, `policy`, `h_*`).
  - Unifies equivalent Amazon/AIV CDN edge hostnames (`otte.cache.aiv-cdn.net` and `otte.live.fly.ww.aiv-cdn.net` → `otte.aiv-cdn.net`).
  - **Strictly preserves** resolution qualifiers (`::h1080`, `::h720`, `::h540`, `::h396`) and ClearKey prefixes (`::ck_<kid>`) so distinct quality renditions are never collapsed into one.
- **Lossless Mirror URL Tracking (`network.mirrorUrls`)**: When multiple providers supply the same underlying stream or equivalent CDN edge host, all provider URLs are preserved in `stream.network.mirrorUrls` while `provenance` upgrades to `Multi-Source`.
- **URL-Assisted Broadcaster Normalization**: `ChannelNormalizer` strips scraper tags, emojis, and bitrate prefixes into canonical network names and groups. When a provider labels a feed only by language (e.g., `"HINDI 🇮🇳"`), it inspects the CDN hostname (`sonymtmnew` / `slivcdn.com` → `Sony LIV`, `fancode` → `FanCode`, `tapmad.com` → `Tapmad Live`, `tamashaweb.com` → `Tamasha Live`) or labels generic language feeds as `"Live Broadcast (Hindi)"`.
- **HLS Master Playlist Inspection (`HlsInspector`)**: Pre-parses `#EXT-X-STREAM-INF` tags on adaptive HLS master playlists (with a 2,500ms timeout and 5-minute LRU cache) to expose real codec, bandwidth, frame rate, and resolution ladders.

---

## 6. Caching & Performance Architecture

| Layer | Mechanism | TTL / Capacity | Purpose |
| :--- | :--- | :--- | :--- |
| **Base Catalog Snapshot** | In-memory pre-indexed `BaseCatalogSnapshot` | `45s` soft TTL / `300s` hard TTL (SWR) | Serves `/api/catalog`, `/api/live`, `/api/timeline`, `/api/search`, `/api/competitions`, `/api/teams`, `/api/broadcasters` in **<5ms** on warm requests |
| **Secondary Indexes** | `bySportMap`, `searchHaystacks`, `fixtureIndex` | `2,500` bounded LRU entries | O(1) sport filtering, pre-tokenized search matching, and instant fixture/stream lookup by `fixtureId`, `canonicalKey`, or raw `cnc:` ID |
| **L1 Isolate Cache** | `EdgeCache` in-memory `Map` | `500` entries (`15s` live / `30s` streams) | Zero-serialization response clone within the same Worker isolate |
| **L2 PoP Cache** | Cloudflare `caches.default` | `15s - 60s` + `stale-while-revalidate` | Shared edge PoP cache with `X-Edge-Cache: HIT-L1` / `HIT-L2` / `MISS` diagnostics |
| **Hot Stream Cache** | `UpstreamClient.streamCache` | `25s` TTL / `250` LRU entries | Eliminates redundant upstream `/stream/tv/{id}.json` fetches across filter queries |
| **Stale Fallback** | `lastGoodCatalogResponse` | Retained across upstream 503s | Continues serving last verified catalog if all upstream hosts enter maintenance |

---

## 7. Complete Endpoint Reference

All responses include `X-Worker-Version: 1.0.0`, `X-Response-Time-Ms`, `X-Request-Id`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Access-Control-Allow-Origin: *`.

| Method | Endpoint | Description | Cache TTL |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Root service discovery, provider list, and endpoint map | Dynamic |
| `GET` | `/health` | Edge PoP location (`colo`, `country`, `city`), cache stats, and latency telemetry | Dynamic |
| `GET` | `/api/openapi.json` | Complete OpenAPI 3.1.0 machine-readable specification | Static |
| `GET` | `/api/sports` | All 18 canonical sport facets with live, upcoming, and ended match counts | `30s` |
| `GET` | `/api/catalog` | Unified multi-provider catalog with rich filtering, search, sorting & pagination | `15s` (live) / `60s` |
| `GET` | `/api/catalog/:sport` | Sport-scoped unified catalog (supports aliases like `soccer`, `nba`, `nbl`, `ucl`, `f1`, `ufc`, `ipl`) | `15s` (live) / `60s` |
| `GET` | `/api/live` | Dedicated Live Center returning all currently live events grouped by sport | `15s` |
| `GET` | `/api/upcoming` | Chronological upcoming schedule grouped by UTC date (`YYYY-MM-DD`) | `30s` |
| `GET` | `/api/schedule` | Alias for `/api/upcoming` | `30s` |
| `GET` | `/api/timeline` | Chronological EPG timeline buckets (`live_now`, `starting_soon_2h`, `later_today`, `tomorrow`, `upcoming_later`) | `15s` |
| `GET` | `/api/competitions` | Aggregated tournaments/leagues with live counts, sample teams & provider coverage | `30s` |
| `GET` | `/api/tournaments` | Alias for `/api/competitions` | `30s` |
| `GET` | `/api/competitions/:id` | Single competition detail & full fixture list by ID (`tourn_...`) or slug | Dynamic |
| `GET` | `/api/tournaments/:id` | Alias for `/api/competitions/:id` | Dynamic |
| `GET` | `/api/teams` | Aggregated teams & pro franchises with live/upcoming counts & active competitions | `30s` |
| `GET` | `/api/teams/:id` | Single team detail & schedule by ID (`team_...`), slug, or 3-letter code (`ind`, `ars`) | Dynamic |
| `GET` | `/api/broadcasters` | Canonical broadcast networks (`Willow`, `Sky Sports`, `Sony LIV`, etc.) & coverage stats | `30s` |
| `GET` | `/api/channels` | Alias for `/api/broadcasters` | `30s` |
| `GET` | `/api/broadcasters/:id` | Single broadcaster detail & fixtures by ID (`broadcaster_...`) or channel slug | Dynamic |
| `GET` | `/api/channels/:id` | Alias for `/api/broadcasters/:id` | Dynamic |
| `GET` | `/api/search` | Multi-entity search across Fixtures, Teams, Competitions, and Broadcasters | `20s` |
| `GET` | `/api/fixture/:id` | Direct fixture lookup by `fixtureId`, `canonicalKey`, or raw `cnc:...` ID (`?includeStreams=true`) | Dynamic |
| `GET` | `/api/fixtures/:id` | Alias for `/api/fixture/:id` | Dynamic |
| `GET` | `/api/stream/:fixtureKey` | Unified stream studio with deduplicated feeds, renditions, DRM keys & mirror groups | `30s` |
| `GET` | `/api/streams/:fixtureKey`| Alias for `/api/stream/:fixtureKey` | `30s` |
| `GET` | `/api/reconciliation` | Full source-to-output reconciliation audit, per-provider accounting & merge decisions | Dynamic |
| `GET` | `/api/providers` | Per-provider health, latency telemetry, circuit breaker states & coalescing metrics | Dynamic |
| `GET` | `/api/stats` | Platform observability, L1/L2 cache hit ratio, route p50/p95/p99 latencies & sport distribution | Dynamic |
| `GET` | `/api/diagnostics` | Alias for `/api/stats` | Dynamic |
| `GET` | `/api/proxy` | SSRF-hardened stream header masquerading & optional M3U8 segment URL rewrite proxy | Passthrough |

---

## 8. Query Parameters & Filtering Guide

### `/api/catalog` and `/api/catalog/:sport`

| Parameter | Type | Allowed / Example Values | Description |
| :--- | :--- | :--- | :--- |
| `sport` | `string` | `all`, `cricket`, `football`, `basketball`, `combat`, `motorsport`, `tennis`, `hockey`, `american_football`, `golf`, `rugby`, etc. (plus aliases `nba`, `nbl`, `nfl`, `nhl`, `ufc`, `f1`, `ucl`, `ipl`) | Filter by canonical sport category or league alias |
| `phase` | `string` | `active` (default: live + upcoming), `live`, `upcoming`, `ended`, `all` | Filter by match lifecycle phase |
| `search` / `q` | `string` | `India`, `Arsenal`, `Champions League`, `Willow` | Multi-token search across teams, codes, titles, tournaments, stage, and broadcasters |
| `kind` | `string` | `match`, `tournament_channel`, `show` | Filter by event structure |
| `tournament` | `string` | `tourn_premier-league` or `Premier League` | Filter by competition ID or name substring |
| `provider` | `string` | `sportzx`, `playztv`, `livxow`, `sktech`, `playfy`, `cricify` | Filter fixtures available on a specific provider |
| `broadcaster` / `channel` | `string` | `Willow`, `Sky Sports`, `Sony LIV`, `Amazon Prime` | Filter fixtures carrying a specific broadcaster |
| `language` / `lang` | `string` | `English`, `Hindi`, `Tamil`, `Spanish`, `hin`, `eng` | Filter fixtures by available commentary language |
| `minProviders` | `integer` | `1` to `6` (e.g. `minProviders=3`) | Return only fixtures verified by at least `N` providers |
| `hot` | `boolean` | `true` / `1` | Filter high-demand / pinned marquee fixtures |
| `date` | `string` | `YYYY-MM-DD` (e.g. `2026-11-12`) | Filter fixtures starting on a specific UTC date |
| `sort` | `string` | `default`, `time_asc`, `time_desc`, `popularity`, `smart`, `title_asc` | Sort order (`popularity`/`smart` ranks live multi-provider matches first) |
| `limit` | `integer` | `1` to `500` | Enable pagination with page size `limit` |
| `page` | `integer` | `>= 1` (default `1`) | Page number when `limit` is specified |
| `offset` | `integer` | `>= 0` | Explicit item offset (overrides `page`) |

### `/api/stream/:fixtureKey` and `/api/streams/:fixtureKey`

| Parameter | Type | Allowed / Example Values | Description |
| :--- | :--- | :--- | :--- |
| `language` | `string` | `eng`, `hin`, `tam`, `tel`, `spa`, `Hindi`, `English` | Filter streams by ISO 639-2 code or language name |
| `quality` | `string` | `4K`, `1080p`, `720p`, `576p`, `540p`, `480p`, `396p`, `360p`, `Auto` | Filter by resolution variant |
| `protocol` | `string` | `hls`, `dash`, `mp4` | Filter by transport protocol |
| `provider` | `string` | `sportzx`, `playztv`, `livxow`, `sktech`, `playfy`, `cricify` | Filter streams originating from or mirrored by a provider |
| `channel` | `string` | `Willow`, `Sky Sports`, `Star Sports`, `TNT Sports` | Filter by canonical channel name or broadcast group |
| `tier` | `string` | `primary`, `secondary`, `tertiary` | Filter by stream priority tier |
| `playableOn` | `string` | `web_hls`, `all` | Filter streams directly playable in browser `hls.js` without ClearKey |
| `drmFree` | `boolean` | `true` / `1` | Exclude streams requiring ClearKey DRM decryption |
| `inspect` | `boolean` | `true` (default) / `false` | Toggle live `#EXT-X-STREAM-INF` master playlist rendition inspection |

### `/api/proxy`

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` (required) | Target HTTP/HTTPS playlist or media segment URL |
| `referer` | `string` (optional) | Custom `Referer` header injected into upstream request (or via `X-Target-Referer`) |
| `origin` | `string` (optional) | Custom `Origin` header injected into upstream request (or via `X-Target-Origin`) |
| `ua` | `string` (optional) | Custom `User-Agent` header injected into upstream request (or via `X-Target-User-Agent`) |
| `rewrite` | `boolean` (`true` / `1`) | Rewrites relative and absolute URLs inside `.m3u8` playlists to route through `/api/proxy` |

---

## 9. Verified Request & Response Examples

### 1. Unified Catalog (`GET /api/catalog?sport=football&phase=live&limit=1`)

```json
{
  "status": "success",
  "apiVersion": "1.0.0",
  "timestamp": "2026-11-12T12:45:30.000Z",
  "edge": {
    "region": "BOM",
    "cacheControl": "public, max-age=15, stale-while-revalidate=30",
    "executionTimeMs": 4
  },
  "facets": {
    "activeSportFilter": "football",
    "activePhaseFilter": "live",
    "totalLiveMatches": 42,
    "totalUpcomingMatches": 95,
    "totalEndedMatches": 14,
    "sports": [
      {
        "id": "all",
        "label": "All Sports",
        "icon": "🌐",
        "liveCount": 42,
        "totalCount": 137,
        "upcomingCount": 95,
        "endedCount": 14
      }
    ]
  },
  "pagination": {
    "totalItems": 18,
    "returnedItems": 1,
    "page": 1,
    "limit": 1,
    "totalPages": 18,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "reconciliation": {
    "totalProvidersQueried": 6,
    "healthyProvidersCount": 6,
    "totalRawItemsExtracted": 377,
    "totalExcludedInvalidItems": 0,
    "totalUnifiedFixtures": 151,
    "activeUnifiedFixtures": 137,
    "endedUnifiedFixtures": 14,
    "multiProviderFixturesCount": 80,
    "deduplicatedItemsMerged": 226,
    "reconciledCrossFormatCount": 5,
    "reconciledNearTimeCount": 2,
    "reconciledNoDateCount": 0,
    "reversedHomeAwayResolvedCount": 0,
    "preventedFalseMergesCount": 3,
    "averageMergeConfidence": 0.93,
    "unmappedRawItemsCount": 0
  },
  "fixtures": [
    {
      "fixtureId": "fix_football-arsenal-barcelona-w-2026-11-12-s2",
      "canonicalKey": "football::arsenal::barcelona::w::2026-11-12::s2",
      "sport": "Football",
      "sportCategory": "football",
      "phase": "live",
      "kind": "match",
      "isHotMatch": true,
      "title": "Barcelona vs Arsenal",
      "tournament": {
        "id": "tourn_uefa-womens-champions-league",
        "name": "UEFA Women's Champions League",
        "shortName": "UEFA Women's Champions...",
        "category": "Football",
        "logo": "https://img.sofascore.com/api/v1/unique-tournament/..."
      },
      "teams": {
        "home": {
          "id": "team_barcelona",
          "name": "Barcelona",
          "code": "BAR",
          "logo": "https://..."
        },
        "away": {
          "id": "team_arsenal",
          "name": "Arsenal",
          "code": "ARS",
          "logo": "https://..."
        }
      },
      "schedule": {
        "startTimeUtc": "2026-11-12T17:45:00.000Z",
        "status": "live",
        "liveBadgeText": "LIVE NOW",
        "isLive": true
      },
      "streamMetadata": {
        "totalWorkingFeeds": 6,
        "availableLanguages": ["English", "Spanish"],
        "maxResolution": "1080p FHD",
        "primaryBroadcasters": ["DAZN HD", "TNT Sports 1"]
      },
      "eventDetails": {
        "gender": "women"
      },
      "providerPointers": {
        "sportzx": "cnc:...",
        "playztv": "cnc:...",
        "livxow": "cnc:...",
        "sktech": "cnc:...",
        "playfy": "cnc:...",
        "cricify": "cnc:..."
      },
      "providerCount": 6,
      "mergeConfidence": 0.99,
      "mergeSignals": [
        "normalized_team_pair_match",
        "sport_category_match",
        "start_time_proximity_within_2h",
        "tournament_context_present",
        "multi_provider_consensus_3plus"
      ]
    }
  ]
}
```

### 2. Unified Stream Studio (`GET /api/stream/cricket::nepal-premier-league::tournament`)

```json
{
  "status": "success",
  "apiVersion": "1.0.0",
  "fixtureId": "cricket::nepal-premier-league::tournament",
  "canonicalKey": "cricket::nepal-premier-league::tournament",
  "generatedAt": "2026-11-12T12:45:35.000Z",
  "edge": {
    "region": "BOM",
    "cached": true,
    "ttlSeconds": 30
  },
  "totalStreams": 17,
  "availableResolutions": ["1080p", "Auto", "720p", "540p", "396p"],
  "summary": {
    "totalProvidersQueried": 6,
    "totalRawStreamsFound": 33,
    "deduplicatedStreamsCount": 17,
    "recommendedDefaultStreamId": "feed_4a8b91c2",
    "availableLanguages": ["English", "Hindi"],
    "availableQualities": ["1080p", "Auto", "720p", "540p", "396p"],
    "channelGroups": ["Star Sports", "FanCode", "Willow", "General Sports"],
    "mirrorGroups": [
      {
        "channelName": "Star Sports HD",
        "channelGroup": "Star Sports",
        "language": { "code": "eng", "name": "English", "badge": "ENG" },
        "recommendedStreamId": "feed_4a8b91c2",
        "totalMirrors": 3,
        "providers": ["sportzx", "playztv", "livxow", "playfy"],
        "qualities": ["1080p", "720p", "396p"],
        "hasDrm": true,
        "streamIds": ["feed_4a8b91c2", "feed_7c1d20a1", "feed_19f0b3e4"]
      }
    ],
    "audit": {
      "totalRawStreams": 33,
      "validStreamsCount": 17,
      "excludedStreamsCount": 1,
      "exclusions": [
        {
          "reason": "DONATION_SPAM",
          "provider": "livxow",
          "details": "Filtered donation ad banner or non-media promotional candidate"
        }
      ]
    }
  },
  "streams": [
    {
      "streamId": "feed_4a8b91c2",
      "channelName": "Star Sports HD",
      "channelGroup": "Star Sports",
      "priorityTier": "primary",
      "reliabilityScore": 98,
      "sourceConfidence": 0.99,
      "confidenceTier": "high",
      "qualityVariant": "1080p",
      "language": { "code": "eng", "name": "English", "badge": "ENG" },
      "protocol": "hls",
      "drm": {
        "type": "clearkey",
        "keys": [
          {
            "kid": "1779c27b9d077a3ba0c9cc1bb9a94b9f",
            "key": "cc5ab0ce799d09b73cad4b2ded3b7bbd"
          }
        ]
      },
      "network": {
        "masterPlaylistUrl": "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2F...&maxh=1080",
        "directOriginUrl": "https://otte.cache.aiv-cdn.net/...",
        "isBridgedStream": true,
        "mirrorUrls": [
          { "providerKey": "sportzx", "providerName": "SportzX", "url": "http://129.225.106.195/d/master.m3u8?..." },
          { "providerKey": "playfy", "providerName": "PlayFy", "url": "http://129.225.106.195/d/master.m3u8?..." }
        ],
        "edgeProxyFallbackUrl": "/api/proxy?url=...",
        "requiredHeaders": {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      },
      "playbackHints": {
        "webHlsCompatible": true,
        "directDashAvailable": true,
        "requiresClearKey": true,
        "requiresCustomHeaders": false,
        "recommendedPlayer": "hls.js"
      },
      "provenance": {
        "originProvider": "sportzx",
        "originProviderName": "SportzX",
        "mirroredBy": ["playztv", "livxow", "playfy"],
        "isExclusive": false,
        "isMultiSource": true,
        "attributionBadge": "Multi-Source (SportzX + 3 Mirrors)"
      }
    }
  ]
}
```

---

## 10. Error Handling & Status Codes

All error responses adhere to a standardized RFC 7807-inspired JSON structure:

```json
{
  "status": "error",
  "error": {
    "code": "FIXTURE_NOT_FOUND",
    "message": "Fixture not found: unknown_id",
    "id": "unknown_id",
    "timestamp": "2026-11-12T12:45:00.000Z"
  }
}
```

| HTTP Status | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `200 OK` | — | Successful catalog, stream, discovery, reconciliation, or health response |
| `204 No Content` | — | Successful CORS `OPTIONS` preflight response |
| `400 Bad Request` | — | Missing/malformed `url` on `/api/proxy` or blocked internal/private SSRF target host |
| `404 Not Found` | `NOT_FOUND` / `FIXTURE_NOT_FOUND` / `COMPETITION_NOT_FOUND` / `TEAM_NOT_FOUND` / `BROADCASTER_NOT_FOUND` | Unknown route or non-existent entity ID |
| `500 Internal Server Error` | `INTERNAL_SERVER_ERROR` | Unhandled runtime exception caught by global error boundary |
| `502 Bad Gateway` | — | Upstream media server unreachable or timed out (`>12,000ms`) during `/api/proxy` fetch |
| `503 Service Unavailable` | `RECONCILIATION_UNAVAILABLE` | Upstream catalogs completely unreachable on cold start with no cached snapshot |

---

## 11. Security & SSRF Hardening

- **Comprehensive SSRF Prevention (`StreamProxy.isSafeTargetUrl`)**:
  - Enforces `http:` and `https:` schemes only.
  - Blocks URLs containing embedded credentials (`username` or `password`).
  - Blocks loopback (`localhost`, `127.0.0.0/8`, `[::1]`, `[::ffff:127.x.x.x]`, `0.0.0.0/8`).
  - Blocks RFC 1918 private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Blocks RFC 6598 Carrier-Grade NAT (`100.64.0.0/10`) and link-local (`169.254.0.0/16`, `fe80::/10`).
  - Blocks IPv6 Unique Local Addresses (`fc00::/7`, `fd00::/8`) and IPv4-mapped private IPv6 literals.
  - Blocks cloud metadata services (`169.254.169.254`, `100.100.100.200`, `metadata.google.internal`, `metadata`) and `.internal`, `.local`, `.localhost`, `.arpa`, and single-label/numeric-encoded hostnames.
- **Security Headers**: Every response sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`, and strips upstream `content-security-policy` headers on proxied media chunks.
- **Bounded Resource Allocation**: All in-memory caches and telemetry buffers have strict upper bounds (`EdgeCache`: 500 entries; `fixtureIndex`: 2,500 entries; `streamCache`: 250 entries; `HlsInspector`: 300 entries; `EdgeTelemetry`: 40 routes × 128 Float64 samples) preventing memory exhaustion under high concurrency.

---

## 12. Setup, Development & Deployment

### Prerequisites

- **Node.js** `>= 18.x` (or `>= 20.x` recommended)
- **npm** `>= 9.x`
- **Cloudflare Wrangler CLI** (`^3.86.0`, included in `devDependencies`)

### Installation

```bash
npm install
```

### Local Development Server (Port 3000)

```bash
npm run dev
```

Starts `wrangler dev --port 3000 --ip 0.0.0.0` with hot reload at `http://localhost:3000`.

### Production Bundle Build

```bash
npm run build
```

Bundles `src/index.ts` into `dist/index.js` (`~280 KB` ESM bundle, `ES2022` target) via `esbuild`.

### Deploy to Cloudflare Workers

```bash
npm run deploy
```

Publishes `playify-edge-worker` (`v1.0.0`) to Cloudflare's global edge network via `wrangler deploy`.

---

## 13. Configuration & Environment

Configuration is managed in `wrangler.toml`:

```toml
name = "playify-edge-worker"
main = "src/index.ts"
compatibility_date = "2024-11-06"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true
```

No external secrets or paid bindings (KV/Durable Objects/D1) are required—all caching and reconciliation run zero-cost inside the Worker isolate and Cloudflare PoP Cache API.

---

## 14. Testing, Auditing & Benchmarking

Playify Edge ships with **15 Vitest test suites (94 tests)** covering unit logic, cross-provider reconciliation regressions, lossless stream deduplication, schema validation, fuzzing, and concurrency benchmarks:

```bash
# Run all 15 test suites (94 tests)
npm test

# Run strict TypeScript typechecking
npm run typecheck

# Run linter / static check
npm run lint

# Build production ESM bundle
npm run build
```

### Test Suite Breakdown

- `test/normalizer.test.ts` — Team aliases, symmetry, 18-sport classification, `NBL` basketball, `X vs X` self-referential cleanup, and tournament clustering.
- `test/reconciliation-regression.test.ts` — Multi-provider reconciliation, Home/Away reversal, cross-format/stage/age-group separation, and `unmappedRawItemsCount === 0` invariant.
- `test/deduplicator.test.ts` — Spam exclusion, URL token stripping, equivalent AIV CDN host unification, and lossless `mirrorUrls`.
- `test/lossless-deduplication.test.ts` — Preservation of distinct quality variants (`1080p` vs `720p`), multi-language URL paths, and ClearKey DRM upgrade.
- `test/channel-normalizer.test.ts` — Multi-line Stremio tag extraction, bitrate/resolution token stripping, and URL-assisted broadcaster detection.
- `test/event-identity.test.ts` — Format, match number, stage, gender, and age-group discriminator compatibility.
- `test/advanced-endpoints.test.ts` — Pagination, sorting, `/api/live`, `/api/upcoming`, `/api/timeline`, `/api/competitions`, `/api/teams`, `/api/broadcasters/:id`, raw `cnc:` lookup, and RFC 1918/IPv6 SSRF protection.
- `test/concurrency-benchmark.test.ts` — 50-request concurrent burst coalescing and sub-5ms warm query benchmarks.
- `test/fuzz.test.ts` — Property-based fuzzing against malformed payloads, mojibake, and injection strings.

---

## 15. Usage Examples & Troubleshooting

### Quick cURL Examples

```bash
# 1. Fetch live Cricket matches
curl -s "http://localhost:3000/api/catalog?sport=cricket&phase=live" | jq .

# 2. Fetch fixtures broadcast on Willow or Sky Sports with at least 2 confirming providers
curl -s "http://localhost:3000/api/catalog?broadcaster=Willow&minProviders=2" | jq .

# 3. Search across fixtures, teams, competitions, and broadcasters
curl -s "http://localhost:3000/api/search?q=Barcelona" | jq .

# 4. Fetch web-playable HLS streams for a fixture
curl -s "http://localhost:3000/api/stream/football::arsenal::barcelona::w::2026-11-12::s2?playableOn=web_hls" | jq .

# 5. Verify zero-loss reconciliation audit
curl -s "http://localhost:3000/api/reconciliation" | jq .summary
```

### Troubleshooting

- **Stream returns `403 Forbidden` when played directly in the browser**:
  Check `stream.playbackHints.requiresCustomHeaders`. Browsers cannot set custom `Referer` or `User-Agent` headers on `<video>` tags directly—use `stream.network.edgeProxyFallbackUrl` (`/api/proxy?url=...&referer=...&rewrite=true`) so the Edge Worker injects the required headers and rewrites `.m3u8` segments automatically.
- **Stream has `drm.type === "clearkey"`**:
  - If `stream.network.isBridgedStream === true`, the `masterPlaylistUrl` is already wrapped by an HLS decryptor bridge (`playbackHints.webHlsCompatible === true`) and plays directly in `hls.js`.
  - If `stream.protocol === "dash"` (or using `stream.network.directOriginUrl`), configure `shaka-player` with `drm.clearKeys: { [kid]: key }` from `stream.drm.keys`, or pass `?drmFree=true` / `?playableOn=web_hls` to `/api/stream/:fixtureKey`.

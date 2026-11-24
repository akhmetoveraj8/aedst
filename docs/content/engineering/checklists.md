---
title: "Roadmap coverage"
description: "roadmap.sh Frontend Performance, Backend Performance, SEO and API Design, item by item: the rule, the gate that enforces it, and an honest status."
---

# Roadmap coverage

The four roadmap.sh checklists the owner adopted, item by item. Sources:
[frontend performance](https://roadmap.sh/frontend-performance-best-practices),
[backend performance](https://roadmap.sh/backend-performance-best-practices),
[SEO](https://roadmap.sh/seo), [API design](https://roadmap.sh/api-design).

Status values, from an audit of the code on 2026-11-21:

- **gated**: a check fails CI or the build when the item is broken.
- **implemented**: the code or the framework does it, nothing fails if it regresses.
- **rule only**: written in a rule page, nothing in code or CI.
- **missing**: neither rule-enforced nor implemented.

An agent treats every row as a rule for new code, whatever its status. When you close a gap, change the
status here in the same change. Rules in full: [performance](/engineering/performance),
[api-design](/engineering/api-design), [SEO by project](/web/seo-by-project),
[accessibility](/engineering/accessibility).

## Frontend performance

Each project has a `bundle-budget.json` checked by `apps/web/shared/scripts/check-bundle-size.mjs`
(`pnpm check:bundle`); `app` and `marketing` also have a `lighthouserc.json`. The gates run in `web-ci.yml`,
`marketing-ci.yml` and `admin-ci.yml`. "gated" below means all three projects unless a row names fewer
(`admin` is a signed-in SPA and has no Lighthouse run). No workflow has run on GitHub yet; what ran
locally, with the Lighthouse numbers per run, is in [status](/status).

| Item | Rule for new code | Status |
|---|---|---|
| Page weight under 1500 KB (ideal under 500 KB) | Per-route first-load budget; total transfer budget per page | gated: JS, CSS and fonts per project (`check:bundle`); total page weight in Lighthouse (`resource-summary:total:size`: `app` 621 kB, `marketing` 279 kB) |
| Load under 3 s | Lighthouse LCP <= 3 s (`app`), <= 2 s (`marketing`) | gated (`app`, `marketing`) |
| TTFB under 1.3 s | Server response under 600 ms in the lab; static or cached HTML where the page is public | gated (`app`, `marketing`): `server-response-time` <= 800 ms; the lab throttling adds 563 ms of latency itself, so the server has about 240 ms |
| Gzip / Brotli | Next.js and the edge; Hono `compress()` in the admin BFF | implemented |
| Minimise HTTP requests | Same-origin only, zero third-party requests, no request waterfalls | gated (`app`, `marketing`): third-party count 0, total requests per page (`resource-summary:total:count`: `app` 38, `marketing` 14) |
| Compress images, few images, right format | `next/image` only (AVIF/WebP), SVG for icons, `priority` only on the LCP image | implemented; image transfer per public page gated at 20 kB (`resource-summary:image:size`); raw `<img>` in media thumbnails is a recorded exception |
| HTTP cache headers | Hashed assets immutable; HTML never cached with a session | implemented |
| Non-blocking JavaScript, minified JS and CSS | Framework loader only; `async`/`defer` for anything else; no inline scripts beyond the nonce'd framework ones | implemented |
| Critical CSS inline, non-blocking CSS, no inline or embedded CSS | Tailwind through `shared/ui`; no runtime CSS-in-JS; no `style` attributes with literals | implemented |
| HTTPS, same protocol | HSTS and CSP `upgrade-insecure-requests` | gated (Lighthouse best-practices) |
| No 404 requests | No dead asset URLs | gated (Lighthouse best-practices) |
| Few iframes | None | implemented (CSP `frame-src`) |
| Stylesheet complexity | One generated stylesheet per project, CSS budget | gated: CSS budget per project (`app` 36 KB, `marketing` 10.3 KB, `admin` 31.5 KB) and `resource-summary:stylesheet:size` |
| Minified HTML | Framework output | implemented |
| CDN | Static assets are CDN-cacheable; `marketing` is fully static; `app` HTML is dynamic because of the nonce CSP ([decisions/web](/decisions/web)) | implemented for assets |
| Vector over bitmap, `width`/`height` on images, no Base64 images, lazy offscreen images, images close to display size | `next/image` enforces size and lazy loading; no `data:` images in source | implemented; Base64 ban gated (`pnpm check:source`, with a negative fixture in `check:selftest`) |
| No multiple inline scripts | One nonce'd bootstrap at most | implemented |
| Dependencies up to date | Renovate, `pnpm outdated`, knip allowlist | gated (knip), Renovate has not run on GitHub yet |
| JavaScript performance problems | React Compiler, `startTransition`, virtualised lists over ~100 rows, TBT budget | TBT gated (`app`) |
| Service workers | Serwist in `app`; none in `admin` and `marketing` by decision | implemented |
| Cookie under 4096 bytes, fewer than 20 cookies | Session cookie carries the minimum; a unit test must assert byte size and count | gated: unit tests in `shared/lib/auth/session-cookies.test.ts` (`app`) and `admin/server/session.test.ts` (BFF) with realistic, oversized and over-cap tokens. An oversized value is split across at most 3 numbered cookies and a session over the cap is refused ([decisions/web](/decisions/web)); at most 13 cookies on `app` |
| Preload, preconnect | `next/font` preloads; no third-party origin to preconnect to | implemented |
| Concatenated CSS, unused CSS removed | Tailwind emits only used classes | implemented |
| WOFF2, fonts under 300 KB, no flash of invisible text | `next/font`, `display: swap`, at most two families; `admin` uses `@fontsource` | gated: font files per project (`totalFontKB` in `bundle-budget.json`) and font transfer per page (`resource-summary:font:size`: `app` 187 kB, `marketing` 98.8 kB; `marketing` preloads only the Latin subset) |
| Size of dependencies | Check cost before adding; per-route budget | gated |

## Backend performance

| Item | Rule for new code | Status |
|---|---|---|
| Caching: HTTP, server, CDN | `Cache-Control` and `ETag` on public cacheable GETs; images through imgproxy | missing for API responses (only `no-store`); images implemented |
| Cache-aside, write-through, read-through | Cache-aside in DragonflyDB with TTL for hot read-heavy data, only through `cache.Aside` | implemented and unit-tested (`platform/cache` `Aside`: TTL, `singleflight`, fail open, metrics; one use, `GetTaskStats`); gated: only `platform/cache` imports the client (2026-11-21). Not run against a real DragonflyDB |
| Cache invalidation | Explicit invalidation in the write path, in the same use case; the TTL bounds a lost invalidation | implemented for the one use (`tasks/module/stats_cache.go`, test asserts every write invalidates); rule only for future uses |
| Connection pooling and pool tuning | api, jobs and read pools; lifetime jitter; statement timeout | gated (config validation) |
| Efficient indexes | Composite, owner id first, created `CONCURRENTLY` | gated (squawk, invalid-index check) |
| ORM query tuning | No ORM; sqlc with hand-written SQL | gated (depguard) |
| Lazy, eager and batch loading | No N+1: `= ANY($1)` or a join | gated for the direct case (`architecturetest` `TestNoQueryInsideALoop`: a sqlc query called in a loop body fails unless marked `// querylint:loop-ok <reason>`, 2026-11-21); a query reached through a helper called in a loop is still review only |
| Pagination | Keyset with bounded `page_size` | gated (proto conventions test) |
| No `SELECT *` | Named columns only, `RETURNING *` included | gated (`architecturetest` `TestQueriesNameTheirColumns`, 2026-11-21) |
| Denormalisation, join optimisation | Only with `EXPLAIN` evidence in the PR | rule only |
| Cleanup and maintenance | Every growing table ships a `retention.Policy` | implemented |
| Slow-query logging | `pg_stat_statements`, `log_min_duration_statement: 500` and `auto_explain` (500 ms, `log_analyze` off) in the CloudNativePG base and in the Compose Postgres; the server reports statements over `AEDST_DATABASE_SLOW_QUERY_MS` itself (warn log with trace id, span event, `aedst_db_slow_queries`) | server side implemented and unit-tested (2026-11-21); manifests and Compose written, never applied or started (UNVERIFIED) |
| Replication | CloudNativePG, one synchronous replica, read pool | implemented in manifests, never applied to a cluster |
| Sharding | Not needed; database-per-module is the first step ([scaling](/server/scaling)) | decision |
| Database profiling tools | `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_statements` | rule only |
| Payload size limits | Read cap per mount, Protovalidate bounds | gated (arch test) |
| Response compression | Connect gzip | implemented (default, no test) |
| Minimise server work | Slow work in River jobs | gated (arch tests) |
| Background jobs and queues | River, inserted in the transaction | gated |
| Message broker between services | River events, NATS only in `natsbridge` (ADR-0021) | implemented |
| Horizontal scaling, load balancing | Stateless replicas behind the ingress | implemented in manifests |
| Streaming of large payloads | Server streaming RPC for large results ([when](/engineering/performance#streaming-and-batching)) | rule only, none needed yet: every list is keyset-paged with `page_size` <= 100, there is no export, and files go to object storage by presigned URL |
| Profiling | pprof, Pyroscope, PGO | implemented; no `default.pgo` is committed on purpose (no representative k6 profile has been recorded, [PGO](/engineering/profiling-pgo)); the build needs none |
| Algorithms and data structures, hot paths | Benchmark with before and after numbers | gated on allocations (2026-11-21): `task bench:check` and the `bench` job of `server-ci.yml` compare PR and base with benchstat and fail on an allocs/op regression over 5%; ns/op is reported only. 11 benchmarks, 8 under the gate. The CI job itself has not run yet |
| Compiled language | Go, Rust gateway | implemented |
| Service decomposition | Module extraction by configuration | implemented, never run end to end |
| Timeouts and retries | `platform/resilience`, client timeouts | gated (noctx, bodyclose) |
| Batching | Batch RPCs and `CopyFrom` ([when](/engineering/performance#streaming-and-batching)) | rule only, none needed yet: no client calls an RPC in a loop and no write inserts more than a handful of rows; the loop gate above catches the SQL side |
| Monitoring and logging | OpenTelemetry, `slog`, alerts in Helm | gated (sloglint, spancheck) |
| Asynchronous logging | `slog` handlers | implemented |
| Performance testing | k6 in CI | gated for the smoke scenario (2026-11-21): thresholds in `test/load/api.js`, no `continue-on-error`, scripts and thresholds checked with `k6 inspect` on every run; the `load` scenario is informational. UNVERIFIED: the job needs the `LOAD_OIDC_*` repository variables and has never run with them (it warns and skips k6 without) |
| Security: dependencies, authn/z, rate limiting, audits | govulncheck, OIDC, role policy, rate limiter | gated |
| Network: region, keep-alive, CDN, prefetch | Shared transport with keep-alive | implemented |

## SEO

`marketing` carries the public content and has the full set; `app` exposes sign-in only; `admin` is never
indexed. Details per project: [SEO by project](/web/seo-by-project).

| Item | Rule | Status |
|---|---|---|
| Crawlable, indexable public pages | Static rendering on `marketing`; `robots.ts`; no `noindex` on public pages | implemented |
| `robots.txt`, XML sitemap | Generated from the route table, with alternates; `admin` serves `Disallow: /` | implemented (`marketing`, `app`); `admin` route tested (2026-11-21) |
| Canonical URLs | `buildAlternates` in every public `generateMetadata` | gated on `marketing` (Playwright on the rendered HTML of every page and locale); implemented on `app` |
| hreflang for en, ru, tg, uz, ar and `x-default` | Same helper | gated on `marketing` (same spec); implemented on `app` |
| Title, meta description, headings | One `h1`, unique title and description per page and locale | gated on `marketing` (one `h1`, non-empty unique titles); placeholder guard in `app` and `marketing` (`prebuild`, enforced by the release image) |
| Structured data (JSON-LD) | Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList | gated on `marketing` (every block parses and carries the expected `@type`s) |
| Open Graph and social cards | Per-locale OG image; `og:url` equals the page canonical (`buildOpenGraph`) | gated on `marketing` (`og:url` equals the canonical in the rendered HTML; unit-tested builder) |
| Core Web Vitals | LCP <= 2 s, CLS <= 0.05, TBT <= 150 ms on `marketing` | gated in `marketing-ci.yml` (Lighthouse CI); passes on the authoring machine (2026-11-21: LCP 1.7 to 2.1 s, CLS <= 0.01, median TBT 113 to 146 ms) |
| Mobile friendly, HTTPS, clean URLs, no redirect chains | Responsive layout, one 308 for trailing slashes | implemented |
| Image SEO | `alt` on every content image, sized images | gated (Biome a11y) |
| Internal linking, breadcrumbs | Breadcrumb JSON-LD plus visible links | implemented |
| Content, keywords, E-E-A-T, link building | Product work, not template work: replace the placeholder copy | not applicable to the template |
| Answer engines | `llms.txt`, crawler policy | implemented |
| Monitoring | Search Console and Bing verification tokens | implemented (env) |

## API design

Translated to ConnectRPC and Protobuf; REST-only items apply to the plain HTTP endpoints.

| Item | Rule | Status |
|---|---|---|
| Consistent naming, resource modelling | Buf `STANDARD` lint, own request and response per RPC | gated |
| Versioning | Versioned packages, additive within `v1` | gated (`buf breaking`) |
| Pagination | Cursor, bounded `page_size` | gated |
| Filtering and sorting | Typed filter fields and sort enums, never free-form strings | implemented in `tasks` only |
| Partial updates, concurrency | `update_mask`, `expected_version` | implemented |
| Idempotency | `Idempotency-Key` with scope and replay tests | implemented |
| Error handling | Connect codes plus typed `google.rpc` details (`ErrorInfo`, `RetryInfo`, `PreconditionFailure`, validation violations); RFC 9457 `problem+json` on plain HTTP through `httpserver.WriteProblem` | gated (2026-11-21): `TestToConnectError_TypedDetailsOnTheWire`, `TestRouter_PlainHTTPErrorsAreProblemDocuments` |
| Authentication | OIDC resource server | gated (startup validation) |
| Authorization | Role policy; scopes for machine callers (`scope:<name>` alternatives in `AEDST_ROLE_POLICY`) | gated (startup validation of roles and scopes, 2026-11-21); the built-in defaults still name roles only |
| Rate limiting, throttling | Per-user limiter, load shedding; per-procedure limits for expensive RPCs as configuration (`modulekit.Module.RateLimits`, `AEDST_PROCEDURE_RATE_LIMITS`) | implemented and startup-validated (2026-11-21); `appattest` and `integrity` use it; Helm `config.procedureRateLimits` (chart not rendered here: UNVERIFIED) |
| Caching, conditional requests | `ETag` / `If-None-Match` on reads marked `NO_SIDE_EFFECTS` plus a `Cacheable` policy; `no-store` for everything else | gated for the mechanism (2026-11-21: `TestConditionalRead_*`, startup `ValidateCachePolicy`); one read uses it (`GetCapabilities`), no client sends GET yet |
| Compression, payload limits | Connect gzip, read cap | implemented |
| Documentation | Generated reference per module in `docs/content/modules/<module>/api.md` (from buf's descriptor); OpenAPI 3.1 per package in `docs/public/openapi`; every service and RPC has a comment | gated (2026-11-21): `task gen:openapi:check` in `server-ci.yml`, `scripts/api-docs --check` in `policies-ci.yml`, buf lint `COMMENT_RPC` / `COMMENT_SERVICE`; interactive OpenAPI page per package (`fumadocs-openapi`, generated by `node docs/scripts/openapi-pages.mjs`, its `--check` is not wired into CI yet) |
| Backward compatibility, deprecation | `buf breaking`, client version gate | gated |
| Webhooks, async APIs | Signed (Standard Webhooks), retried (River), idempotent (`webhook-id` = event id) deliveries with an SSRF guard | implemented (2026-11-21): delivery job, signer and client in `internal/platform/webhooks`; endpoint registry, fan-out of task and media events, delivery log, dead-letter state and the operator API `aedst.webhooks.v1.WebhooksService` in `internal/modules/webhooks`, off unless `AEDST_WEBHOOKS_ENABLED`. Unit-tested; **not run** against Postgres, River or a real receiver ([webhooks](/api/webhooks)) |
| Event contracts | Protobuf messages per producer (`api/proto/aedst/<module>/events/v1`), JSON on the wire with the proto field names | gated for `tasks` (2026-11-21: `buf breaking`, golden fixtures, `TestEventStructsMatchTheProtobufContract`); `media` events are still Go structs only |
| Observability | `otelconnect` on every mount | gated |
| Contract testing | The web e2e mock must cover every proto RPC | gated |

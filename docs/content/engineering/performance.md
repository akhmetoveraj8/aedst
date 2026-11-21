---
title: "Performance standard"
description: "The roadmap.sh frontend and backend performance checklists mapped to AEDST: budgets that fail CI, where each item is already handled, and the rules new code must follow."
---

# Performance standard

Performance is a **budget that fails the PR that breaks it**, not a clean-up task. Measure before and
after an optimization; an optimization without a number is a review finding. The order is always:
avoid the work, then do less of it, then do it later (in a job), then make it faster.

## Budgets (machine-enforced)

| Budget | Value | Gate |
|---|---|---|
| `app` JS emitted, gzip | total 905 KB (measured 893.7), largest chunk 110 KB (101.8), CSS 36 KB (32.8); first load per route: sign-in 254 KB (246.1), forbidden 241 KB (233.5), not-found 164 KB (160.4), tasks 412 KB (407.9), notifications 370 KB (366.5), search 364 KB (361.1) | `apps/web/app/bundle-budget.json`, `pnpm check:bundle` |
| `landing` JS emitted, gzip | total 181 KB (175.8), largest chunk 73 KB (70.1), CSS 10.3 KB (10.0), font files 474 KB (459.4), first load 141 KB on every page (136.7; the Next.js and React runtime alone is 132.2) | `apps/web/landing/bundle-budget.json`, `pnpm check:bundle` |
| `admin` JS emitted, gzip | total 490 KB (475.9), largest chunk 137 KB (133.0), entry first load 218 KB (212.0), CSS 31.5 KB (30.4), font files 549 KB (533.2) | `apps/web/admin/bundle-budget.json`, `pnpm check:bundle` |
| `app` Lighthouse (lab) | performance >= 0.9, accessibility 1, LCP <= 3 s, CLS <= 0.1, TBT <= 300 ms, zero third-party requests, script <= 385 kB (measured 373.2), page weight <= 621 kB (602.7), <= 38 requests (36), fonts <= 187 kB, stylesheets <= 36.2 kB, images <= 20 kB, `server-response-time` <= 800 ms | `apps/web/app/lighthouserc.json` (anonymous run; the signed-in run has its own smaller set) |
| `landing` Lighthouse (lab) | performance and SEO >= 0.95, accessibility 1, LCP <= 2 s, CLS <= 0.05, TBT <= 150 ms, zero third-party requests, script <= 152 kB (measured 147.8), page weight <= 279 kB (271.0), <= 14 requests (13), fonts <= 98.8 kB, stylesheets <= 11.6 kB, images <= 20 kB, `server-response-time` <= 800 ms | `apps/web/landing/lighthouserc.json` |
| Cookies | each under 4096 bytes (an oversized session value is split across at most 3 numbered cookies, a session over the cap is refused), fewer than 20 per domain | `shared/lib/auth/session-cookies.test.ts`, `admin/server/session.test.ts` |
| Source bans | no Base64 images, no physical Tailwind direction utilities | `pnpm check:source` in each web project |
| Field web vitals | LCP, INP, CLS from real users after consent | `web_vital` events, used to re-derive the lab budgets |
| Server read path | p95 < 200 ms | OpenTelemetry metrics, [scaling guide](/server/scaling) |
| Server load | k6 thresholds; a smoke miss fails the `load` job, the `load` scenario is informational | `apps/server/test/load/api.js`, `server-ci.yml` |
| Server hot paths | allocs/op must not regress by more than 5% against the base commit | `task bench:check` (`scripts/bench-check.sh`, benchstat), `server-ci.yml` job `bench` |

One script checks all three bundle budgets: `apps/web/shared/scripts/check-bundle-size.mjs`. The new
Lighthouse numbers are the values measured on 2026-11-21 plus about 3%. `server-response-time` is
measured under the lab throttling, which adds 563 ms of latency by itself: 800 ms leaves the server
about 240 ms, far inside the 1.3 s roadmap limit. Both Lighthouse runs pass on the authoring machine after the client-bundle cuts of 2026-11-21
(per-run numbers in [status](/status)); the script and page-weight limits were then lowered to the new
measurements.

A budget is raised only with a measured reason in the budget file's comment and a decision row; the
roadmap.sh guidance (page weight under 500 KB ideal / 1500 KB max, load under 3 s, TTFB under 1.3 s) is
the outer limit, never the target.

## Frontend

Already handled by the stack (do not re-implement): Brotli/gzip and HTTP/2+ at the edge, minified and
tree-shaken JS/CSS, critical CSS and non-blocking styles (Next.js), hashed immutable static assets with
long cache headers, the React Compiler (no manual memoization), `next/font` (self-hosted WOFF2, preload,
`font-display: swap`, no layout shift), `next/image` (AVIF/WebP, `srcset` sized to the display, lazy
offscreen, width/height required), service-worker caching (Serwist), same-origin assets only (CSP).

Rules for new code:

1. **Server Components first.** `"use client"` goes on the smallest interactive leaf. A Server Component
   imports single-export entry files (`modules/<id>/entries/*`), never a module barrel that drags client
   chunks along.
2. **Load late what is not needed now**: dialogs, editors, charts, validators and analytics through
   dynamic `import()` on first use, with a same-size placeholder so nothing shifts.
3. **Images**: `next/image` only, explicit `width`/`height` or `fill` with a sized parent, `priority` only
   on the LCP image, SVG for icons and illustrations, no Base64 images, no image larger than its slot.
4. **Fonts**: `next/font` only, at most two families, subset to the needed scripts; no font file from a
   third-party origin.
5. **Data**: TanStack Query with explicit `staleTime`, prefetch on intent (hover, viewport) for the next
   route, `useOptimistic` for writes, TanStack Virtual for lists over ~100 rows, URL state with nuqs (no
   refetch storms from local state).
6. **JavaScript**: no inline `<script>` (CSP nonce only for framework scripts), no blocking third-party
   script, `async`/`defer` for anything outside Next's loader, no `setInterval` polling where a stream
   or `refetchInterval` with backoff fits; long work is split with `scheduler.yield()`/`startTransition`
   to keep INP low.
7. **CSS**: Tailwind utilities through `apps/web/shared/ui`, no runtime CSS-in-JS, no unused global CSS,
   animations on `transform`/`opacity` only.
8. **Dependencies**: check the cost before adding one (bundle analyzer or Bundlephobia), prefer the
   platform API, keep them current (Renovate). Cookies: few and small (well under 4096 bytes each and
   20 per domain); session cookies are httpOnly and hold the tokens only, never profile or UI data.
9. **Tools**: Lighthouse CI, Chrome DevTools Performance panel and React Performance Tracks, WebPageTest
   for real network profiles, Squoosh for one-off image checks.

## Backend

Already handled: stateless replicas, two connection pools plus an optional read pool, keyset pagination,
River for background work, DragonflyDB cache and rate limiting, Connect gzip, OpenTelemetry tracing and
metrics, pprof on the private listener, container-aware `GOMAXPROCS` (Go 1.25+), the Green Tea GC
(Go 1.26+).

Rules for new code:

| Area | Rule |
|---|---|
| Queries | Select only the columns the caller needs (no `SELECT *` or `RETURNING *`: `architecturetest` `TestQueriesNameTheirColumns` fails on one); every `WHERE`/`ORDER BY` on a large table has an index that `EXPLAIN` uses; no N+1: batch with `= ANY($1)` or a join (`TestNoQueryInsideALoop` fails on a sqlc query in a loop body; a justified loop carries `// querylint:loop-ok <reason>`); no `count(*)` on a paging path |
| Indexes | Composite, led by the owner id (`user_id`), in sort order; created `CONCURRENTLY`; partial indexes for hot subsets; `pg_trgm` for substring search |
| Writes | One statement instead of read-modify-write; batch inserts with `CopyFrom` or multi-row inserts; bounded transactions (no network calls inside a transaction) |
| Pools | Request code on the api pool, workers on the jobs pool, lag-tolerant reads on the read pool; keep `replicas x (MAX_CONNS + JOBS_MAX_CONNS)` under `max_connections` |
| Caching | Cache-aside in DragonflyDB for hot, read-heavy, tolerant data, only through `cache.Aside` (`apps/server/internal/platform/cache`: TTL on every entry, shared load on a miss, fail open), with explicit invalidation in the write path; never cache per-user authorization decisions longer than a token lives; HTTP caching (`Cache-Control`, `ETag`) for public, cacheable GETs and static assets; a cache outage only slows the system down. Reference and rules: `apps/server/AGENTS.md`, "When you need cache" |
| Async | Anything slow, retryable or not needed for the response (email, push, media, exports, fan-out) is a River job inserted in the transaction; heavy queues run on their own worker Deployment |
| Payloads | Bounded request sizes per service, bounded `page_size`, server streaming for large results, `update_mask` so clients send only what changed, batch RPCs where a client would otherwise call in a loop |
| Outbound calls | Configured client with a timeout, retry with backoff and jitter only for idempotent calls, circuit breaking (`apps/server/internal/platform/resilience`), HTTP keep-alive (the shared transport) |
| Go code | Preallocate slices and maps when the size is known, `strings.Builder` for building strings, stream instead of `io.ReadAll` on unbounded input, no reflection or `fmt` on hot paths (`perfsprint`), `sync.Pool` only with a benchmark that shows it helps, no goroutine without an owner and a stop condition |
| Retention | Every table that only grows ships a `retention.Policy` and a purge index |

Profiling and testing: a change on a hot path ships a benchmark (`testing.B.Loop`) or a k6 scenario
with before/after numbers in the PR; investigate with `pprof` (CPU, heap, goroutine leak profile) and
traces, Postgres `pg_stat_statements` and slow-query logging, never by guessing.

### Benchmark regression gate

`task bench` runs the benchmarks of the hot paths that need no infrastructure (cursor encode and decode,
idempotency hashing, event publish, the cache helper; the list is `BENCH_PKGS` in
`apps/server/scripts/bench.sh`) six times each. `task bench:check BASE=base.txt HEAD=bench.txt` compares
two runs with `benchstat` and fails when a benchmark's **allocs/op** rises by more than 5% (statistically
significant by benchstat) or leaves zero. Allocations are deterministic, so the gate does not flake on a
shared runner; ns/op and B/op are printed for the reader and never fail the job. CI runs both sides in one
job (`server-ci.yml`, `bench`): this commit and the PR base, or the previous commit on `main`. A new
benchmark for request-path code is added to `BENCH_PKGS`; an intended allocation increase is justified in
the PR, which then becomes the new base.

### Slow queries

Three layers, same 500 ms threshold. The server reports every statement that takes at least
`AEDST_DATABASE_SLOW_QUERY_MS` (default 500, 0 = off) as a warning log line with the trace id, a
`db.slow_query` event on the statement span and the counter `aedst_db_slow_queries{pool}`: statement text
only, never arguments (`internal/platform/database/slowquery.go`, combined with otelpgx through the
multitracer that ships with pgx). Postgres logs the statement (`log_min_duration_statement`) and its plan
(`auto_explain`, `log_analyze` off because it times every statement, not only the slow ones), and
`pg_stat_statements` aggregates all of them; this is configured in the CloudNativePG base and in the
Compose Postgres. For one query, run `EXPLAIN (ANALYZE, BUFFERS)` by hand.

### Streaming and batching

Add a **server-streaming RPC** only when a single response cannot be bounded: an export or report whose
size grows with the data set, a result the client consumes incrementally (a long-running job's progress),
or more than about 4 MiB or 10,000 rows in one answer. A list a person scrolls is keyset pagination, not
a stream; a file is an object-storage URL, not a stream of chunks. None of these exist yet, so there is no
streaming RPC, and one is not added to have an example.

Add a **batch RPC** (`BatchGetX`, a repeated id with an upper bound in Protovalidate) when a client
would otherwise call a unary RPC in a loop for one screen or one sync step, and batch SQL (`= ANY($1)`,
multi-row `INSERT`, `CopyFrom`) when a use case touches more than a handful of rows. A batch write states
whether it is all-or-nothing or returns a per-item result. No client loops over an RPC today, so none
exists; the N+1 gate covers the SQL side.

## Scaling

Scale out before scaling up: more stateless replicas first, then protect the single Postgres primary
(pools, indexes, read replica, PgBouncer), then extract a module only when its measured trigger fires
([scaling guide](/server/scaling), [extract runbook](/server/runbook-extract-service)). Client code
scales by modules: every feature is a vertical slice created with `task new:module`, owning its routes,
strings, tests and budget line, so a new feature never makes an existing one slower or larger.

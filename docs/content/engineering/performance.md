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
| Web JS emitted, gzip | total 905 KB, largest chunk 110 KB, CSS 36 KB, per-route first load | `apps/web/app/bundle-budget.json`, `pnpm check:bundle` |
| Lighthouse (lab) | performance >= 0.9, accessibility 1, LCP <= 3 s, CLS <= 0.1, TBT <= 300 ms, zero third-party requests | `apps/web/app/lighthouserc.json` (anonymous and signed-in runs) |
| Field web vitals | LCP, INP, CLS from real users after consent | `web_vital` events, used to re-derive the lab budgets |
| Server read path | p95 < 200 ms | OpenTelemetry metrics, [scaling guide](/server/scaling) |
| Server load | k6 thresholds | `apps/server/test/load/` |

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
   20 per domain); the session cookie is httpOnly and carries an id, not data.
9. **Tools**: Lighthouse CI, Chrome DevTools Performance panel and React Performance Tracks, WebPageTest
   for real network profiles, Squoosh for one-off image checks.

## Backend

Already handled: stateless replicas, two connection pools plus an optional read pool, keyset pagination,
River for background work, Valkey cache and rate limiting, Connect gzip, OpenTelemetry tracing and
metrics, pprof on the private listener, container-aware `GOMAXPROCS` (Go 1.25+), the Green Tea GC
(Go 1.26+).

Rules for new code:

| Area | Rule |
|---|---|
| Queries | Select only the columns the caller needs (no `SELECT *` in new sqlc queries; `apps/server/sql/media/queries.sql` still has legacy ones); every `WHERE`/`ORDER BY` on a large table has an index that `EXPLAIN` uses; no N+1: batch with `= ANY($1)` or a join; no `count(*)` on a paging path |
| Indexes | Composite, led by the owner id (`user_id`), in sort order; created `CONCURRENTLY`; partial indexes for hot subsets; `pg_trgm` for substring search |
| Writes | One statement instead of read-modify-write; batch inserts with `CopyFrom` or multi-row inserts; bounded transactions (no network calls inside a transaction) |
| Pools | Request code on the api pool, workers on the jobs pool, lag-tolerant reads on the read pool; keep `replicas x (MAX_CONNS + JOBS_MAX_CONNS)` under `max_connections` |
| Caching | Cache-aside in Valkey for hot, read-heavy, tolerant data, with a TTL and explicit invalidation on write; never cache per-user authorization decisions longer than a token lives; HTTP caching (`Cache-Control`, `ETag`) for public, cacheable GETs and static assets; a cache outage only slows the system down |
| Async | Anything slow, retryable or not needed for the response (email, push, media, exports, fan-out) is a River job inserted in the transaction; heavy queues run on their own worker Deployment |
| Payloads | Bounded request sizes per service, bounded `page_size`, server streaming for large results, `update_mask` so clients send only what changed, batch RPCs where a client would otherwise call in a loop |
| Outbound calls | Configured client with a timeout, retry with backoff and jitter only for idempotent calls, circuit breaking (`apps/server/internal/platform/resilience`), HTTP keep-alive (the shared transport) |
| Go code | Preallocate slices and maps when the size is known, `strings.Builder` for building strings, stream instead of `io.ReadAll` on unbounded input, no reflection or `fmt` on hot paths (`perfsprint`), `sync.Pool` only with a benchmark that shows it helps, no goroutine without an owner and a stop condition |
| Retention | Every table that only grows ships a `retention.Policy` and a purge index |

Profiling and testing: a change on a hot path ships a benchmark (`testing.B.Loop`) or a k6 scenario
with before/after numbers in the PR; investigate with `pprof` (CPU, heap, goroutine leak profile) and
traces, Postgres `pg_stat_statements` and slow-query logging, never by guessing.

## Scaling

Scale out before scaling up: more stateless replicas first, then protect the single Postgres primary
(pools, indexes, read replica, PgBouncer), then extract a module only when its measured trigger fires
([scaling guide](/server/scaling), [extract runbook](/server/runbook-extract-service)). Client code
scales by modules: every feature is a vertical slice created with `task new:module`, owning its routes,
strings, tests and budget line, so a new feature never makes an existing one slower or larger.

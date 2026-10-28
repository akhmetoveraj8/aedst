---
title: "Path to microfrontends"
description: "apps/web is one Next.js app and stays one. It is built so that a feature module could later become its own deployable without a rewrite. This page records..."
---

# Path to microfrontends

The web side is already split along audience lines into three separate projects (`app`, `admin`, `landing`; see [Web projects](/web/projects)). Inside the product app (`apps/web/app`) the feature modules stay one Next.js app, built so that a feature
module could later become its own deployable without a rewrite. This page
records what is already prepared, what would change, the order of steps, and
when to take them. Nothing here is adopted today: no Module Federation, no
multi-zones. See the decision in [decisions/web](/decisions/web).

## What is already prepared

| Seam | Where | Why it matters for a split |
|---|---|---|
| Public surface | `modules/<id>/public.ts` | The only code another place may import. A zone would own everything behind it. |
| Manifest | `modules/<id>/manifest.ts`, type in `apps/web/shared/modules/manifest.ts` | Routes, nav entries, i18n namespaces, feature flags, capabilities and permissions are data, not scattered imports. A shell could read them from a remote instead of a local file. |
| Registry | `apps/web/app/src/app/config/modules/registry.ts` | The one list of modules; route guard, nav and i18n loader derive from it. Removing a module from the registry removes it from the shell. |
| No module-to-module imports | `apps/web/app/scripts/check-feature-boundaries.sh` (`pnpm check:feature-boundaries`, in `task check`) | Modules already cannot share internals, so there is nothing to untangle. Also checked: manifests import only `@/shared/**`; flags used are declared; every module is registered. |
| Shared contracts | `apps/web/shared/api` (generated Connect clients), `apps/web/shared/ui`, `apps/web/shared/lib/auth` | The only things two zones would need to share, and they are already packages in all but name. |
| Server-side session (BFF) | httpOnly cookies, `/api/rpc` proxy, `proxy.ts` | Cookies are scoped to the host, so zones on one domain share the session with no token handling in page JavaScript. |
| Route-level splitting + per-module budgets | Next chunk graph per route; `apps/web/app/bundle-budget.json` `modules` | Shows which module is heavy before a split is argued for. |

Cross-module communication is allowed only through: the manifest/registry,
`apps/web/shared` (including typed API clients, shared query keys and URL state),
a typed event contract placed in `apps/web/shared` when a real need appears, or the
server. There is no direct import and no shared mutable singleton between modules.

## Staged path

1. **Today: modular monolith.** One app, one deploy, enforced seams.
2. **Route-level split with Next.js multi-zones** (first real step). A module's
   routes move to a second Next.js app in the same monorepo. Both are served
   under one domain: the main app rewrites the module's paths and its static
   assets to the zone. Each zone sets its own `assetPrefix`
   ([Next.js multi-zones guide](https://nextjs.org/docs/app/guides/multi-zones)).
   Navigation between zones is a hard navigation, so links across zones must be
   plain `<a>` and chatty pages belong in the same zone.
3. **Module Federation** (only if several teams must ship independently
   *inside one page*). This runtime composition is not needed to split by route
   and carries the largest cost; it is the last resort.

## What changes at each step

**Multi-zones (step 2).**
- *Shared packages.* Extract the shared pieces a second app needs (`shared/ui`,
  `shared/api`, auth/session helpers, the manifest type, the i18n loader) into
  workspace packages. Today they are `apps/web/shared`; the boundary check already
  proves modules depend only on that layer.
- *Locale in the path.* Every route is `/[locale]/...`, so `basePath` cannot
  isolate a zone. Route by rewrite patterns (`/:locale/tasks/:path*`) and give
  each zone a unique `assetPrefix`. The manifest `routes` are the source for
  those rules.
- *proxy.ts per zone.* Each zone needs the session classification, refresh
  rotation and nonce CSP. Move that logic to a shared package; keep refresh
  single-flight semantics in mind (see the refresh decision in
  [decisions/web](/decisions/web)): two apps refreshing the same token is the
  same hazard as two replicas.
- *CSP and SSR.* The nonce CSP is minted per request in `proxy.ts`
  (`script-src 'nonce-…' 'strict-dynamic'`). Each zone renders its own HTML with
  its own nonce, so there is no cross-zone script sharing and no new origin as
  long as zones stay on the same host (rewrites, not a second domain). A
  separate origin for a zone would need `script-src`/`connect-src`/`img-src`
  additions in `app/config/security/csp.ts` and a CSP-update review. SSR stays
  per zone; hydration never crosses a zone boundary.
- *Server Actions.* Set `experimental.serverActions.allowedOrigins` to the
  user-facing origin in each zone (the logout action is Origin-checked).
- *Service worker and PWA.* One service worker scope for the origin: keep it
  in the main app and give it the zones' asset prefixes in the precache and
  runtime-cache rules.
- *i18n.* The `common` catalogue is shared; each zone loads its own module
  catalogues (the `i18nNamespaces` in its manifests). Locale parity checks
  stay per package.
- *Analytics and errors.* Same consent cookie; same Sentry release naming plus
  a zone tag.
- *Release coordination.* Contract changes to `shared/*` need versioning across
  zones; feature flags (PostHog) are the tool for unison rollouts.

**Module Federation (step 3).**
- Webpack/Rspack federation plugins are not part of the Turbopack default; it
  would reopen the build toolchain decision, the Library-First list and the CSP
  (remote entry scripts need nonce propagation), and each remote's React must
  be a singleton shared with the host.
- Types and the manifest become a versioned runtime contract between
  independently deployed pieces.

## Trigger conditions

Take step 2 for a module only when at least one holds, with numbers:
- A team that does not share a release cadence owns the module, and coordinated
  releases measurably block it.
- The module's `modules.<id>` first-load budget in `apps/web/app/bundle-budget.json` keeps
  needing increases and route-level splitting and dynamic imports are exhausted.
- `next build` time or CI time for the single app exceeds the agreed ceiling
  even with Turbopack's cache warm.
- A module needs a different runtime or compliance boundary (e.g. isolated
  deploy and data access).

Take step 3 only when several teams must compose UI inside the same page at
runtime, and multi-zones cannot express it.

Do not split for fashion: one team, one deploy, one set of budgets is cheaper
and the seams above keep the option open.

## Adding a module today

1. Create `modules/<id>/{manifest.ts,public.ts,i18n/*.json,ui,lib}`.
2. List the manifest in `apps/web/app/src/app/config/modules/registry.ts`.
3. Add `apps/web/app/src/app/(pages)/[locale]/(app)/<route>/page.tsx`, importing only
   `@/modules/<id>/public`.
4. Add the type-level mirror in `apps/web/app/src/app/config/i18n/messages.d.ts` and the
   catalogue in `apps/web/app/src/test/render.tsx`.
5. Add a `modules.<id>` budget in `apps/web/app/bundle-budget.json`
   (`pnpm check:bundle` fails on a route without one).
6. `pnpm check:feature-boundaries` and `registry.test.ts` must pass.

## Capability negotiation

A module is also a server feature named by its manifest `id` (`flagged: true`
= off until the server enables it). `apps/web/shared/lib/capabilities` calls the
public `GetCapabilities` RPC (through `/api/rpc` in the browser; directly with
a 60 s per-process cache in `proxy.ts`, so no request waits on the network),
keeps the last answer in localStorage, and applies
`docs/contract/behavior/capabilities.json`: a listed feature is
authoritative (`enabled = false` always wins), the typed
`Feature.required_client_version` (semver, empty = none) hides it on older
clients, and the server lists one coarse entry per module id (`tasks`,
`media`, ...) besides dotted sub-capabilities; an unlisted built-in is on, an
unlisted flagged one is off (ADR-0009). A disabled module loses its nav
entries and its session routes redirect to `/forbidden`; the public sign-in
route is never denied. `updateStatus` and the web support window are in the
snapshot; web has no upgrade screen.

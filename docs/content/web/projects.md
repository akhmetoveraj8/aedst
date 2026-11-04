---
title: "Web projects"
description: "The web side is a workspace of three separate Next.js projects (app, admin, landing) and a source-only shared kit: who owns what, dependency direction, auth between app and admin, deployment and CSP per project."
---

# Web projects

`apps/web` is a pnpm workspace. It replaces the earlier single Next.js app so that the audiences (end users, staff, anonymous visitors) have different
deployables, different security posture and different release cadence. This page is the architecture of the split; the day-to-day router for
contributors and AI agents is `apps/web/AGENTS.md` in the repository.

## Layout

```
apps/web/
  AGENTS.md README.md CLAUDE.md   # router for the four directories
  biome.json                      # ONE Biome config for the workspace
  pnpm-workspace.yaml             # packages + the version catalog (every version pinned once)
  shared/    @aedst/web-shared    # source-only kit, alias @/shared/*
  app/       @aedst/web-app       # product, signed-in end users, :3000
  admin/     @aedst/web-admin     # staff panel, :3001, noindex
  landing/   @aedst/web-landing   # marketing site, :3002, SEO/GEO first
```

Paths in the other web pages without a prefix (`src/app/...`, `src/modules/...`, `scripts/...`, `knip.jsonc`) mean the **app** project (`apps/web/app`).
`shared/` always means `apps/web/shared`.

## What goes where

| Question | Project |
|---|---|
| Does a signed-in end user use it (tasks, media, notifications, search, profile)? | `app` |
| Is it an operation only staff may do (users, audit log, broadcasts, moderation)? | `admin` |
| Is it an anonymous marketing, legal or SEO page? | `landing` |
| Is it used by two or more projects and not product-specific (a UI primitive, the Connect client, a formatter, the session helpers)? | `shared` |
| Anything else | stays in the project that uses it, even if reuse is likely; promote it when the second project needs it |

## Dependency direction

- A project imports only itself and `shared` (`@/shared/*`). Projects never import each other's `src`. They meet in `shared/` and over the network.
- `shared` never imports a project (`@/app/*`, `@/modules/*`). Shared tests may use `@/test/*` of the host project `app`; Storybook of `shared/ui` and the
  Vitest run of `shared/**` tests are hosted by `app`.
- Inside a project: `app -> modules -> shared`, modules never import each other (`apps/web/app/scripts/check-feature-boundaries.sh`, dependency-cruiser).
- A change in `shared/` can break any project: CI for all three triggers on `apps/web/shared/**`.

## Why shared is source-only

`shared` has a `package.json` (`@aedst/web-shared`, to carry its dependency list through the catalog) but no build step and no `exports`. Each project
compiles it as its own source through the tsconfig alias `"@/shared/*": ["../shared/*"]` (each project's Next.js config must compile it; check its `next.config.ts`). Reasons:

- The old import path `@/shared/*` is kept, so the split moved files without rewriting imports.
- No build, versioning or publish pipeline for an internal kit; edits are visible to all projects immediately, in dev and in CI.
- Tree shaking and per-route chunking work on source exactly as before.

**Promote `shared` to a real package** (build with tsup/tsc, `exports`, a version) when one of these holds: a project outside this repository needs it; the kit's compile time
dominates a project's CI; a project must pin an older kit than another; or the set of consumers grows beyond the three projects. Until then the cost of a package
(release steps, dual builds, source maps) exceeds the benefit. Record the change in [decisions/web](/decisions/web).

## Versions

All web versions are pinned once, in the `catalog:` of `apps/web/pnpm-workspace.yaml`. A `package.json` says `"catalog:"`. One install
(`pnpm --dir apps/web install --frozen-lockfile`) and one lockfile serve every project. Renovate reads the catalog and opens one PR for all three
projects. A new dependency also goes to the project's knip allowlist and to [Library-First: Web](/library-first/web).

## Admin on Vite

Owner decision, 2026-11-04 (implemented the same day, see the UNVERIFIED list in decisions/web.md): `admin` is a React + Vite + TanStack Router single-page app (static `dist/`) served by a thin Hono backend-for-frontend (BFF) in the same image and process; `app` and `landing` stay on Next.js. The frontend is in `apps/web/admin/src` ([admin/README.md](../../../apps/web/admin/README.md)); the BFF is `apps/web/admin/server`.

### Server (BFF)

- **Shape**: `createApp(deps)` (Hono 4, `@hono/node-server`) in `server/app.ts`; `server/main.ts` listens and shuts down gracefully on SIGTERM. All I/O (fetch, the OIDC calls of `shared/lib/auth`, index.html) is injected, which is how the server tests run without an IdP. One Zod-validated env in `server/env.ts` (`server/.env.example` lists every variable); JSON logs with request ids and no tokens, cookies or query strings.
- **Routes** (ported 1:1 from the Next Route Handlers): `GET /api/auth/login`, `GET /api/auth/callback` (307, `__Host-` cookies on https, failures to the locale-less `/forbidden?auth_error=`; the SPA adds the locale), `POST /api/auth/logout` (needs the `x-requested-with` header; clears the cookies, revokes the refresh token, returns `{endSessionUrl}`), `GET /api/auth/session` (`200 {authenticated, email, name?, sub?, roles}` or `401 {authenticated:false}`, never a token; a retryable `503` while the IdP is down), `POST /api/rpc/<aedst.(admin|capabilities).v1.XService/Method>` (same-origin check, 1 MB body cap, header allowlist, bearer attach, one refresh retry, streaming passthrough, header and idle timeouts), and `GET /api/healthz`. Anything else under `/api/` is a JSON 404.
- **HTML guard** (replaces `proxy.ts`): a GET navigation that is not `/api/**` or a file resolves the session, rotates an expired access token through the refresh cookie (single-flight, cookies written on the response), then applies `decideRoute`: anonymous -> 302 `/api/auth/login?next=<path+query>`, signed in without an operator role -> 302 `/{locale}/forbidden` (locale-less `/forbidden` when the path has no locale), else `index.html` for every other non-file path (SPA fallback). A path without a locale prefix (`/`) is guarded too; `/forbidden` is exempt. A missing file (`/assets/x.js`, any path with an extension) is a 404, never the SPA.
- **Nonce**: Vite stamps `__CSP_NONCE__` on script, style and link tags (`html.cspNonce`); the BFF replaces every occurrence with a fresh per-request nonce and sends the matching CSP. `dist/index.html` is never served as a file. `dist/assets/*` is immutable for a year, other files revalidate hourly, HTML is `no-store`.
- **Build and run**: `pnpm build:all` (`vite build` + `server/build.mjs`, an esbuild bundle to `dist-server/main.mjs`), `pnpm start`. esbuild was chosen over Node type stripping because the shared kit is imported through the `@/shared/*` alias and extensionless paths, which Node does not resolve, and a single file keeps the runtime image free of `node_modules`. Dev: `pnpm dev` runs Vite on 3001 and the BFF on 3101 (`ADMIN_BFF_PORT`/`PORT`); Vite proxies `/api` to it (`ADMIN_BFF_URL`). In dev Vite serves the HTML itself, so the HTML guard is exercised in the built shape (`pnpm build:all && pnpm start`, e2e, CI smoke).
- **Tests**: `pnpm test:server` (Vitest, node, `vitest.server.config.mts`); typecheck with its own `server/tsconfig.json` (`pnpm typecheck:server`, part of `pnpm typecheck`).
- **Not carried over**: server-side Sentry. The Next build reported BFF errors through `@sentry/nextjs`; the Hono process logs them as structured JSON instead (`@sentry/node` is not approved; add it through the Library-First page if wanted).

## Auth between app and admin

Status: **DECIDED** (owner, 2026-10-28). `admin` does not share the session of `app`. It is a separate OIDC client at the same IdP and keeps its own host-only cookies.

- `app` and `admin` each run the OIDC Authorization Code + PKCE flow as a backend-for-frontend (see [Architecture](/web/architecture#auth-data-and-security-model)) through their own `/api/auth/{login,callback}` Route Handlers, both built on `shared/lib/auth`. Admin has no copy of the app's pages: an anonymous visitor or an expired session is redirected by the admin BFF to admin's OWN `/api/auth/login?next=<path>`; a relative `next` is honoured after login (`safeRedirectPath`).
- ZITADEL SSO makes the second sign-in seamless: a user already signed in at the IdP is not asked for credentials again.
- Each project keeps its own `__Host-` cookies (Secure, `Path=/`, no `Domain`) on its own origin, so an XSS in `app` can never read the admin session. A parent-domain cookie (`Domain=.<domain>`) is not used: separate subdomains plus the `__Host-` prefix cannot share cookies, and widening to a parent-domain cookie would weaken staff sessions (any subdomain could set or shadow it).
- Admin access requires role `admin`. The UI check in `admin` (`server/security/route-guard.ts` and the SPA route guards) is cosmetic; the real check is the server's RoleInterceptor policy per RPC. A signed-in user without the role lands on `/{locale}/forbidden`; login failures also land there (`?auth_error=`), because that page is exempt from the sign-in guard (no redirect loop).
- `landing` has no session and no access to auth code or the Connect client.

| | `app` | `admin` |
|---|---|---|
| OIDC client id (`OIDC_CLIENT_ID`) | `aedst-web` | `aedst-admin` |
| Redirect URI | `${APP_ORIGIN}/api/auth/callback` | `${ADMIN_ORIGIN}/api/auth/callback` |
| Post-logout redirect URI | `${APP_ORIGIN}` | `${ADMIN_ORIGIN}` |
| Session cookie base name (`AUTH_COOKIE_NAME`) | `aedst_session` | `aedst_admin_session` |
| Dev origin | `http://localhost:3000` | `http://localhost:3001` |

Both clients are created in `apps/server/deployments/zitadel/bootstrap.sh` (dev). The cookie names must differ because on `localhost` cookies ignore the port; the transient pre-auth cookie `aedst_oidc` is shared by name in dev only, and is host-only under `__Host-` in production. apps/server accepts tokens of both clients (same project audience, same roles claim) and must list the admin origin in `AEDST_CORS_ALLOWED_ORIGINS` (dev default includes `http://localhost:3001`).

Logout: signing out of `admin` clears only admin's cookies, revokes its refresh token and ends the IdP session through RP-initiated logout with admin's `id_token_hint`. Signing out of `app` does the same for `app`. Neither signs the other out in the browser; because the IdP session is shared, ending it at the IdP means the other project's next sign-in asks for credentials, while its existing cookies stay valid until they expire.

## Deployment per project

| Project | Image | Port | Domain | Pipeline |
|---|---|---|---|---|
| `app` | `apps/web/app/deployments/docker/Dockerfile`, Helm chart `apps/web/app/deployments/helm/aedst-web` | 3000 | `app.<domain>` (proposed) | `web-ci.yml`, `web-release.yml` (tag `web-v*`) |
| `admin` | `apps/web/admin/deployments/docker/Dockerfile` (SPA `dist/` + BFF bundle, one distroless Node process) | 3001 | `admin.<domain>` | `admin-ci.yml` (no release workflow or chart yet) |
| `landing` | `apps/web/landing/deployments/docker/Dockerfile` | 3002 | `<domain>` | `landing-ci.yml` (no release workflow or chart yet) |

Every image is built with the repository root as context (the stubs are generated from `apps/server/api/proto` during the build and `shared/` is compiled in). Details and rollback
for the app: [Web deployment](/web/deployment). Nothing here was built with Docker yet (UNVERIFIED); the first release run is the acceptance test. `apps/server` must list
each browser origin that calls it directly; the browsers call their own project's `/api/rpc`, so only same-origin proxies reach the server.

## CSP per project

`app` builds its nonce CSP in `src/app/config/security/csp.ts` and `proxy.ts`; `admin` builds its own in `server/security/csp.ts`, applied by the BFF (the browser talks to its own origin only, plus the Sentry ingest origin derived from the DSN in `connect-src`, there is no tunnel; Trusted Types report-only and `Reporting-Endpoints` when a Sentry DSN is set). `landing` is static and must not need a per-request nonce, so its
CSP is set in its `next.config.ts` and it allows no third-party origins. A new third-party origin goes into the CSP of the project that loads it, in the same change. `admin` allows
no analytics or tracking origins.

## Commands

`task web:*` runs all three; `task app:*`, `task admin:*`, `task landing:*` run one (`dev`, `build`, `lint`, `knip`, `test`; `app` also has `generate`, `test:coverage`, `test:e2e`, `check:bundle`, `lighthouse`).

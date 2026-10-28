---
title: "Web Deployment"
description: "How the apps/web projects ship (this page details the app project; admin and landing have their own Dockerfile): a distroless container (Docker + Helm), Sentry source maps from the release build only, health checks, rollback, and the documented Vercel/OpenNext alternative."
---

# Web Deployment

The three web projects (`app`, `admin`, `landing`) are separate deployables, one container image each, on separate domains (see [Web projects](/web/projects)). This page details the **app** project; `admin` and `landing` follow the same shape with their own `deployments/docker/Dockerfile` (ports 3001 and 3002, no release workflow or Helm chart yet). Each image is built from the Next.js `output: "standalone"` bundle. The
Vercel/OpenNext route is documented at the end and is **not implemented**.

Status: the Dockerfile, the Helm chart and `web-release.yml` were authored without Docker, Helm or a CI run
available. **UNVERIFIED**: the first `web-release` run and the first `helm template` are their acceptance tests.

## Pieces

| What | Where |
|---|---|
| Image | `apps/web/app/deployments/docker/Dockerfile` (+ `Dockerfile.dockerignore`) |
| Helm chart | `apps/web/app/deployments/helm/aedst-web` (`values.yaml`, `values-prod.yaml`) |
| Release pipeline | `.github/workflows/web-release.yml` (tag `web-vX.Y.Z` or manual) |
| Test build | `web-ci.yml` `build` job: never deployed, never uploads source maps |
| Health check | `GET /api/healthz` -> `200 {"status":"ok"}` |

## Container image

- **Build context is the repository root**, not `apps/web/app`: the ConnectRPC stubs are generated during the build
  from `apps/server/api/proto` (they are not committed).
  `docker build -f apps/web/app/deployments/docker/Dockerfile --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.com .`
- Stage 1 `node:26.12.1-trixie-slim` installs pnpm 12.15.0, runs `pnpm install --frozen-lockfile`,
  `pnpm --filter @aedst/web-app connect:generate` and `pnpm --filter @aedst/web-app build`, then fails if `app/.next/static` contains a `.map` file. Only `app` and `shared` are installed (the lockfile and catalog are workspace-wide).
- Stage 2 `gcr.io/distroless/nodejs24-debian13:nonroot` (no shell, uid 65532) runs `node server.js` from
  `app/.next/standalone`. The lockfile lives in `apps/web` (the workspace root), so Next's tracing root is `apps/web` and the server is `app/server.js` inside the standalone output; the final `COPY` paths and `CMD` follow that. UNVERIFIED until the first image build.
- **Pinning policy** is the same as `apps/server/deployments/docker/Dockerfile`: base images are pinned by exact
  version tag, never `latest`, and not by digest. Both tags were checked against their registries on 2026-10-08. If
  the owner wants digest pinning, change it for the server and web Dockerfiles together (Renovate keeps digests
  current).
- `HEALTHCHECK` uses the bundled `node` (distroless has no curl). Kubernetes ignores it and uses the chart's probes.
- Static assets and `public/` are copied next to the standalone server; for a CDN, serve `.next/static` from the CDN
  and keep the files in the image only as the fallback.

## Running the build locally

`pnpm start` (and therefore the e2e suite and the signed-in Lighthouse script) runs `scripts/start-standalone.mjs`: it copies `.next/static` and `public/` next to `.next/standalone/server.js`, loads the `.env*` files (the standalone server does not), and starts the same `server.js` the container runs. `next start` is not used because it is unsupported with `output: "standalone"`.

## Environment

`NEXT_PUBLIC_*` values are **inlined into the client bundle at build time**: they are Docker build args and need one
image per public origin. Everything else is read at runtime. Schemas: `apps/web/shared/env/{client,edge,server}.ts`.

| Variable | When | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | build | yes (prod) | Canonical origin: metadataBase, canonicals, sitemap, robots, OG URLs. Default is `http://localhost:3000` (dev only) |
| `NEXT_PUBLIC_SENTRY_DSN` | build | no | Enables Sentry; empty = off |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | build | no | Defaults to `NODE_ENV` (the Dockerfile sets `production`) |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `..._REPLAY_SESSION_SAMPLE_RATE`, `..._REPLAY_ON_ERROR_SAMPLE_RATE` | build | no | 0..1 ratios (defaults 0.2 in production, 0.1, 1) |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | build | no | PostHog; empty key = never loaded. Also wires the `/ingest` rewrite |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | build | no | Link target of the privacy policy |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION` | build | no | Search-console verification tokens |
| `API_BASE_URL` | runtime | yes | Internal address of `apps/server` (server to server only) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | runtime | yes | Identity provider; must match `AEDST_OIDC_ISSUER` on the server |
| `OIDC_PROJECT_ID`, `OIDC_SCOPE`, `OIDC_CLIENT_SECRET` | runtime | no | ZITADEL project id, scope override, confidential-client secret |
| `OIDC_STATE_SECRET` | runtime | yes in prod | >= 32 chars, **identical on every replica** (seals the pre-auth cookie) |
| `AUTH_COOKIE_NAME`, `AUTH_ROLES_CLAIM`, `AUTH_ROLES_ORG` | runtime | no | Cookie base name; where roles live in the token (mirrors the server's `AEDST_OIDC_ROLES_*`) |
| `MEDIA_ORIGINS` | runtime | no | Comma-separated extra media origins for the CSP |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN` | build | release only | Source-map upload (below); the token is a BuildKit secret |
| `PORT`, `HOSTNAME` | runtime | no | Set to `3000` / `0.0.0.0` by the image |

In Kubernetes the chart renders the runtime variables into a ConfigMap and reads `OIDC_STATE_SECRET` (and optionally
`OIDC_CLIENT_SECRET`) from an existing Secret (`existingSecret`); nothing secret is in `values*.yaml`.

## Health check

`GET /api/healthz` (also `HEAD`) is a liveness and readiness probe that **never calls `apps/server` or the identity
provider**: a backend outage must not restart healthy web pods. It lives under `/api/*`, so `proxy.ts` only stamps the
static API CSP (no session, no locale, no I/O) and `apps/web/app/next.config.ts` marks it `no-store`. Dependency health belongs to
the server's `/readyz`.

## Cache headers

`apps/web/app/next.config.ts` sets `public, s-maxage=3600, stale-while-revalidate=86400` on `/robots.txt`, `/sitemap.xml`,
`/llms.txt`, `/llms-full.txt`, `/manifest.webmanifest` and `/:locale/opengraph-image`, so a CDN absorbs crawler
traffic. HTML stays dynamic (per-request CSP nonce, see the nonce-CSP decision); `/api/*` is `no-store` and
`/serwist/*` is never cached.

## Sentry source maps

Maps are uploaded **only** by `web-release.yml`, from the exact build that is deployed:

1. The workflow passes `SENTRY_AUTH_TOKEN` as a BuildKit secret (never a build arg, so it is not in the image
   history); `SENTRY_RELEASE` is the commit SHA, which the SDK also reports at runtime.
2. `next build` (`withSentryConfig`) uploads the maps and deletes them from the output
   (`deleteSourcemapsAfterUpload`); the Dockerfile then fails the build if any `.map` remains in `.next/static`.
3. Without the secret the upload is skipped and the workflow says so (a warning).

`web-ci.yml` builds for tests only and no longer receives the Sentry token, so PR builds cannot create releases whose
maps belong to nothing that runs. Its "No public source maps" step stays.

## Rollout and rollback

Images are tagged `sha-<commit>` and, for tag releases, `vX.Y.Z`; both are cosign-signed (keyless) and scanned with
Trivy (HIGH/CRITICAL fail). The Helm chart refuses to render without `image.tag`.

```
helm upgrade --install aedst-web apps/web/app/deployments/helm/aedst-web \
  -f apps/web/app/deployments/helm/aedst-web/values-prod.yaml --set image.tag=sha-<commit>
```

- Rolling update with `maxUnavailable: 0`; readiness is `/api/healthz`.
- **Rollback**: `helm rollback aedst-web <revision>` (or redeploy the previous `sha-` tag). The web app is stateless
  (sessions are cookies, state lives in `apps/server`), so rollback is safe as long as the previous web build still
  speaks the current API: the server keeps the contract backward compatible (Buf `breaking` check), so roll the web
  back before the server.
- Sentry keeps the maps of every release, so a rolled-back build still has readable stacks.
- `OIDC_STATE_SECRET` must not change during a rollout (in-flight sign-ins would fail); rotate it in a quiet window.

## Alternative: Vercel / OpenNext (documented, not implemented)

The code is host-agnostic where it matters: no filesystem state, sessions in cookies, the PostHog and Sentry proxies
are Next rewrites, `VERCEL_GIT_COMMIT_SHA` is already accepted as the Sentry release. To run on Vercel:

1. Import the repository, set the project root to `apps/web/app`, and give the build access to `apps/server/api/proto`
   (disable "Include source files outside of the Root Directory" only if the stubs are generated in a prior step;
   keep it on otherwise). Build command: `pnpm connect:generate && pnpm build`.
2. Set every row of the environment table above in the project settings (build and runtime scopes as listed);
   `output: "standalone"` is ignored by Vercel.
3. Keep `SENTRY_AUTH_TOKEN` to the **Production** environment only so preview builds do not upload maps.
4. For non-Vercel serverless (AWS, Cloudflare) the OpenNext adapters are the route; the open points to evaluate first
   are the per-request CSP nonce (every page is dynamic), the Node-runtime `proxy.ts`, and the in-memory Next cache
   (needs a shared cache handler across instances). None of that is built or tested here.

Re-open this decision (see [web decisions](/decisions/web)) before choosing Vercel: it moves the CDN, the cache
handler and the secrets model out of this repository's Helm/cosign pipeline.

## Edge rate limiting and report endpoints

- **Rate limiting is an edge concern.** `/api/auth/login`, `/api/auth/callback` and `/api/rpc` have no in-app throttle
  on purpose (a per-replica counter is wrong behind more than one pod, and OpenTofu for the edge does not exist yet).
  Put a per-IP rule at the ingress or CDN in front of these three paths (suggested start: 30 requests per minute per IP
  for `/api/auth/*`); the BFF already caps request bodies at 1 MB while reading them (`read-bounded-body.ts`).
  Failures of the login and callback routes are reported to Sentry (`source: bff`, `feature: auth`), so an IdP
  outage is visible.
- **CSP reports.** With `NEXT_PUBLIC_SENTRY_DSN` set, every response carries `report-uri` and `report-to csp-endpoint`
  plus a `Reporting-Endpoints` header, and a Trusted Types policy in **report-only** mode that reports to the same
  Sentry endpoint. Without a DSN none of these report headers is sent (the enforced CSP itself always is).

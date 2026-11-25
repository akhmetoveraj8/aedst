# aedst web workspace

`apps/web` is a pnpm workspace of four directories. Three are separate projects (separate builds, images and
domains): `app` and `marketing` on Next.js, `admin` a Vite SPA with TanStack Router and a Hono BFF; one is a source-only
kit they share.

| Directory                           | Package                | Purpose                                                                               | Dev port | Domain (deployed)         |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- | -------- | ------------------------- |
| [`app/`](app/README.md)             | `@aedst/web-app`       | Product app for signed-in end users                                                   | 3000     | `app.<domain>` (proposed) |
| [`admin/`](admin/README.md)         | `@aedst/web-admin`     | Staff admin panel (role `admin`), never indexed                                       | 3001     | `admin.<domain>`          |
| [`marketing/`](marketing/README.md) | `@aedst/web-marketing` | Public marketing site, static, SEO/GEO first                                          | 3002     | `<domain>`                |
| [`shared/`](shared/README.md)       | `@aedst/web-shared`    | Source-only kit: `ui`, `api/connect`, `lib`, `env`, `i18n`, `intl`, `date`, `modules` | none     | not deployed              |

Which project owns what, and how not to mix them: [AGENTS.md](AGENTS.md). Architecture, auth flow, CSP and deployment:
[docs/content/web/projects.md](../../docs/content/web/projects.md).

## Install and run

Prerequisites: Node.js 24+, pnpm (version in `package.json` `packageManager`), and a running `apps/server` on `:8080` for real API data.

```bash
pnpm --dir apps/web install --frozen-lockfile   # ONE install for all four directories (or: task setup)
task app:generate                               # generate the Connect clients into shared/api/connect/generated

task app:dev        # http://localhost:3000
task admin:dev      # http://localhost:3001
task marketing:dev    # http://localhost:3002
task web:dev        # all three at once
```

Without `task`: `pnpm --filter @aedst/web-app dev` (likewise `@aedst/web-admin`, `@aedst/web-marketing`).

## Environment

Each project has its own `.env.example`; copy it to `.env.local` inside that project. The server-side names that touch the
session (`API_BASE_URL`, `AUTH_COOKIE_NAME`, `AUTH_ROLES_CLAIM`, `OIDC_*`) must have the same values in `app` and `admin`.
Public variables (`NEXT_PUBLIC_*`) are inlined at build time. `marketing` has no auth variables; it only knows `NEXT_PUBLIC_APP_URL`
to link into the product.

## Versions

Every dependency version is pinned once in the `catalog:` of [pnpm-workspace.yaml](pnpm-workspace.yaml); `package.json` files say
`"catalog:"`. One Biome config ([biome.json](biome.json)) lints all four directories.

## Gates

| Scope                        | Command (repo root)                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One project                  | `task app:lint app:knip app:test`, `task admin:lint admin:knip admin:test`, `task marketing:lint marketing:knip marketing:test` |
| All three                    | `task web:lint web:knip web:test web:build`                                                                                     |
| Cross-platform static checks | `task check`                                                                                                                    |
| App extras                   | `task app:build app:check:bundle`, `task app:test:e2e` (Playwright), `task app:lighthouse`                                      |

Changing `shared/` affects every project: run the `web:*` gates, not only one project's.

## Deployment

Each project is its own container image built from the repository root (the Dockerfile is in `<project>/deployments/docker/`):
`app` has a release workflow (`.github/workflows/web-release.yml`) and a Helm chart; CI per project is `web-ci.yml` (app),
`admin-ci.yml`, `marketing-ci.yml`. Details: [docs/content/web/deployment.md](../../docs/content/web/deployment.md).

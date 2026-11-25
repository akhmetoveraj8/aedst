---
description: "apps/web — Next.js 16 / React 19 app. It is the parity source of truth that the native clients are built to match. Status: Verified (see Platform status)."
title: Web
---

# Web

`apps/web` — a workspace of three React 19 projects (`app` and `marketing` on Next.js 16, `admin` a Vite SPA with TanStack Router and a Hono BFF) plus a source-only `shared` kit. The product app is the parity source of truth that the native clients are built to match. Status: **Verified** (see [Platform status](/status)).

| Page | What it covers |
|---|---|
| [Projects](/web/projects) | The split: app, admin, marketing, shared; boundaries, auth between app and admin, deployment and CSP per project |
| [Architecture](/web/architecture) | Layout, modules, routing and locales, auth/data/security model |
| [Stack](/web/stack) | Every tool and pinned version |
| [i18n](/web/i18n) | next-intl catalogs per module |
| [Path to microfrontends](/web/microfrontends) | Module manifests, registry, and the staged route to multi-zones |
| [Deployment](/web/deployment) | Container image, Helm chart, release workflow, environment, Sentry maps, rollback, the Vercel alternative |

Related: [UI kit](/ui-kit), [Library-First: Web](/library-first#web), [Server modules](/server/modules).

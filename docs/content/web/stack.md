---
title: Stack
description: The complete Web stack with exact versions.
---

# Web stack

Next.js workspace (`apps/web`: app, admin, landing, shared). Versions are pinned once in the `catalog:` of `apps/web/pnpm-workspace.yaml` (checked against the registries on **2026-10-07**). Approved-library rules and rejections: [Library-First](/library-first#web). How to bump versions: [Stack overview](/stack#keeping-it-current).

## Framework

| Area | Tool | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | **16.4.3** |
| UI library | React | **19.3** |
| Language | TypeScript | **7.0.2** |
| Styling | Tailwind CSS | **4.3** |
| Components | shadcn/ui (`@base-ui/react`) | shadcn **4.21.4**, base-ui 1.8 |

## Data and state

| Area | Tool | Version |
|---|---|---|
| API client | Connect-ES (`@connectrpc/connect`, `connect-web`) + `@bufbuild/protobuf` | **2.2.0** / **2.16.0** |
| Server state | TanStack Query + connect-query | **5.104.1** / 2.3.1 |
| Client UI state | Zustand | **5.0.15** |
| URL state | nuqs | 2.10 |
| Tables / virtualization | TanStack Table / Virtual | **9.2.6** / 3.14 |
| Forms / validation | React Hook Form + Protovalidate (API forms) / Zod (client-only forms, env) | 7.89 / **1.3.0** / 4.6 |
| Dates | date-fns | 4.4 |
| Drag & drop | dnd-kit | 0.5 |
| i18n | next-intl | **4.14.9** |

## UX

| Area | Tool | Version |
|---|---|---|
| Animation | CSS + `tw-animate-css` (Motion not installed; only via `LazyMotion`) | 1.4 |
| Toasts | Sonner | 2.0 |
| Command palette | cmdk | 1.1 |
| Charts | Recharts | 3.10 |
| Date picker | react-day-picker | **10.0.2** |
| Panels | react-resizable-panels | **4.14.2** |

## Observability, analytics, PWA

| Area | Tool | Version |
|---|---|---|
| Errors, tracing, releases, source maps, replay | Sentry (`@sentry/nextjs`) | **11.5.0** |
| Product analytics + feature flags | PostHog (`posthog-js`, consent-gated) | **1.438.2** |
| Service worker / offline / push | Serwist (`serwist`, `@serwist/turbopack`) | **9.5.13** |
| Web Push | Push API + VAPID | platform |

## Tooling and tests

| Area | Tool | Version |
|---|---|---|
| Lint / format | Biome | **2.5.15** |
| Unused deps / exports | knip | **6.40.0** |
| Unit (Node) | Vitest | **5.0.3** |
| Component (real Chromium) | Vitest Browser Mode (`@vitest/browser-playwright`) + Testing Library | **5.0.3** / 16.3 |
| Sign-in (OIDC, BFF) | oauth4webapi (Authorization Code + PKCE, refresh grant); Auth.js is rejected, see [decisions](/decisions) | **3.8.8** |
| API mocking | `createRouterTransport` (`@connectrpc/connect`) for components; a `fetch` stub (`apps/web/app/src/test/mocks/server.ts`) for server-side code; injected `fetch` for the IdP | 2.2.0 |
| E2E | Playwright (`chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`) + axe-core | 1.63 / **4.14.0** |
| Contract test | mock API vs. proto descriptors (`pnpm test:contract`) | in-repo |
| Budgets | bundle-size script + Lighthouse CI | in-repo |
| Package manager | pnpm (Node 26) | **12.15.0** |

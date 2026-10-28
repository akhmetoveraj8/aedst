---
title: "Library-First: Web stack"
description: "Part of the Library-First standard. Principles, version policy, explicit rejections and the Definition of Done are in General rules."
---

# Library-First: Web stack

Part of the [Library-First standard](../library-first.md). Principles, version policy, explicit rejections and the Definition of Done are in [General rules](general.md).

Next.js (App Router) + React 19, in a pnpm workspace of three projects (`app`, `admin`, `landing`) and a source-only `shared` kit; every version is pinned once in the catalog of `apps/web/pnpm-workspace.yaml` ([Web projects](../web/projects.md)). Unprefixed `src/...` and script names below mean the `app` project. Biome is the only linter and formatter (ESLint and Prettier are **not used** and are not added). Feature isolation: `apps/web/app/scripts/check-feature-boundaries.sh`. Environment: Zod schemas in `apps/web/shared/env/{client,server}.ts` (do not read `process.env` directly in application code).

| Responsibility | Tool |
|---|---|
| Forms | React Hook Form |
| Validation | Forms that submit an API message: Protovalidate (`@bufbuild/protovalidate`, proto rules embedded in the generated `*_pb.ts`) through `protovalidateResolver` (`shared/lib/forms/`, runtime loaded lazily). Client-only forms and env: Zod (`zod/mini` in code that ships to the browser; full `zod` on the server) |
| Dates | date-fns, **imported only in `shared/date/format-date.ts`** (Biome `noRestrictedImports`); Temporal is Pending ([decisions.md](../decisions.md)) |
| Drag & Drop | dnd-kit |
| UI | shadcn/ui (`apps/web/shared/ui/`); `cn` is an npm package from the shadcn ecosystem |
| Animations | CSS + `tw-animate-css`. Motion is **not installed**; rule: Motion only via `LazyMotion` (`domAnimation`) + `m.` components + dynamic import, added together with a docs update |
| URL State | nuqs |
| React utilities (debounce, media query, local storage, etc.) | React Use |
| Server State | TanStack Query |
| Sign-in (OIDC) | **oauth4webapi 3.8.8** (zero-dependency, OpenID-certified; verified with `npm view` 2026-10-08): discovery, PKCE S256, state/nonce, `validateAuthResponse`, authorization-code and refresh grants, ID-token checks, RFC 7009. Authorization Code + PKCE as a BFF: `app/api/auth/{login,callback}`, the pre-auth cookie is sealed with AES-256-GCM (`node:crypto`), sign-out is a Server Action (RP-initiated `end_session` + revoke). **Auth.js / next-auth is not used** (see Explicit rejections). Config: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (confidential clients only), `OIDC_PROJECT_ID` (ZITADEL: scope `urn:zitadel:iam:org:project:id:<id>:aud`), `OIDC_SCOPE`, `OIDC_STATE_SECRET` (required in production), `AUTH_ROLES_CLAIM`, `AUTH_ROLES_ORG` |
| Tables | TanStack Table |
| Virtualization | TanStack Virtual (`@tanstack/react-virtual` 3.14.13, `npm view` 2026-10-08); reference: `modules/notifications/ui/NotificationsList.tsx`, pattern in [architecture](/web/architecture) "Virtual lists" |
| Testing | Vitest 5, two projects: `unit` (Node; the global `fetch` is a stub `apps/web/app/src/test/mocks/server.ts` that answers only the declared apps/server routes, `vitest.setup.node.ts`; IdP calls accept an injectable `fetch`, `apps/web/app/src/test/mocks/oidc.ts`) and `browser` (Vitest Browser Mode, real Chromium, `@vitest/browser-playwright`; Testing Library + `createRouterTransport` from `@connectrpc/connect` for Connect mocks, `apps/web/app/src/test/mocks/transport.ts`). **MSW and jsdom were removed** (server code accepts an injectable transport/fetch). Playwright: PRs run `chromium` + `mobile-safari`, main/nightly run all projects (`chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`; `@axe-core/playwright` for a11y); e2e runs against a mock API that also plays the OIDC provider (`e2e/mock-api/oidc.mjs`, RS256 via `node:crypto`); a contract test of the mock API against the proto descriptors (`pnpm test:contract`, optionally against a real server via `AEDST_CONTRACT_SERVER_URL`) |
| Performance budgets | `scripts/check-bundle-size.mjs` (node built-ins) + Lighthouse CI (`@lhci/cli`, run via `pnpm dlx`, not a dependency) |
| Lint/format | Biome (only it) |
| Unused deps/exports | knip |
| Import-graph rules | `dependency-cruiser` 18.5.0 (devDependency, `npm view` 2026-10-09): `.dependency-cruiser.cjs`, `pnpm check:deps`; Biome remains the only code linter/formatter |
| Mutation testing | `@stryker-mutator/core` 10.0.0 (devDependency, `npm view` 2026-10-09) with its built-in command runner: `stryker.config.mjs`, nightly only. `@stryker-mutator/vitest-runner` 10.0.0 was tried and removed: under Vitest 5.0.x it never activates runtime mutants (score 5 %, only static mutants died) |
| Component catalog / a11y | **Storybook 10** (`storybook`, `@storybook/nextjs-vite`, `@storybook/addon-a11y`, `@storybook/addon-vitest`, all `^10.6.1`, verified with `npm view`), `devDependencies` only; one story per `apps/web/shared/ui` component; the a11y addon fails on violations. Visual regression is opt-in (`test:visual`, Vitest `toMatchScreenshot`), baselines are not recorded yet |
| File size / colors | `apps/web/app/scripts/check-file-size.mjs` (green up to 300, yellow 301-400, warning above 400, red above 500) + Biome `noExcessiveLinesPerFile(500)`; `apps/web/app/scripts/check-color-literals.mjs` with an allowlist |
| API | generated Protobuf + ConnectRPC client (Connect-ES) |
| Streaming / cancellation / async composition | TanStack Query, `AbortController`, async iterators, Connect server streaming; **not RxJS** |
| AI/LLM integration | AI logic lives in the Go backend; for streaming use a Connect server-streaming RPC. **No model calls or API keys in Next.js; Vercel AI SDK (`ai`) is not approved** (see Explicit rejections) |
| Error tracking / crash reporting | Sentry (`@sentry/nextjs`) |
| Product analytics / feature flags | PostHog (`posthog-js`; session recording is off, replay only in Sentry Replay), only after consent, without DNT/GPC, via the `/ingest` rewrite; `track()` and `useFeatureFlag` in `shared/lib/analytics` |
| SEO / GEO (structured data, robots, llms.txt) | Next.js metadata API (`generateMetadata`, `robots.ts`, `sitemap.ts`, `route.ts`) plus `apps/web/app/src/app/config/structured-data.ts`: hand-written typed JSON-LD builders (`organization`, `webSite`, `webApplication`, `breadcrumbList`, `faqPage`, `article`) rendered by `JsonLd.tsx`. **`schema-dts` (2.1.0, `npm view` 2026-10-08) was evaluated and not adopted**: it is types only (no runtime), and six small builders with a unit test do not justify a dependency whose full vocabulary types we would not use; revisit when more than ~10 schema.org types are built. Not used: `next-seo` (App Router has native metadata), a custom robots/sitemap generator. Search-console tokens: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`. Guide: [SEO and GEO](/web/seo-geo) |
| Offline write queue (outbox) | **idb 8.0.4** (ISC, ~1 KB promise wrapper over the platform IndexedDB; verified `npm view idb version` 2026-10-08). IndexedDB is the only durable async structured store in a browser (Web Storage is sync, string-only and tiny); the raw API is event/callback based, so the wrapper is the library-first answer to hand-rolling one. Used only in `shared/lib/outbox/idb-store.ts`. Not used: Dexie (query/observable layer not needed, ~20 KB), localForage, Background Sync (the service worker has no sync handler; Safari/Firefox lack the API), `fake-indexeddb` (tests run on real IndexedDB in Browser Mode) |
| Client UI state | Zustand, **only** UI state (settings, upload queue, palette); server data only via TanStack Query |
| PWA / Service Worker | Serwist (`serwist` + `@serwist/turbopack`): offline shell, push, `notificationclick`; HTML and API responses are not cached |
| Web Push | standard Push API + VAPID (no Firebase SDK; Safari delivers via APNs) |
| Media | platform APIs: `createImageBitmap` + `OffscreenCanvas` (compression), XHR (upload progress to a presigned URL), native `<video>` |
| i18n | next-intl |
| Charts | Recharts |
| Command palette | cmdk |
| Carousel | Embla Carousel |
| Date picker | react-day-picker |
| OTP input | input-otp |
| Resizable panels | react-resizable-panels |
| Toasts/notifications | Sonner |
| Theme switching (light/dark) | next-themes |
| OG image fonts (landing only) | `@fontsource/noto-sans` + `@fontsource/ibm-plex-sans-arabic` 5.3.0 (SIL OFL 1.1, `npm view` 2026-10-28): satori (`next/og` `ImageResponse`) ships a Latin-only default font, so Cyrillic (ru, tj) and Arabic (ar) cards render as boxes. IBM Plex Sans Arabic instead of Noto Sans Arabic because satori cannot parse the Noto Arabic fonts (GSUB `lookupType: 5 - substFormat: 3`, tested 2026-10-28). The `.woff` files (satori reads ttf/otf/woff, not woff2) are read from `node_modules` at build time in `landing/src/app/config/og-fonts.ts` and traced into the standalone build via `outputFileTracingIncludes`. Not shipped to the browser |

**Note.** React Use, Sentry, PostHog, Zustand, Serwist, next-intl and shadcn/ui-ecosystem libraries (Recharts, cmdk, Embla, react-day-picker, input-otp, react-resizable-panels, Sonner, next-themes) are approved **before first use**; these are exactly the entries in the `apps/web/app/knip.jsonc` allowlist. See "Approved before first use" in [General rules](general.md): adding to the allowlist = updating this table.

**RxJS was removed and is not approved.** It may be brought back only for a concrete task that TanStack Query / `AbortController` / async iterators / Connect server streaming do not solve; the decision is recorded in [decisions.md](../decisions.md).

**CSP and security headers.** The page CSP is built per request in `apps/web/app/src/proxy.ts` (`apps/web/app/src/app/config/security/csp.ts`): nonce + `strict-dynamic`, no `unsafe-inline` for scripts, `connect-src 'self'` (the browser only talks to its own `/api/rpc`). This is the **only** place for CSP (also for `/api/*` and `/serwist/*`); it was removed from `apps/web/app/next.config.ts`, and a test checks that exactly one CSP header is sent. Other static headers live in `apps/web/app/next.config.ts`. Any new third-party origin (analytics, fonts, iframe, CDN) **must** be added to the CSP in the same PR and, if it measures anything, placed behind consent (`ConsentLayer`).

**Session.** Tokens live only in httpOnly cookies (BFF: OIDC Route Handlers `app/api/auth/*` + sign-out Server Action + `proxy.ts` + `/api/rpc`); `localStorage`/`sessionStorage` for tokens is forbidden. Web no longer calls `AuthService` (email/password, `loginAction`/`registerAction`, device-id were removed): sign-in is Authorization Code + PKCE against the IdP (ZITADEL by default), refresh is the `refresh_token` grant via oauth4webapi, keeping single-flight.

## Enforcement gates (mandatory library per concern)

Every row of the table above that says "only" is machine-checked; a rule without a gate is a wish. All gates run in `pnpm lint` (`biome check --error-on-warnings`) unless a script is named. Violating fixtures for each live in `apps/web/app/lint/fixtures/*.fixture` and `pnpm check:selftest` (CI job `lint`, lefthook `web-gate-selftest`) fails when a gate stops failing on its fixture.

| Concern | Use | Forbidden / where | Gate |
|---|---|---|---|
| Environment | `shared/env/{client,server,edge}.ts` (Zod; `edge.ts` is `zod/mini`, no `server-only`, for `proxy.ts` and `session-*.ts`) | `process.env` anywhere else | Biome `style/noProcessEnv` (off only for `apps/web/shared/env/**`, `apps/web/app/next.config.ts`, `apps/web/app/src/instrumentation*.ts`, `apps/web/app/src/app/config/sentry/**`, tests, e2e, config files) |
| Types | real types or `unknown` | `any` | `suspicious/noExplicitAny` |
| Module graph | acyclic | import cycles | `suspicious/noImportCycles` (Biome `project` domain) |
| Layering | `app -> modules -> shared` | `apps/web/app/src/modules/**` and `apps/web/shared/**` importing `@/app/**` | `apps/web/app/scripts/check-feature-boundaries.sh` rule 5; dependency-cruiser `modules-to-shared-only`, `no-shared-to-app-or-modules` |
| Import graph | `public.ts`/`manifest.ts`/`outbox.ts` as the only module entries, no cycles/orphans, no devDependency in shipped code | deep imports into a module, orphan files | dependency-cruiser (`pnpm check:deps`): `module-public-entry-only`, `manifest-imports-shared-only`, `no-circular`, `no-orphans`, `not-to-dev-dep` |
| UI state | Zustand | outside `apps/web/shared/lib/stores/**` and `apps/web/app/src/modules/<m>/lib/<name>-store.ts` | `style/noRestrictedImports` |
| Analytics | `track()` / `useFeatureFlag` | `posthog-js`, `posthog-js/react` outside `apps/web/shared/lib/analytics/**` | `style/noRestrictedImports` |
| Error tracking | `reportError`, `ErrorBoundary`, `addBreadcrumb` / `setErrorUser` (`shared/lib/errors`) | `@sentry/nextjs` outside `apps/web/app/src/app/config/**`, `apps/web/app/src/instrumentation*.ts`, `apps/web/shared/lib/errors/**` (and tests) | `style/noRestrictedImports` |
| Toasts | Sonner (`toast` from `sonner`) | `@/shared/ui/toast` (deleted) | `style/noRestrictedImports` |
| Dates | `shared/date/format-date.ts` (date-fns; `parseDateInputValue` for `yyyy-MM-dd`) | `date-fns` elsewhere; `new Date(<string/identifier/call>)` outside `apps/web/shared/date/**` | `noRestrictedImports`; GritQL `lint/no-date-from-string.grit` |
| Numbers, bytes, relative time | `shared/intl/format.ts` (`formatNumber`, `formatBytes`, `formatRelativeTime`; keyed by `toLanguageTag`) | `new Intl.*` outside `apps/web/shared/intl/**` | GritQL `lint/no-intl-constructors.grit` |
| Server calls | generated Connect client (`createClient(...Service, createConnectTransport(...))`, connect-query) | `fetch(` in `apps/web/app/src/modules/**` | GritQL `lint/no-fetch-in-modules.grit` (hand-written Connect JSON POSTs in `shared/lib/capabilities/server.ts` and `app/sw.ts` were replaced by `createClient`) |
| UI elements | `shared/ui` (`Button`, `Input`, `NativeSelect`/`Select`, `Textarea`, `Label`/`FieldLabel`, `Form`) | `<button> <input> <select> <textarea> <label> <form>` in `apps/web/app/src/modules/**` and `apps/web/app/src/app/**` (a sr-only file input goes through `Input`; anything else needs a `biome-ignore` with a reason) | `correctness/noRestrictedElements` |
| Forms | React Hook Form + `protovalidateResolver` | a file rendering `<form>` / `<Form>` without importing `react-hook-form` | `pnpm check:forms` (`scripts/check-forms.mjs`) |
| Colors | tokens (`bg-primary`, `text-muted-foreground`, Badge `success`/`warning`/`info`) | hex/`rgb()`/`oklch()` literals and Tailwind palette classes (`bg-red-500`, `text-neutral-600`) outside `apps/web/shared/ui` | `pnpm check:colors` and `scripts/check-color-literals.mjs` (repo level) |
| Naming | `PascalCase.tsx` components, `kebab-case.ts` everything else | other shapes (`shared/ui` exempt, framework file names fixed by Next.js) | Biome `style/useFilenamingConvention`, `useNamingConvention`; `scripts/check-naming.sh` (all `apps/web/src/**/*.tsx`) |

GritQL plugins (`apps/web/app/lint/*.grit`) are scoped with `includes` in `biome.json`. Plugin `includes` needs the `**/src/...` form (a bare `src/...` never matches), unlike `overrides[].includes`. `new Date(x)` detection is syntactic (one argument that starts like a string, template, identifier, member access or call), so a call whose own arguments contain a comma slips through: a guard rail, not a type checker. Adding a new exception means a `biome-ignore` with a reason, or an `overrides` entry here in the same change.

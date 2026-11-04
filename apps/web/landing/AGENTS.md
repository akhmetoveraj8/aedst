# apps/web/landing - AI agent instructions

Read the root [AGENTS.md](../../../AGENTS.md) and [CONVENTIONS.md](../../../CONVENTIONS.md) first. This file only adds what is
specific to the marketing site: a public, static, SEO/GEO-first Next.js project on its own domain, independent of
`../app` (signed-in product) and `../admin`. SEO rules: [seo-geo](../../../docs/content/web/seo-geo.md).
Approved libraries: [library-first/web](../../../docs/content/library-first/web.md). Naming: [conventions/web.md](../../../docs/agent/conventions/web.md).

## Pairs: when you do X, use Y

| When you add             | Use                                                                                                                                                                                          | Copy / read                                                      | Test                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| A page section           | a Server Component in `src/modules/marketing/ui/`, strings from `getTranslations({locale, namespace: "marketing.<section>"})`, `shared/ui` primitives                                        | `ui/Features.tsx`; compose it in `app/(pages)/[locale]/page.tsx` | `messages.test.ts` (keys in all 5 locales)      |
| A user-facing string     | `src/modules/<m>/i18n/{en,ru,tj,uz,ar}.json` (web calls Tajik `tj`); common strings in `src/app/config/i18n/common/`                                                                         | `marketing/i18n/en.json`                                         | `messages.test.ts`, `task check:i18n`           |
| A list of repeated items | key list in `lib/content-keys.ts` + nested JSON keys, never arrays in JSON                                                                                                                   | `lib/content-keys.ts`                                            | `messages.test.ts` (add the keys to `expected`) |
| A page (route)           | `app/(pages)/[locale]/<name>/page.tsx` with `generateMetadata` (`buildAlternates`), `setRequestLocale`, breadcrumb JSON-LD; add it to `config/public-routes.ts` (feeds sitemap and llms.txt) | `privacy/page.tsx`                                               | `robots-sitemap.test.ts`, `llms.test.ts`        |
| A JSON-LD type           | a builder in `config/structured-data.ts` (stable `@id`), render with `<JsonLd data={graph(...)}>`                                                                                            | `softwareApplication()`, `faqPage()`                             | `structured-data.test.ts`                       |
| An image                 | `next/image` with explicit `width`/`height` (or `fill` + `sizes`), `alt` text localized, AVIF/WebP source in `public/`; LCP image gets `priority`                                            | none yet                                                         | Lighthouse (`lighthouserc.json`)                |
| A link into the product  | `modules/marketing/lib/app-links.ts` (`NEXT_PUBLIC_APP_URL`); never a literal domain                                                                                                         | `app-links.ts`                                                   | `app-links.test.ts`                             |
| An environment variable  | a Zod field in `src/env.ts` (not `shared/env`), plus `.env.example` and the Dockerfile `ARG`                                                                                                 | `src/env.ts`                                                     | `pnpm lint` (`noProcessEnv`)                    |
| Analytics                | only after consent. None exists now: adding any requires a consent banner, a CSP update and an owner decision first                                                                          | n/a                                                              | n/a                                             |
| A third-party origin     | add it to the CSP in `next.config.ts` in the same change and name it in the PR                                                                                                               | `next.config.ts`                                                 | Lighthouse `third-party:count` budget is 0      |
| An interactive widget    | a small `"use client"` island that receives strings as props; the section around it stays a Server Component                                                                                 | `ui/FaqAccordion.tsx`                                            | component test only if logic exists             |

## Rules that bite

- Validation boundary ([docs/content/web/validation.md](../../../docs/content/web/validation.md)): API-message forms use `protovalidateResolver` only (rules live in the `.proto`); Zod is for env/storage/non-proto input and never imported in `ui/**`; React Hook Form is state only (no `register(..., {rules})`, no `rules=`, every `useForm` has a `resolver`). Enforced by Biome plugins and `pnpm check:validation`.
- Server Components by default. A new `"use client"` file needs a reason in its doc comment. Current islands: ThemeProvider, LocaleSwitcher, FaqAccordion, error.tsx.
- Pages must stay statically rendered: no `headers()`, `cookies()`, `searchParams`, no per-request nonce. Call `setRequestLocale(locale)` in every layout and page before `getTranslations`.
- No auth, session, ConnectRPC, `shared/api`, `shared/lib/auth`, PWA/service worker, PostHog or Sentry tracing here. No imports from `../app` or `../admin` (`@/shared/*` only).
- Arabic is RTL: logical CSS only (`ms-`, `ps-`, `start-`, `text-start`), never `ml-`/`left-`/`text-left`. `dir` and `lang` come from `shared/i18n/locales`.
- Every answer in the FAQ must be in the server HTML (JSON-LD `FAQPage` mirrors it); keep GEO content as real text, not images.
- Copy never invents facts: pricing, legal text and `siteConfig.organization.sameAs` are placeholders until the owner supplies real values.
- CSP lives in `next.config.ts` (static header). `script-src` keeps `'unsafe-inline'` only because Next inlines hydration scripts on static pages; do not widen anything else.
- Biome only; no color literals (design tokens); no raw `<button> <input> <form>`; files at most 300 lines.
- Budgets are ratchets: `bundle-budget.json` and `lighthouserc.json` (performance >= 0.95) must not be raised to pass.

## Gates (run before saying done)

1. `pnpm --filter @aedst/web-landing lint typecheck test knip` (or the matching `task web:*` once wired).
2. `pnpm --filter @aedst/web-landing build`, then the bundle-size check against `bundle-budget.json` and `lhci autorun` against `lighthouserc.json`.
3. `task check` from the repo root (naming, file size, colors, i18n, boundaries).
4. View `/en`, `/ar` (RTL) and `/robots.txt`, `/sitemap.xml`, `/llms.txt` in the running site.

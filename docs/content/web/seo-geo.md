---
title: SEO and GEO
description: How the web app is discovered and cited by search engines and AI answer engines, the defaults, and the first-clone checklist.
---

# SEO and GEO

GEO (generative engine optimisation) is SEO for answer engines such as ChatGPT search, Claude, Perplexity and Apple Intelligence: being fetchable, parseable and citable. The mechanics are the same as classic SEO plus a crawler policy, `llms.txt` and structured data.

Scope today: the locale root is the sign-in page and everything else is per-user (see [decisions](/decisions/web): content lives on a separate origin). So the public surface is small: five localized sign-in pages, `robots.txt`, `sitemap.xml`, `llms.txt`. Everything below is wired so that adding public pages later needs one route-table entry.

## What exists

| Surface | Where | Notes |
|---|---|---|
| Site constants | `src/app/config/seo.ts` (`siteConfig`) | name, description, origin, theme, `organization`, `aiCrawlers` |
| Canonical + hreflang | `buildAlternates(pathname, locale)` | public pages only; protected pages are `noindex` and publish no alternates |
| Trailing slash | `src/app/config/trailing-slash.ts`, used by `src/proxy.ts` | `/en/` answers 308 to `/en`; `/ingest`, `/api`, `/monitoring`, `/serwist` are exempt (Next's own redirect is off via `skipTrailingSlashRedirect`) |
| Public route table | `src/app/config/public-routes.ts` | feeds `sitemap.ts` and `llms.txt`; `lastModified` is an ISO date you bump with the page |
| Private paths | `src/app/config/private-paths.ts` | `robots.txt` disallow list derived from module routes with `access: "session"`, plus `/api/`, `/offline/`, `/<locale>/forbidden` |
| Crawler policy | `src/app/config/ai-crawlers.ts`, `src/app/robots.ts` | two bot lists, per-group allow/deny |
| `llms.txt` | `src/app/llms.txt/route.ts` (force-static), `config/llms.ts` | built from `siteConfig` and the route table. The docs site has its own `llms.txt`/`llms-full.txt` |
| Structured data | `src/app/config/structured-data.ts` | Organization + WebSite as one `@graph` in the locale layout; WebApplication on the sign-in page; builders for breadcrumb, FAQ and article ready for public pages. Stable `@id`s derive from the origin |
| Search-console tokens | `buildVerification()` | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION` |
| Placeholder guard | `scripts/check-seo-placeholders.mjs` | `prebuild`; enforces only with `AEDST_REQUIRE_REAL_SEO=1` (`pnpm check:seo`) |

## Crawler defaults

`siteConfig.aiCrawlers = { answerEngines: "allow", trainingCrawlers: "deny" }`.

- **Answer engines (allowed)**: `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `Applebot`. They fetch a page to cite it; blocking them removes the product from AI answers.
- **Training crawlers (denied)**: `GPTBot`, `ClaudeBot`, `anthropic-ai`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Bytespider`, `Amazonbot`, `meta-externalagent`. Blocking them does not affect citations or Google/Bing ranking (`Google-Extended` and `Applebot-Extended` are opt-out tokens, not separate fetchers).
- A bot with its own group ignores the `*` group, so the private paths are repeated in the allowed groups.
- `robots.txt` is advisory: it stops compliant crawlers only. Anything that must not be read needs authentication (session pages already do).

Why this default: a product that wants users to find it through AI answers gains from being cited and gains nothing measurable from being trained on. Flip `trainingCrawlers` to `"allow"` (or `answerEngines` to `"deny"`) in `seo.ts`; the tests in `seo.test.ts` and `e2e/security-seo.spec.ts` pin the default and must be changed with it.

## First-clone checklist

1. Set `NEXT_PUBLIC_SITE_URL` to the real https origin (build-time; used by canonical, sitemap, JSON-LD, llms.txt).
2. Replace the template copy: `siteConfig.description` in `seo.ts` and `common.appDescription` in all five locale catalogues (`src/app/config/i18n/common/*.json`). The guard rejects "AEDST stack" and "task manager".
3. Fill `siteConfig.organization`: `legalName`, `logo` (replace the generated icon if you have a brand mark) and `sameAs` (official profiles only; leave empty rather than guess).
4. Decide the crawler policy (above).
5. Add the Google and Bing verification tokens (token value only, not the whole meta tag), deploy, then verify the property and submit `/sitemap.xml` in both consoles.
6. The release build already sets `AEDST_REQUIRE_REAL_SEO=1` (Dockerfile build stage, passed from `web-release.yml`; repository variable `WEB_REQUIRE_REAL_SEO=0` turns it off for a deliberate staging image). It fails the image build until `siteConfig.description` and the English `appDescription` stop being the template text and `NEXT_PUBLIC_SITE_URL` is a real origin. Local `next build` and the template CI are unaffected. Verify with `pnpm check:seo`.
7. When a public page ships: add it to `publicRoutes`, call `buildAlternates` in its `generateMetadata`, and add JSON-LD with the builders.

## Measuring AI citations

`posthog-js` already records `$referring_domain` on every pageview (after consent, via `/ingest`); there is no custom parser. Create one PostHog insight (Trends, unique users, breakdown by `$referring_domain`):

- Event: `$pageview`
- Filter: `$referring_domain` is one of `chatgpt.com`, `perplexity.ai`, `www.perplexity.ai`, `claude.ai`, `copilot.microsoft.com`, `gemini.google.com`
- Breakdown: `$referring_domain`, then add `$current_url` to see which pages are cited.

Runbook (monthly):

1. Open the insight, compare with the previous period; save it in a "GEO" dashboard.
2. Spot-check citations by asking ChatGPT search, Perplexity and Claude with 5 to 10 questions the product should answer, and note whether the domain is cited.
3. Check Bing Webmaster Tools (feeds ChatGPT search and Copilot) and Google Search Console for coverage errors.
4. Cross-check server access logs for `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Claude-User` hits: PostHog only sees visitors who consented, so it undercounts.
5. If a referrer is missing from the list, add the domain to the insight filter; nothing in code changes.

Limits: many AI apps strip the referrer, so referrer counts are a lower bound; treat them as a trend, not a total.

## Optional: public site module - needs owner approval

Not implemented. A public `site` module (`/about`, `/faq`, `/changelog`, `/privacy`, header/footer) contradicts the recorded decision that the root is sign-in and marketing content lives on a separate origin (the nonce-CSP decision makes every page dynamic). Implement only if the owner reverses that.

Estimate: 3 to 4 days including i18n (five locales) and tests.

Proposed files (all new unless noted):

- `src/modules/site/{manifest.ts,public.ts}` with `routes: [{ path: "/about", access: "public" }, ...]`, registered in `config/modules/registry.ts` and `messages.d.ts`
- `src/modules/site/i18n/{en,ru,tj,uz,ar}.json`
- `src/modules/site/ui/{SiteHeader,SiteFooter,FaqList,ChangelogEntry}.tsx`
- `src/app/(pages)/[locale]/(public)/layout.tsx` and `about|faq|changelog|privacy/page.tsx`; FAQ uses `faqPage()`, changelog uses `article()`, all use `breadcrumbList()` and `buildAlternates()`
- `src/modules/site/lib/changelog.ts` reading `CHANGELOG.md` at build time
- update `config/public-routes.ts`, `e2e/site.spec.ts`

C11 (follow-up, depends on the above): `feed.xml` via the `feed` package (6.0.0 on npm, checked 2026-10-08; add to Library-First first), an IndexNow key route (`/<key>.txt`) and a `pingIndexNow()` call from the release workflow. Without public content there is nothing to syndicate or ping.

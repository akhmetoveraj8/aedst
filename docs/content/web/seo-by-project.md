---
title: "SEO and performance by web project"
description: "What marketing, app and admin must do about indexing, SEO and performance: marketing is built for maximum SEO, app for speed with a small public surface, admin is never indexed."
---

# SEO and performance by web project

Three projects, three contracts. The mechanics (helpers, crawler policy, `llms.txt`) are described in
[SEO and GEO](/web/seo-geo); budgets and gates in [performance](/engineering/performance) and
[roadmap coverage](/engineering/checklists).

| | `marketing` | `app` | `admin` |
|---|---|---|---|
| Indexing | Every page indexable | Public pages only (sign-in); signed-in pages `noindex` | **Never** |
| Rendering | Static (SSG), no per-request work | Server Components, dynamic HTML (nonce CSP) | SPA behind the BFF |
| SEO surface | Full | Minimal | None |
| Performance bar | Lighthouse performance >= 0.95, LCP <= 2 s, CLS <= 0.05, TBT <= 150 ms, script <= 152 kB | performance >= 0.9, LCP <= 3 s, CLS <= 0.1, TBT <= 300 ms, per-route first-load budget | Bundle budget for the entry, the largest chunk, the total, CSS and fonts |

## `marketing`: maximum SEO, maximum speed

A page is not done until all of this holds:

1. **Metadata from one helper**: unique `title` and `description` per page and locale, `canonical`,
   `hreflang` for en, ru, tg, uz, ar plus `x-default`, and `openGraph.url` equal to the canonical of
   **that page** (not of the locale root).
2. **In the sitemap** with its alternates and a real `lastModified`; `robots.txt` allows it.
3. **Structured data** that matches the visible content: Organization and WebSite site-wide;
   SoftwareApplication, FAQPage, BreadcrumbList, Article where the page has that content. Never mark up
   what the page does not show.
4. **Semantic HTML**: one `h1`, ordered headings, landmarks, descriptive link text, `alt` on content
   images.
5. **Static and light**: no client component unless the page needs interaction (disclosure is native
   `<details>`, the language picker is plain links, the theme follows the system through one inline
   script; a page ships about 137 KB of JavaScript, 132 KB of it the framework), no third-party script,
   `next/image` with explicit size and `priority` only on the LCP image, `next/font` with at most two
   families, no layout shift from late content.
6. **Real copy**: no placeholder text in a release build (the placeholder guard must cover `marketing`
   as it covers `app`).
7. **Answer engines**: the page is listed in `llms.txt`; the crawler policy is the one in `seo.ts`.
8. **Social card**: a per-locale Open Graph image of 1200 by 630.

Gates in `marketing-ci.yml` (2026-11-21): the bundle and font budget (`pnpm check:bundle`), Playwright on
the built site (`e2e/seo.spec.ts`: for each of the 3 pages in each of the 5 locales, `canonical`, the
`hreflang` set with `x-default`, `og:url` equal to the canonical, JSON-LD that parses with the expected
`@type`s, one `h1`; `e2e/accessibility.spec.ts`: axe at WCAG 2.2 AA including right-to-left), Lighthouse CI
(`pnpm lighthouse`), and the placeholder guard as `prebuild` (enforced when `AEDST_REQUIRE_REAL_SEO=1`,
which the release image sets). Both pass locally: 25 e2e tests, and Lighthouse on `/en`, `/ru`, `/ar` and `/en/privacy` (12 runs,
performance 0.94 to 0.98, script 148 kB against 152 kB), see [status](/status). The workflow has never
run on GitHub.

## `app`: fast, small public surface

- Signed-in pages are `noindex` in the `(app)` layout and listed under `Disallow` in `robots.txt`; they
  publish no canonical, no alternates and no JSON-LD.
- Public pages (sign-in today) follow rules 1 to 4 above.
- Performance is the budget files; a new route adds its own line to `bundle-budget.json`.
- A new public page: add it to `publicRoutes`, call `buildAlternates`, add JSON-LD.

## `admin`: never indexed

All three layers are required, because each covers a different crawler behaviour:

1. `X-Robots-Tag: noindex, nofollow, noarchive` on every BFF response (header, tested).
2. `<meta name="robots" content="noindex, nofollow">` in `index.html`.
3. `GET /robots.txt` served by the BFF: `User-agent: *` / `Disallow: /` (route, tested).

Never add a sitemap, `llms.txt`, JSON-LD, Open Graph tags or a canonical to `admin`. It still gets a
bundle budget (`admin/bundle-budget.json`: entry, largest chunk, total, CSS, fonts) and the accessibility
gates (axe in `admin/e2e/accessibility.spec.ts`), both in `admin-ci.yml`: staff are users too.

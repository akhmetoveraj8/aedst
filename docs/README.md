# aedst-docs

The AEDST documentation site: a [Nextra 4](https://nextra.site) docs-theme app (Next.js App Router, TypeScript) that publishes `content/` — architecture, module boundaries, and ADRs for the whole monorepo.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Nextra 4** (`nextra` + `nextra-theme-docs`), TypeScript throughout (`.tsx`, not `.jsx`)
- **Pagefind** for full-text search, indexed as a `postbuild` step

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Adding a page

Add a `.md`/`.mdx` file under `content/` (nested folders map to nested routes) and list it in that folder's `_meta.ts` for a sidebar title and explicit ordering — an unlisted page still renders, appended alphabetically. Link to other pages by absolute site path (e.g. `[modules](/server/modules)`), not by relative `.md` filename — Nextra does not guarantee `.md`-suffixed relative links resolve to the right route.

## Build

```bash
pnpm build   # next build, then pagefind indexing (postbuild)
pnpm start   # serve the production build
```

`pnpm build` alone does not produce a working search index — the `postbuild` script (`pagefind --site .next/server/app --output-path public/_pagefind`) must run after it; `pnpm build` runs both.

## Known upstream issue: pinned `zod`

`pnpm-workspace.yaml` pins `zod` to `4.3.6` via `overrides`. `nextra-theme-docs@4.6.1`'s `<Layout>` throws `Invalid input: expected nonoptional, received undefined -> at children` on `zod >=4.4.0` (upstream: [shuding/nextra#4989](https://github.com/shuding/nextra/issues/4989), [#5008](https://github.com/shuding/nextra/issues/5008), [#5036](https://github.com/shuding/nextra/issues/5036)). Drop the override once a `nextra-theme-docs` release ships the fix from [#4990](https://github.com/shuding/nextra/pull/4990).

## Machine-readable endpoints and site config

`/llms.txt` (page index), `/llms-full.txt` (all pages, front matter stripped, each preceded by `Source: <url>`), `/sitemap.xml` and `/robots.txt` are static and generated from `content/` at build time (`lib/content.ts`), so new pages need no registration. Environment: `NEXT_PUBLIC_DOCS_URL` (canonical origin, sets `metadataBase`), `NEXT_PUBLIC_DOCS_REPO_BASE` (omit: no edit link), `NEXT_PUBLIC_DOCS_LICENSE` (footer; default says no licence chosen), `DOCS_LASTMOD` (sitemap fallback when git history is unavailable), `DOCS_ALLOW_AI_TRAINING=true` (default: training crawlers disallowed, answer engines allowed). Sitemap dates need `fetch-depth: 0` in CI. Smoke check after `pnpm build`: the four files exist in `.next/server/app/` (`llms.txt.body`, `llms-full.txt.body`, `sitemap.xml.body`, `robots.txt.body`); unit tests: `pnpm test`.

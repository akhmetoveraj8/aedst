---
title: "Marketing: static export and hash CSP"
description: "How apps/web/marketing is built (Next.js output export), why its CSP lists SHA-256 hashes instead of 'unsafe-inline', and what the static host must do."
---

# Marketing: static export and hash CSP

`apps/web/marketing` is a **static export** (`output: "export"`): `next build` writes the whole site to `out/`, and a
static host serves it. There is no Node server, no proxy and no `headers()` at runtime. Owner decision, 2026-11-25
([decisions/web](/decisions/web)).

## Why hashes

A nonce needs a request to bind to, so it forces dynamic rendering (that is the cost `app` pays). A static page has no
request, so the options were `script-src 'self' 'unsafe-inline'` (what the site shipped before) or a hash of every
inline script. Hashes keep the page static **and** keep inline script out: only the exact bytes that were built can
run. `style-src` is `'self'` (no inline style exists on the localized pages), and no third-party origin is allowed.

```
default-src 'self'; script-src 'self' 'sha256-…' 'sha256-…'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

## How it is built

| Step | What | Where |
|---|---|---|
| 1 | `next build` renders every page to `out/*.html` | `next.config.ts` |
| 2 | Read every `out/**/*.html`, hash each inline `<script>` (not `application/ld+json`, which is data) with SHA-256, fail on any inline `<style>` or `style=` attribute | `scripts/build-security-headers.mjs` |
| 3 | Write the per-page CSP and the common headers (`out/_headers` for Netlify and Cloudflare Pages, `headers/nginx-*.conf` for nginx, `headers/pages.json` for the local server) | same script, policy in `scripts/security-policy.mjs` |
| 4 | Serve | `deployments/nginx` (production image), `scripts/serve-out.mjs` (`pnpm start`, Playwright, Lighthouse CI) |

The hashes are computed from the emitted bytes, so they cannot drift from the page. They change whenever a page's
inline scripts change (Next's hydration payload differs per page), which is why the policy is per URL and generated
after every build. **Never edit the generated files and never hand-copy a hash.**

## What the static host must do

1. Send the page's own `Content-Security-Policy` (and the common headers) on its document, including its 404.
2. Serve `/<locale>` from `<locale>.html` (clean URLs, no trailing slash) and `/` as a redirect to the locale in
   `Accept-Language` (`tg` is Tajik, the URL locale is `tj`), with `Vary: Accept-Language`. `index.html` (a
   zero-second meta refresh plus a link per language) is the fallback for hosts that cannot negotiate.
3. Answer unknown paths with 404 and the document of the URL's locale: `/<locale>/404`, default locale otherwise. The
   unlocalized `_not-found` page Next emits is removed (it carries inline styles) and `404.html` is a copy of
   `en/404.html`.
4. Cache `/_next/static/*` as immutable; send the metadata files (`robots.txt`, `sitemap.xml`, `llms.txt`,
   `manifest.webmanifest`, OG images) with `s-maxage=3600, stale-while-revalidate=86400`.

Two hosts that **join** the values of every matching `_headers` rule (Cloudflare Pages, Netlify) would intersect two
CSPs, so `out/_headers` puts the common headers under `/*` and only the CSP under each page.

## Rules for contributors

- A new inline script is allowed to exist (its hash is generated), but prefer a file. A new third-party origin is added
  to `scripts/security-policy.mjs` in the same change and named in the PR.
- No `headers()`, `cookies()`, `searchParams`, redirects, rewrites, proxy, Server Actions or default-loader
  `next/image`: `output: "export"` rejects them at build time.
- A metadata route (`robots.ts`, `sitemap.ts`, `manifest.ts`, `opengraph-image.tsx`) exports
  `dynamic = "force-static"`; a dynamic route has `generateStaticParams`.
- `e2e/csp.spec.ts` asserts, on every page and locale, a hash-only `script-src`, zero `securitypolicyviolation`
  events and a working theme script. `e2e/accessibility.spec.ts` bypasses the CSP only because its helper injects a
  `<style>`.

## Status (verified and not)

Verified on 2026-11-25 (Windows, Node 24, Next.js 16.4.6): the export builds, 21 pages and 94 hashes are generated,
the 43 Playwright specs pass against `scripts/serve-out.mjs` in Chromium with no CSP violation, `pnpm check` and
`pnpm check:bundle` are green. **UNVERIFIED:** `deployments/nginx/nginx.conf` and the Docker image (no Docker or nginx on
the authoring machine: run `nginx -t` and the first image build), `out/_headers` on a real Cloudflare Pages or Netlify
site, Lighthouse CI against the new server, and any browser other than Chromium.

# @aedst/web-marketing

Public marketing site for AEDST: static, five locales (en, ru, tj, uz, ar), SEO and GEO first. Own domain, port 3002,
independent of `../app` (the signed-in product) and `../admin`. Shares only `../shared` (source-only kit).

```
pnpm --filter @aedst/web-marketing dev      # http://localhost:3002
pnpm --filter @aedst/web-marketing build    # static export in out/ + generated CSP in headers/
pnpm --filter @aedst/web-marketing start    # serves out/ with those headers (not for production)
pnpm --filter @aedst/web-marketing test
```

Environment (`.env.example`): `NEXT_PUBLIC_SITE_URL` (this site), `NEXT_PUBLIC_APP_URL` (CTA target), optional
search-console tokens.

Layout: `src/app` (routes, SEO files, config), `src/modules/marketing` (sections, copy), `src/modules/legal`
(privacy, terms). Agent rules: [AGENTS.md](AGENTS.md). Deployment: `deployments/docker/Dockerfile` (build context
`apps/web`).

Status: written without installing dependencies; not yet type-checked, built or run.

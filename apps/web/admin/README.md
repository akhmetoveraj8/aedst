# apps/web/admin

The AEDST admin panel: a separate Next.js 16 project (`@aedst/web-admin`) that is deployed on its own
domain (for example `admin.<domain>`), next to the product app (`../app`) and the marketing site (`../landing`).
It shares only the source-only kit in `../shared` (UI, generated Connect clients, auth helpers, i18n).

- URLs: `/{locale}/admin`, `/users`, `/tasks`, `/broadcast`, `/audit` (en, ru, tj, uz, ar). `/{locale}` redirects to `/{locale}/admin`.
- Own sign-in: admin is a separate OIDC client (`aedst-admin`, redirect `${ADMIN_ORIGIN}/api/auth/callback`, post-logout `${ADMIN_ORIGIN}`) with its own cookies (`aedst_admin_session`); an anonymous visitor goes to `/api/auth/login`; a signed-in user
  without the `admin` role lands on `/{locale}/forbidden`. apps/server enforces the role on every call.
- The browser only talks to this origin: `/api/rpc` is a backend-for-frontend proxy (AdminService and capabilities only) that
  attaches the httpOnly-cookie session. Never indexed, no PWA, no analytics.

## Run

```
cp .env.example .env.local     # NEXT_PUBLIC_APP_URL only feeds the "back to app" link
pnpm dev                       # http://localhost:3001 (apps/server on :8080, app on :3000)
pnpm test && pnpm lint && pnpm typecheck && pnpm knip && pnpm check:deps
```

Generated Connect clients come from `pnpm --filter @aedst/web-app connect:generate` (they land in `../shared/api/connect/generated`).

Container: `deployments/docker/Dockerfile` (build context is the repository root, port 3001, health check `/api/healthz`).
Rules for contributors and AI agents: [AGENTS.md](AGENTS.md).

Status: written without installing dependencies, so none of the commands above has been run yet (see the hand-off notes of the web split).

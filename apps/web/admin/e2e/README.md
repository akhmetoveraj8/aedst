# admin e2e

Playwright specs for the admin panel (`playwright test`, script `pnpm test:e2e`; first run `pnpm test:browser:install`).

- `playwright.config.ts` starts two servers: the shared mock API and the built admin (`pnpm build:all` then `pnpm start`: the Vite `dist/` served by the Hono BFF, in production mode) on port 3101 (`E2E_ADMIN_PORT`; not the dev port 3001, so a dev server without the mock environment is never reused). In CI the build runs in an earlier step.
- The mock API (`../app/e2e/mock-api/server.mjs`) is one process for both web projects: an in-memory stand-in for `apps/server` and an OpenID Connect provider with two clients, `aedst-web-e2e` (app) and `aedst-admin` (this project). It is test infrastructure for the server contract and stays single-sourced in `app/e2e`. Port 8181; the app's config starts the same command, so running both suites reuses one instance locally.
- `support/fixtures.ts` imports `mockApi`, `submitIdpForm` and `SeededUser` from `../../app/e2e/support/fixtures` and adds the admin sign-in: `/api/auth/login` -> mock IdP form -> `/api/auth/callback` -> `/en/admin` (via `?next=/admin`). Fixtures: `admin` (role `admin`) and `member` (no admin role), both seeded through the mock API and signed in through the UI.
- `access.spec.ts`: anonymous visitor goes to the IdP, non-admin gets `/forbidden`, admin reaches the overview. `admin.spec.ts`: overview, directories, audited delete, audit log, broadcast (the recipient's inbox is read from the mock API; the inbox UI is the app project's).
- The admin session cookie is `aedst_admin_session`, so an admin run never shares a session with the app project.

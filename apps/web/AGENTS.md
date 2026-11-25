# apps/web - AI agent instructions (workspace overview and router)

`apps/web` is NOT one app. It is a pnpm workspace of four directories. Read the root [AGENTS.md](../../AGENTS.md) and
[CONVENTIONS.md](../../CONVENTIONS.md), pick ONE project below, then read that project's own `AGENTS.md` before writing code.
Architecture, auth flow, CSP and deployment per project: [docs/content/web/projects.md](../../docs/content/web/projects.md).

## What goes where

| Directory    | Package                | What it is                                                                                                                                                          | Port / domain                    | Read next                                  |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| `app/`       | `@aedst/web-app`       | The product: everything a signed-in end user does (tasks, media, notifications, search, sign-in)                                                                    | 3000 / `app.<domain>` (proposed) | [app/AGENTS.md](app/AGENTS.md)             |
| `admin/`     | `@aedst/web-admin`     | Staff panel: operations only staff may do (users, audit log, broadcasts)                                                                                            | 3001 / `admin.<domain>`          | [admin/AGENTS.md](admin/AGENTS.md)         |
| `marketing/` | `@aedst/web-marketing` | Anonymous marketing and SEO/GEO pages, static, no auth                                                                                                              | 3002 / `<domain>`                | [marketing/AGENTS.md](marketing/AGENTS.md) |
| `shared/`    | `@aedst/web-shared`    | Source-only kit used by 2+ projects: `ui` (shadcn), `api/connect`, `lib` (auth, errors, forms, analytics), `env`, `i18n`, `intl`, `date`, `modules` (manifest type) | none                             | [shared/README.md](shared/README.md)       |

Decision rule, in this order:

1. A signed-in end-user feature -> `app`. 2. A staff-only operation -> `admin`. 3. An anonymous marketing/SEO page -> `marketing`.
2. Used by two or more projects AND not product-specific (a primitive, a client, a formatter) -> `shared`. Nothing else goes in `shared`:
   a product screen, a module, a route or a one-project helper stays in its project, even if you expect to reuse it later.
3. Unsure between two projects: stop and ask the owner. Do not duplicate code across projects to avoid the question.

## Dependency direction (enforced by `task check:boundaries` and Biome)

- `app`, `admin`, `marketing` -> `shared` only, via the alias `@/shared/*` (maps to `apps/web/shared/*`, a sibling of each `src/`).
- Auth: `app` and `admin` are SEPARATE OIDC clients (`aedst-web`, `aedst-admin`) with their own `__Host-` cookies and `AUTH_COOKIE_NAME`; never share a session or cookie ([projects.md](../../docs/content/web/projects.md)).
- Projects NEVER import each other (`../app/src`, `../admin/src` are forbidden). They meet only in `shared/` and over the network (ConnectRPC to `apps/server`).
- `shared` NEVER imports a project (`@/app/*`, `@/modules/*`); in tests only `@/test/*` of the host project `app`.
- Inside a project: `app -> modules -> shared`; modules never import each other. Code outside a module imports only its `public.ts`, `manifest.ts` or `entries/*`.
- Inside a module ([modules-and-features](../../docs/content/architecture/modules-and-features.md)): `features/<feature>/{ui,lib}` holds one capability; a feature never imports another feature; code two features share lives in the module's own `lib/` or `ui/`, which import no feature. A module with one capability stays flat (`ui/`, `lib/`).
- Gate for all of the above in all three projects: `bash apps/web/app/scripts/check-feature-boundaries.sh <project-dir>` (`pnpm check:feature-boundaries` in each project, `task check:boundaries` for all). Import cycles: Biome `noImportCycles`; unused (orphan) files: knip. dependency-cruiser was removed on 2026-11-25 ([decisions/web](../../docs/content/decisions/web.md)).
- Storybook of `shared/ui` and the vitest of `shared/**` tests are hosted by `app`; a `shared/` change must pass all three projects.

## Validation boundary (mandatory, machine-enforced)

API-message forms: Protovalidate through `protovalidateResolver`, rules only in the `.proto`. Zod: env, storage, non-proto input, never in `ui/**`. React Hook Form: state only (no `register` rules, no `rules=`, `useForm` always has a `resolver`). Full table: [validation](../../docs/content/web/validation.md). Gates: Biome plugins + `pnpm check:validation` (in `pnpm check:selftest`).

## Starting a task

- Product feature: `app/src/modules/tasks` is the reference module and `app/src/modules/tasks/features/list` the reference feature. Admin screen: `admin/src/modules/admin`. Marketing section: `marketing/src/modules/marketing`.
- New feature in an existing module (`app`, `admin`): `node scripts/new-feature-web.mjs MODULE=<m> NAME=<f> [--project=admin]` (the web part of `task new:feature`).
- New primitive: `shared/ui` with a `.stories.tsx`. New shared lib: copy a sibling in `shared/lib`.
- New RPC client / proto change: `task app:generate` regenerates `shared/api/connect/generated` (gitignored, never hand-edit).
- New module on all platforms: `task new:module -- NAME=<id>` ([new-module.md](../../docs/agent/new-module.md)).

## Versions: one place

Every web dependency version lives ONCE in the `catalog:` of [pnpm-workspace.yaml](pnpm-workspace.yaml). A `package.json` says `"catalog:"`, never a literal version.
Bump = edit the catalog only. ONE install for everything: `pnpm --dir apps/web install --frozen-lockfile` (or `task setup`). A new dependency also needs the
project's knip allowlist and [library-first/web.md](../../docs/content/library-first/web.md) in the same change. One Biome config: `biome.json` here.

## Commands (from the repo root; `web:*` runs all three projects)

| Project   | Dev                  | Gates                                                                                                                                             |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| app       | `task app:dev`       | `task app:lint app:knip app:test` (+ `app:build`, `app:check:bundle`, `app:test:e2e`)                                                             |
| admin     | `task admin:dev`     | `task admin:lint admin:knip admin:test` (+ `admin:build`, `admin:check:bundle`, `admin:test:e2e`)                                                 |
| marketing | `task marketing:dev` | `task marketing:lint marketing:knip marketing:test` (+ `marketing:build`, `marketing:check:bundle`, `marketing:test:e2e`, `marketing:lighthouse`) |
| all       | `task web:dev`       | `task web:lint web:knip web:test web:build web:check:bundle web:check:source`, then `task check`                                                  |

Build tooling used by two or more projects lives in `shared/scripts/` (bundle budget, SEO placeholder guard, source bans); each project calls it from its own `package.json`.

## Vibe coding checklist

1. Name the project first (table above) and open its `AGENTS.md`. Never start by editing `shared/`.
2. Copy the reference file the project's table names; do not invent a new pattern.
3. Use `shared/ui` for UI, generated clients for the server, tokens for color, `shared/env` or the project's `env.ts` for variables.
4. Keep files at or under 300 lines; every file name kebab-case (`task-form.tsx` exports `TaskForm`); English only; all five locales (`en ru tj uz ar`) for every string.
5. Run the project's gates, then `task check`; if you touched `shared/`, run `task web:lint web:test`. Claim only what ran.

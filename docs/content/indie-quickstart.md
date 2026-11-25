---
title: Indie quickstart
description: "The shortest path for a solo builder: derive a Core-only product (Server + Web) from the template, start the minimal local stack and get a running app in five commands, with the safety net that catches mistakes."
---

# Indie quickstart

For one person (or one person and an AI agent) who wants a running product, not a tour. You keep only **Core**:
the Go server and the web apps. Android, Apple, Desktop and Gateway are removed; you can add a platform later from
the full template, after Core is green ([Core first](../agent/rules.md#core-first)
in the agent rules).

## What you need

- [mise](https://mise.jdx.dev) (installs the pinned Go, Node, pnpm, buf, sqlc, Task and linters from `mise.toml`).
- Docker (local Postgres, DragonflyDB and the ZITADEL identity provider).
- A clean clone of your own repository made from the template (`gh repo create <you>/<product> --template <org>/aedst --private --clone`).

Nothing else: no JDK, Xcode or Rust toolchain for Core.

## The minimal local stack

`apps/server/deployments/docker/docker-compose.yml` starts **Postgres** and **DragonflyDB** without any profile. Core
needs exactly one profile on top: **`idp`** (ZITADEL, because the server is an OIDC resource server and refuses to start
without `AEDST_OIDC_ISSUER` and `AEDST_OIDC_AUDIENCE`). Every other profile is optional and off by default:

| Profile | Adds | When you need it |
|---|---|---|
| (none) | Postgres, DragonflyDB | always |
| `idp` | ZITADEL + its Postgres + Traefik | always for sign-in |
| `media` / `minio` | MinIO, imgproxy | file uploads and images |
| `search` | Meilisearch | ranked search (Postgres `pg_trgm` works without it) |
| `flags` | flagd | feature flags (code defaults apply without it) |
| `observability` | Grafana LGTM | traces, logs, metrics |
| `pgbouncer`, `loadtest` | pooler, load balancer | scaling experiments only |

Status: the `idp` compose stack itself has not been brought up on the authoring machine yet (see
[`apps/server/deployments/zitadel/README.md`](../../apps/server/deployments/zitadel/README.md)); `bootstrap.sh` was run
against ZITADEL directly. Report what you hit.

## Five commands

Run them from the repository root.

```bash
# 1. Pinned toolchains.
mise install

# 2. Turn the template into your product, Core only (look first with --dry-run; --in-place needs a clean git tree).
task template:new -- --name "<Brand>" --profile core --in-place

# 3. Git hooks, web and docs dependencies, generated code.
task setup

# 4. Postgres + DragonflyDB + ZITADEL, then create the OIDC project, apps and a dev user (prints the AEDST_OIDC_* values).
task server:up PROFILES="--profile idp" && bash apps/server/deployments/zitadel/bootstrap.sh

# 5. Migrate and run the server (in a second shell: task app:dev for the product app on http://localhost:3000).
task dev
```

Between steps 4 and 5, once: export the printed `AEDST_OIDC_*` values in the shell that runs `task dev` (start from
`apps/server/.env.example`; the server reads only the environment), and copy `apps/web/app/.env.example` to
`apps/web/app/.env.local` with the `aedst-web` client from the same output. Then sign in as the `dev` user.

`task doctor` tells you what this machine can verify; `task --list` shows every command.

## Building your first feature

1. Write the spec first (the `write-spec` skill, or copy `apps/server/specs/_template.md`).
2. `task new:module -- NAME=<id> --platforms=server,web` stamps the module on Server and Web only.
3. Follow [new-module](../agent/new-module.md) for what the generator leaves out, and
   [client-recipe](/client-recipe) for the web side.
4. Before you call it done: `task check`, `task verify:server`, `task verify:web` (they print the exact commands).

## The safety net

You do not have to remember the rules; these catch the common mistakes:

| Layer | What it does |
|---|---|
| Agent hooks (`.claude/hooks/`) | Refuse dangerous code at write time (`eval`, shell strings, string-built SQL, raw HTML sinks, disabled TLS, literal secrets), edits to generated files, and destructive git commands |
| Git hooks (`lefthook.yml`, installed by `task setup`) | Biome and typecheck on staged web files, secret scanning before a commit |
| `task check` | Naming, file size, colour literals, i18n parity, module boundaries, knip, migration lint, design tokens, docs links, dangerous-code patterns |
| CI (`.github/workflows/`) | The same gates plus Semgrep SAST, secret scanning, `govulncheck`, unit and browser tests, bundle budgets |

When a gate refuses something, use the safe form it names; never waive it yourself. Details:
[ai-safe-code](/engineering/ai-safe-code) and [status](/status) for what is verified today.

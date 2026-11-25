---
title: Start here
description: "The whole AEDST template in 15 minutes: what it is, the parts, the stack, how one request travels, where code goes and which page to read next."
---

# Start here: AEDST in 15 minutes

Read this page first. It explains the whole template in plain words and sends you to the one page that owns each detail. Nothing here replaces the deep pages; it is the map.

## What AEDST is (and is not)

AEDST is an **empty, AI-friendly product template**. You copy it, rename it, and add your own product on top.

| It is | It is not |
|---|---|
| One repository (a monorepo) with a **Go backend** and **web, Android, Apple and Desktop clients** | A finished product: there is no business domain in it |
| A set of **global modules** almost every product needs: tasks (the worked example), search, notifications, media, admin | A user system: sign-in, MFA and the user directory belong to an OpenID Connect provider (ZITADEL by default) |
| Strict **rules enforced by tools** (naming, boundaries, file size, security patterns) so humans and AI agents write the same shape of code | A microservice mesh: it is one deployable that **can** be split later without a rewrite |

The one sentence that explains the design: **monolith first, boundaries first, microservices later** ([ADR-0001](/decisions/0001-modular-monolith)).

## Working mode today: Core first

| Profile | Contains | State |
|---|---|---|
| **Core** (default) | `apps/server` (Go) and `apps/web` (TypeScript) | Built, tested and gated on every change |
| Frozen | `apps/android`, `apps/apple`, `apps/desktop`, `apps/gateway` | Not verified end to end; bug fixes only, no new features until each has a green CI run |

Why: a feature costs about five times more when it must land on five platforms and only two are verified. The honest, current evidence is in [Platform status](/status). Never claim a frozen platform builds.

## The parts

```
                    +---------------------------+
   Browser  ------> |  apps/web  (Next.js, Vite)|--+
   Android  ------> |  apps/android (Compose)   |  |   ConnectRPC (HTTP + Protobuf)
   iOS/mac  ------> |  apps/apple   (SwiftUI)   |  +----------------------+
   Desktop  ------> |  apps/desktop (Rust+Slint)|                         |
                    +---------------------------+                         v
                                                        +-------------------------------+
   Identity provider (ZITADEL, any OIDC) <--verifies--- |  apps/server  (Go monolith)   |
                                                        |  tasks | media | search       |
   apps/gateway (Rust, WebSocket) <--NATS events------- |  notifications | admin | ...  |
        |                                               +-------+-----------------------+
        v realtime "nudge" to clients                           |
                                              PostgreSQL (data + job queue)   DragonflyDB (cache)
                                              S3-compatible storage (media)
```

| Directory | What it is | Read next |
|---|---|---|
| `apps/server` | Go modular monolith: the only owner of data and rules | [Server architecture](/server/architecture), [Modules](/server/modules) |
| `apps/web` | Three web projects plus a shared kit: `app` (signed-in users), `admin` (staff), `marketing` (public site), `shared` | [Web projects](/web/projects), [Web architecture](/web/architecture) |
| `apps/android`, `apps/apple`, `apps/desktop` | Native clients that follow the same module and feature layout | [Clients](/architecture/clients) |
| `apps/gateway` | Optional Rust WebSocket server that pushes realtime "something changed" nudges | [ADR-0021](/server/architecture), [Containers](/architecture/containers) |
| `packages/design-tokens` | Colors, spacing and type defined once, generated for all platforms | [UI kit](/ui-kit) |
| `docs` | This documentation site (Fumadocs on Next.js) | Run it with `pnpm --dir docs dev` |
| `scripts`, `Taskfile.yml`, `mise.toml`, `lefthook.yml` | The single command entry point, pinned toolchains, git hooks and all policy checks | [Commands](#commands-you-will-actually-use) |
| `features.yaml`, `ui-kit.yaml` | Machine-readable parity matrix and UI component manifest, checked in CI | [Parity](/parity), [UI kit](/ui-kit) |
| `.claude`, `AGENTS.md`, `CLAUDE.md` | Rules, hooks, skills and reviewer agents for AI-assisted work | `docs/agent/INDEX.md` in the repository |

## The stack at a glance

| Layer | Choice | Why in one line |
|---|---|---|
| API contract | **Protobuf + Buf**, served by **ConnectRPC** | One `.proto` generates server stubs, every client and the API reference ([ADR-0002](/decisions/0002-connectrpc)) |
| Backend | **Go**, `net/http` ServeMux, no third-party router | Small, fast, one binary |
| Database | **PostgreSQL** via **pgx**, **sqlc** (typed SQL), **Goose** (migrations) | SQL stays SQL; no ORM ([ADR-0003](/decisions/0003-postgresql)) |
| Jobs and events | **River** (jobs in Postgres) | A change and its events commit in one transaction ([ADR-0005](/decisions/0005-river-for-jobs), [ADR-0014](/decisions/0014-river-insert-tx-as-outbox)) |
| Cache, rate limits | **DragonflyDB** (optional) | Correctness never depends on it |
| Realtime | **Rust gateway** over WebSocket, **NATS JetStream** (optional) | Fans out nudges without loading the monolith ([ADR-0021](/server/architecture)) |
| Identity | **OIDC provider** (ZITADEL by default) | The server verifies tokens and never stores passwords |
| Observability | **OpenTelemetry**, optional Prometheus | Traces, metrics and logs from day one |
| Web | **Next.js 16**, **React 19**, **TanStack Query**, **shadcn/ui**, **React Hook Form + Zod**, **next-intl**; `admin` is a **Vite** SPA | Approved list in [Library-First: web](/library-first/web) |
| Android | **Kotlin, Jetpack Compose, Metro**, connect-kotlin, Room | [Android stack](/android/stack) |
| Apple | **Swift, SwiftUI**, GRDB, connect-swift, Tuist | [Apple stack](/apple/stack) |
| Desktop | **Rust, Slint**, connectrpc, openidconnect, rusqlite | [Desktop stack](/desktop/stack) |
| Tooling | **mise** (pinned toolchains), **Task** (commands), **lefthook** (git hooks), **Biome** (web lint and format), **golangci-lint**, **Renovate** | One way to run everything |

Exact versions live on each platform's Stack page and are checked against the registries; the table above deliberately has none so it never goes stale.

## How one request travels

Example: a user completes a task.

1. The client calls `TasksService/CompleteTask` with its access token. The web app calls its own `/api/rpc` route first, which attaches the token from an `httpOnly` cookie.
2. The server runs a fixed **interceptor chain**: tracing, client-version gate, rate limit, token verification, role policy, validation from the `.proto`, idempotency key ([Request lifecycle](/architecture/request-lifecycle)).
3. The `tasks` handler takes the caller from the token (never from the request body) and calls its application service.
4. In **one database transaction** the task row is updated and one job per subscriber is inserted. Either both commit or neither does.
5. The client gets its answer. After the commit, **River workers** deliver the event to `notifications` (an inbox entry), `search` (an updated document) and optionally webhooks.
6. If the gateway is on, the event also becomes a WebSocket nudge so open clients refresh.

The principle behind steps 4 and 5: **events travel through the database**, so nothing is lost and nothing is published twice ([Data and events](/architecture/data-and-events)).

## The five rules behind every decision

1. **Boundaries first.** A module owns its data and exposes only a contract. Other modules call that contract, never its tables or packages. Checked by `architecturetest` and the boundary scripts.
2. **Contract first.** Change the `.proto` first; code is generated, never committed or hand-edited ([API design](/engineering/api-design)).
3. **Stateless compute, stateful data.** Pods keep no session; scale by adding replicas. The database is the shared bottleneck and is protected on purpose ([Scalability](/architecture/scalability)).
4. **Library-first.** Never write what the standard library, the platform or an approved dependency already does ([Library-First](/library-first)).
5. **Honest status.** Say what was built and run, mark the rest `UNVERIFIED` ([Platform status](/status)).

## Module, then feature (the shape of all code)

Every platform has the same two levels ([Modules and features](/architecture/modules-and-features)):

```
module   a business area with its own data and contract      tasks, media, notifications
  feature  one user-visible capability inside it (vertical slice)   create, complete, remind
```

- A module never imports another module's internals; a feature never imports another feature.
- Dependencies point one way: `feature -> module shared code -> platform/core`.
- The module id is the same string on every platform and in `features.yaml`.
- Reference implementation: the **tasks** module on server and web. Copy its shape for your own modules.

## Where does my change go?

| I want to... | Go to |
|---|---|
| Add a new business area on all platforms | `task new:module -- NAME=<id>`, then follow `docs/agent/new-module.md` |
| Add one capability to an existing module | `task new:feature -- MODULE=<m> NAME=<f>` |
| Add or change an API | [API design](/engineering/api-design): edit the `.proto` under `apps/server/api/proto/aedst/<module>/v1/` first |
| Add a database table | A Goose migration in `apps/server/migrations` plus a query in `apps/server/sql`, then `task generate` |
| Add a screen on web | The module under `apps/web/app/src/modules/<module>/features/<feature>/{ui,lib}`, built from `apps/web/shared/ui` only |
| Add a UI component | `ui-kit.yaml` first, then web, then the other platforms ([UI kit](/ui-kit)) |
| Add a user-facing string | The module's i18n files in all five locales ([i18n](/i18n)) |
| Add a dependency | The `add-dependency` skill: registry-verified version, allowlist and Library-First page updated together |
| Change a decision | Read [Decisions](/decisions) first; do not re-propose what is recorded |

## Commands you will actually use

`task` is the only entry point. Run `task --list` for everything.

| Command | What it does |
|---|---|
| `mise install` then `task setup` | Install pinned toolchains, git hooks, dependencies and generated code |
| `task dev` and `task web:dev` | Run Postgres, DragonflyDB and the server; run the web app |
| `task generate` | Regenerate code from `.proto` and SQL (never committed) |
| `task lint`, `task test`, `task build` | Gates for Core; `PROFILE=full` adds frozen platforms |
| `task check` | Cheap cross-platform policy checks: naming, file size, colors, i18n parity, boundaries, unused code, migrations, tokens, docs links |
| `task doctor` | What this machine can verify |
| `task verify:<platform>` | The exact verification commands for one platform |

## Reading paths

| You are | Read in this order |
|---|---|
| A new developer | This page, [Containers](/architecture/containers), [Request lifecycle](/architecture/request-lifecycle), [Server modules](/server/modules), the `tasks` module code |
| A backend developer | [Server architecture](/server/architecture), [Database](/server/database), [Events](/server/events), [API design](/engineering/api-design), [Security](/engineering/security) |
| A web developer | [Web projects](/web/projects), [Web architecture](/web/architecture), [UI kit](/ui-kit), [i18n](/i18n), [Web stack](/library-first/web) |
| A mobile or desktop developer | [Clients](/architecture/clients), [Client recipe](/client-recipe), your platform's Architecture page, [Platform status](/status) |
| DevOps or SRE | [Deployment topology](/architecture/deployment-topology), [Server deployment](/server/deployment), [Runbook](/server/runbook), [Resilience](/architecture/resilience) |
| An AI agent | `AGENTS.md`, then `docs/agent/INDEX.md`; open only the rows for your platform and task |
| Using this as a template | the "Using this repo as a template" section of the root `README.md`, then `docs/agent/github-setup.md` |

New to a term? See the [Glossary](/glossary).

## First-day checklist

1. `mise install`, then `task setup`, then `task doctor` (it tells you what this machine can verify).
2. Start an OIDC provider (the server refuses to start without `AEDST_OIDC_ISSUER` and `AEDST_OIDC_AUDIENCE`); the dev compose profile `idp` starts ZITADEL.
3. `task dev` and, in another shell, `task web:dev`.
4. Open the `tasks` module on the server and on web and follow one RPC from the `.proto` to the database row.
5. Run `task check` before your first change so you know the baseline is green.

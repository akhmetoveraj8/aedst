---
title: Glossary
description: "Plain-language definitions of every term, tool and acronym used in the AEDST docs, with a link to the page that owns each one."
---

# Glossary

Short definitions, alphabetical within each group. For the big picture start at [Start here](/start-here).

## Architecture

| Term | Meaning |
|---|---|
| **Monolith first** | Ship one deployable with strict internal borders; split into services only when measurements demand it ([ADR-0001](/decisions/0001-modular-monolith)). |
| **Module** | A large business area with its own data and contract (`tasks`, `media`). The unit that can become a service ([Modules and features](/architecture/modules-and-features)). |
| **Feature** | One user-visible capability inside a module (a vertical slice). Features never import each other. |
| **Contract** | The public surface of a module: its `.proto` API and its events. Everything else is private. |
| **Core profile** | Server + Web: the verified working mode. Other platforms are **frozen** ([Platform status](/status)). |
| **Frozen** | A platform that receives only bug fixes until it has a green CI run. |
| **ADR** | Architecture Decision Record: a decision with rationale and a "revisit when" condition ([Decisions](/decisions)). |
| **Parity** | The same feature behaving the same on every platform, tracked in `features.yaml` ([Parity](/parity)). |
| **Vertical slice** | Code for one capability from UI to database kept together instead of split by technical layer. |
| **Stateless compute** | Servers hold no session, so any replica can serve any request. |
| **BFF** | Backend for frontend: the web app's own `/api/rpc` route that holds the token in an `httpOnly` cookie and forwards calls to the API. |

## API and data

| Term | Meaning |
|---|---|
| **Protobuf** | The schema language of the API; every message and service is declared in a `.proto` file. |
| **Buf** | Tool that lints, builds and generates code from `.proto` files and detects breaking changes. |
| **ConnectRPC** | The RPC protocol used everywhere; works over plain HTTP, gRPC-compatible, readable with `curl`. |
| **Protovalidate** | Validation rules written in the `.proto` and enforced by one server interceptor. |
| **Interceptor** | Middleware around an RPC: tracing, auth, rate limit, validation ([Request lifecycle](/architecture/request-lifecycle)). |
| **Idempotency key** | A client-chosen id that lets a retried write run only once. |
| **Keyset pagination** | Paging by "after this row" instead of an offset, so page 1000 costs the same as page 1. |
| **PostgreSQL** | The system of record. One schema per module, no cross-schema joins or foreign keys ([Database](/server/database)). |
| **pgx** | The Go PostgreSQL driver. |
| **sqlc** | Generates type-safe Go from hand-written SQL. There is no ORM. |
| **Goose** | Runs database migrations (one version table per module). |
| **squawk** | Lints migrations for unsafe operations. |
| **PgBouncer** | Connection pooler in front of PostgreSQL. |
| **River** | Job queue stored in PostgreSQL; also delivers events ([Events](/server/events)). |
| **Outbox** | The pattern of writing an event in the same transaction as the change so it is never lost. Here: River `InsertTx` ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox)). |
| **Integration event** | A fact one module publishes (`TaskCompleted`) for others to react to. |
| **DragonflyDB** | Redis-compatible cache and rate-limit store. Optional; correctness never depends on it. |
| **NATS JetStream** | Optional message bus that carries events to non-Go processes such as the gateway ([ADR-0021](/server/architecture)). |
| **Object storage** | S3-compatible storage (S3, MinIO, R2) for media bytes; clients upload with presigned URLs. |
| **imgproxy** | Optional service that resizes images on the fly from signed URLs. |

## Identity and security

| Term | Meaning |
|---|---|
| **OIDC** | OpenID Connect: the standard sign-in protocol. |
| **IdP** | Identity provider (ZITADEL by default). It authenticates; the server only verifies tokens and authorizes ([Security](/architecture/security)). |
| **JWT / JWKS** | The signed access token and the public keys used to verify it. |
| **PKCE** | Authorization Code flow variant used by public clients (web, mobile). |
| **Role policy** | Which role may call which RPC, configured once rather than in handlers. |
| **Device attestation** | Proof that a call comes from a genuine app on a genuine device (Play Integrity, App Attest). |
| **AGPL boundary** | ZITADEL runs unmodified as a separate service so its license does not reach this code ([Licensing](/server/licensing-agpl)). |
| **CSP** | Content Security Policy: browser rules limiting which origins a page may load. |

## Clients and UI

| Term | Meaning |
|---|---|
| **Next.js** | The React framework behind web `app` and `marketing`. |
| **Vite SPA** | The single-page app build used by web `admin`. |
| **shadcn/ui** | Component source copied into `apps/web/shared/ui`; feature code uses only these kit components. |
| **TanStack Query** | Server-state cache for the web client. |
| **Kit / UI kit** | The shared component set with a manifest (`ui-kit.yaml`) and a parity matrix ([UI kit](/ui-kit)). |
| **Design tokens** | Colors, spacing and type defined once in `packages/design-tokens` and generated for each platform; generated files are never hand-edited. |
| **Style Dictionary** | The tool that generates the token files. |
| **i18n** | Internationalization. Locales: en, ru, tg (web calls it `tj`), uz, ar; keys must stay in parity ([i18n](/i18n)). |
| **Compose / SwiftUI / Slint** | UI toolkits of Android, Apple and Desktop. |
| **Metro** | Dependency injection on Android. |
| **Tuist** | Generates and manages the Apple Xcode project. |
| **Gateway** | The Rust WebSocket server that pushes realtime "nudges"; never the source of truth. |
| **Nudge** | A small server-to-client signal that something changed so the client refetches. |

## Tooling and process

| Term | Meaning |
|---|---|
| **mise** | Installs the exact toolchain versions pinned in `mise.toml`. |
| **Task** | The single command entry point (`task --list`). |
| **lefthook** | Git hooks that run checks before commit and push. |
| **Biome** | Lint and format for the web workspace (no ESLint or Prettier). |
| **knip** | Finds unused files and dependencies on web. |
| **golangci-lint, depguard** | Go linting and import-rule enforcement. |
| **architecturetest** | Go test that fails when a module imports another module's internals. |
| **Renovate** | Opens dependency update PRs. |
| **Library-First** | Never write what the standard library, platform or an approved dependency already does ([Library-First](/library-first)). |
| **UNVERIFIED** | Marker for anything not built, run or checked against a registry. Never replace it with a guess. |
| **Definition of Done** | The checklist a change must pass before it is reported finished ([Library-First: general](/library-first/general)). |
| **Skill / hook / reviewer agent** | AI-assistant helpers in `.claude/`: guided workflows, automatic guards and read-only reviewers. |

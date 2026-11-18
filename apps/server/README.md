# aedst-server

The AEDST backend: a modular monolith (see [../../docs/content/server/architecture.md](../../docs/content/server/architecture.md)
for the full architecture and [../../docs/content/server/modules.md](../../docs/content/server/modules.md) for
the module list and dependency graph).

## Prerequisites

- Go 1.27.4
- Docker (for local Postgres + DragonflyDB, and Testcontainers-based integration tests)
- [buf](https://buf.build/docs/installation), [sqlc](https://docs.sqlc.dev/en/latest/overview/install.html),
  [goose](https://github.com/pressly/goose) — only needed if you change
  `api/proto/`, `sql/`, or `migrations/`; not needed to just run the server.

## Quickstart

```bash
cp .env.example .env   # set AEDST_OIDC_ISSUER / AEDST_OIDC_AUDIENCE (see Authentication)
task dev                # starts Postgres + DragonflyDB, applies migrations, runs the server
```

The server is a pure OIDC resource server (ADR-0019): it has no sign-in of its own and
refuses to start without `AEDST_OIDC_ISSUER`. For local work start a ZITADEL
(`task up PROFILES="--profile idp"` + `deployments/zitadel/bootstrap.sh`) and set
`AEDST_OIDC_*`; the bootstrap prints a machine-user token for curl and Bruno.
`.env` is not read by the binary: export it into the shell (`set -a; . ./.env; set +a`)
before `task run`.

The server listens on `:8080` (ConnectRPC — Connect/JSON, gRPC and gRPC-Web all
work against it). Health: `GET /livez` (process up), `GET /readyz` (Postgres required; DragonflyDB optional — reported as `degraded`, never 503) and standard gRPC health (`grpc.health.v1`).
Draining reports 503. Telemetry is OpenTelemetry (OTLP) — see
[Observability](#observability); a Prometheus scrape endpoint is opt-in via
`AEDST_METRICS_ADDR`.

Try it against the running server (Connect's protocol accepts plain JSON over
HTTP/1.1, so `curl` works with no gRPC tooling); send an access token issued by
the identity provider as the bearer:

```bash
curl -s http://localhost:8080/aedst.tasks.v1.TasksService/CreateTask   -H 'Content-Type: application/json'   -H "Authorization: Bearer $ACCESS_TOKEN"   -d '{"title":"Try the reference module","priority":"TASK_PRIORITY_MEDIUM"}'
```

See [`api/bruno/`](api/bruno/README.md) for the full request set instead of
copy-pasting tokens by hand.

For anything past a one-off curl — the full request set, with auth-token
chaining and negative tests for the 401/403 paths — see
[`api/bruno/`](api/bruno/README.md): a [Bruno](https://www.usebruno.com/)
collection, this project's Swagger-UI equivalent for a ConnectRPC API (no
generated try-it-out page exists for Connect the way OpenAPI/Swagger has
one, so this is a real, runnable, git-committed collection instead).

## Common tasks

| Command | What it does |
|---|---|
| `task up` / `task down` | start/stop local Postgres + DragonflyDB (`task up PROFILES="--profile observability --profile idp"` adds Grafana otel-lgtm and ZITADEL) |
| `task migrate` / `task migrate:down` | apply/roll back migrations for every module schema (list: `MODULES` in `Taskfile.yml`) |
| `task gen` | regenerate proto (buf) and SQL (sqlc) code — commit the diff |
| `task lint` | format check, vet, golangci-lint, buf lint/format, `sqlc vet`, architecture boundary tests |
| `task breaking` | fail if this branch's proto changes break compatibility against `main` |
| `task test` | unit tests (no external services needed) |
| `task test:integration` | tests against a real Postgres via Testcontainers (advisory locks, River event delivery, session CAS, repositories) |
| `task lint:migrations` | squawk migration safety lint (Up sections; PATH, npx or Docker) |
| `task vuln` | `govulncheck` |
| `task build` | compile `bin/aedst-server` |

`make <target>` is a shim that forwards to `task <target>` (`Makefile`); there are no separate Make recipes.

## API governance (Buf)

`api/proto/` is the single source of truth every client generates from
(`apps/web`, `apps/apple`, and this server's own Go stubs — see
`buf.gen.yaml` in each). `buf.yaml` pins the lint ruleset (`STANDARD`) and
breaking-change detection (`FILE`-level compatibility). `task lint` runs
`buf lint` + `buf format -d --exit-code` (fails on unformatted `.proto`);
`task breaking` checks the current branch against `main` — CI runs the
equivalent of both on every PR touching `apps/server/**`
(`.github/workflows/server-ci.yml`), plus a check that `gen/` isn't stale
relative to `api/proto/`.

## Adding a module

1. Add a row + dependency edges to [../../docs/content/server/modules.md](../../docs/content/server/modules.md).
2. Scaffold `internal/modules/<name>/{api,domain,application,infrastructure,transport,module}` (`application` holds `ports.go` + `service.go`; copy `internal/modules/tasks`).
3. Add `api/proto/aedst/<name>/v1/<name>.proto` (+ `events.proto` if it publishes events) and run `task gen`.
4. Add `migrations/<name>/` (its own schema) and `sql/<name>/` + an `sqlc.yaml` entry; add the name to `MODULES` and `MODULES_REVERSE` in `Taskfile.yml` and to `scripts/lint-migrations.sh`.
5. Register it in `internal/modules/<name>/module/module.go` with `modulekit.Register` and add one blank-import line to `cmd/server/modules.go` (nothing else in `cmd/server`).
6. Add the name to `expectedModules` in `architecturetest/layers_test.go`, then `task arch`: it fails if the module's imports do not match `modules.md` or it is not registered.

## Verifying this environment

`go build ./...`, `go vet ./...`, `golangci-lint run ./...`, `govulncheck ./...`
and `go test ./...` (architecture boundary tests + unit tests) all run without
Docker. `task dev` / `task test:integration` need Docker for Postgres/DragonflyDB.

## Stack at a glance

| Concern | Choice | Notes |
|---|---|---|
| Router / RPC | net/http ServeMux + ConnectRPC (Protobuf, Buf, Protovalidate) | stdlib router (chi replaced by owner decision); realclientip-go for client IP, rs/cors for CORS |
| Data | PostgreSQL 18, pgx, sqlc, Goose | `sqlc vet` + squawk in the lint gate |
| Async | **River** (jobs and events: `InsertTx` in the producer's transaction, ADR-0014) | one mechanism, no broker; `internal/platform/events.Publisher` is the seam when a consumer becomes a separate service |
| Locks | PostgreSQL advisory locks (`internal/platform/lock`) | no Redlock/RedSync |
| Cache / rate limits | DragonflyDB via go-redis + redis_rate (`internal/platform/cache`) | `AEDST_CACHE_*` |
| Auth | OIDC resource server only (any IdP; ZITADEL by default), no first-party accounts | [ADR-0017](docs/adr/0017-identity-provider.md), [ADR-0019](docs/adr/0019-remove-first-party-auth.md) |
| Observability | OpenTelemetry (traces, metrics, logs) over OTLP; optional `/metrics` | any backend |

## Authentication

One verifier behind `platformauth.Verifier`: the OIDC resource-server verifier
(ADR-0019). The server issues no tokens and stores no credentials; sign-in,
passwords, MFA, recovery and the user directory belong to the identity provider.

- **ZITADEL (the template default):** set
  `AEDST_OIDC_ISSUER`, `AEDST_OIDC_AUDIENCE` (the ZITADEL project id) and
  `AEDST_OIDC_ROLES_CLAIM=urn:zitadel:iam:org:project:roles`. Discovery, JWKS
  caching and rotation are automatic. `task up PROFILES="--profile idp"` starts a
  local ZITADEL and `deployments/zitadel/bootstrap.sh` creates the project,
  roles, PKCE app and service user; see
  [ADR-0017](docs/adr/0017-identity-provider.md) for the provider analysis
  (ZITADEL vs Keycloak vs Ory, AGPL caveat) and a walkthrough.
- **Breaking contract change:** `aedst.auth.v1.AuthService` (Register, Login,
  RefreshToken, Logout, GetCurrentUser) and `AdminService.ListUsers` were removed;
  clients use the provider's PKCE flow. Details: ADR-0019. Existing first-party
  accounts are moved with `deployments/zitadel/import-users.sh` before migration
  `auth/00004` drops their tables (`docs/content/server/runbook.md`).

## Observability

The server speaks **OpenTelemetry only**; the backend is a deployment choice.
Set the standard `OTEL_EXPORTER_OTLP_*` variables and traces, metrics and logs
(slog, correlated by `trace_id`) are exported over OTLP. Unset = nothing is
exported.

```bash
# local all-in-one backend (Grafana + Loki + Tempo + Prometheus/Mimir + OTLP receiver)
task up PROFILES="--profile observability"
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # Grafana: http://localhost:3001
```

Grafana Cloud, SigNoz and HyperDX work the same way with their OTLP endpoint
and `OTEL_EXPORTER_OTLP_HEADERS`. `AEDST_METRICS_ADDR=:9090` additionally serves
`/metrics` for Prometheus scraping from the same OpenTelemetry meter.

## Migrations

`goose` per module schema, each with its own version table
(`goose_<module>`, so two modules can both have a `00001`). Every migration is
linted with squawk before merge (`task lint:migrations`); mark migrations that
use `CREATE INDEX CONCURRENTLY` with `-- +goose NO TRANSACTION`.
Upgrading an existing dev database that was migrated with the old shared
`goose_db_version` table: `docker compose down -v` and re-migrate.

## Configuration changes from the previous stack

| Old | New |
|---|---|
| `AEDST_REDIS_ADDR/PASSWORD/DB`, then `AEDST_VALKEY_*` | `AEDST_CACHE_*` (same protocol; DragonflyDB since 2026-11-18). `AEDST_VALKEY_*` is still honoured for one release with a warning; `AEDST_REDIS_*` is not |
| `AEDST_NATS_URL` | removed |
| `AEDST_OTLP_ENDPOINT` (gRPC, insecure) | standard `OTEL_EXPORTER_OTLP_ENDPOINT` / `_HEADERS` / `_PROTOCOL` |
| `AEDST_METRICS_ADDR` default `:9090` | default empty (opt-in) |
| `AEDST_JWT_SIGNING_KEY`, `AEDST_AUTH_FIRST_PARTY_*`, `AEDST_LOGIN_RATE_LIMIT_PER_MINUTE`, token TTLs, `AEDST_RETENTION_SESSION_HOURS` | removed (ADR-0019); `AEDST_OIDC_ISSUER` is required |
| — | `AEDST_OIDC_*`, `AEDST_TRUSTED_PROXY_HOPS`, `AEDST_AUTH_RATE_LIMIT_PER_MINUTE`, `AEDST_SHUTDOWN_DRAIN_SECONDS`, `AEDST_DATABASE_*` pool/timeouts |

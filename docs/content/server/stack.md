---
title: Stack
description: The complete Server stack with exact versions.
---

# Server stack

Go backend (`apps/server`). Versions are pinned in the repository (checked against the registries on **2026-10-07**). Approved-library rules and rejections: [Library-First](/library-first#server-go). How to bump versions: [Stack overview](/stack#keeping-it-current).

## Language and HTTP

| Area | Tool | Version |
|---|---|---|
| Language | Go | **1.27.3** |
| HTTP | `net/http` (h2c; TLS ≥ 1.2 via `AEDST_TLS_*` or at the ingress) | stdlib |
| Router | `net/http` ServeMux (stdlib) + `rs/cors` + `realclientip-go` | stdlib / cors 1.11.1 / realclientip-go 1.0.0 |

## API

| Area | Tool | Version |
|---|---|---|
| Contract | Protobuf (`google.golang.org/protobuf`) | **1.36.12** |
| Codegen / lint / breaking | Buf | **1.75.0** |
| RPC | ConnectRPC (`connectrpc.com/connect/v2`; `connecthttp` mounts it on `net/http`) | **2.0.2** |
| Validation | Protovalidate via `connectrpc.com/validate` server interceptor | **0.9.0** (protovalidate-go 1.4.0) |
| RPC tracing | `connectrpc.com/otelconnect` server interceptor | **0.12.0** |
| Health / reflection | `grpchealth/v2` / `grpcreflect/v2` | 2.0.0 / 2.0.0 |

Rule: **Proto contract → Protovalidate → ConnectRPC interceptor.** Every service is
mounted through `modulekit.Mount`, which always installs the validation interceptor.

## Database

| Area | Tool | Version |
|---|---|---|
| Database | PostgreSQL | **18** (`postgres:18`) |
| Driver | pgx v5 | **5.11.0** |
| Queries | sqlc (`sqlc vet` in CI) | **1.31.1** |
| Migrations | Goose (one version table per module) + squawk lint | **3.29.0** (squawk 2.70.0) |
| Pooler | PgBouncer | CloudNativePG `Pooler` on Kubernetes; `edoburu/pgbouncer:v1.26.1-p0` in Docker Compose only |

## Cache, jobs, events

| Area | Tool | Version |
|---|---|---|
| Cache / rate limit | **Valkey** + go-redis client + redis_rate (never a source of correctness) | `valkey/valkey:9`, go-redis **9.23.0**, redis_rate 10.0.1 |
| Jobs | River (queues `default`, `media`) | **0.50.0** |
| Events | River `InsertTx` in the producer's transaction (one delivery job per consumer), `internal/platform/events` | River **0.50.0** (in-repo wrapper) |
| Locks | Postgres advisory locks | in-repo |
| Resilience | gobreaker v2 (circuit breaker) | **2.4.0** |

## Auth

| Area | Tool | Version |
|---|---|---|
| Tokens (OIDC resource server) | jwx v4 + jwkfetch | **4.6.0** (jwkfetch 4.0.4) |
| Identity provider | ZITADEL (MFA, WebAuthn/passkeys, social login live in the IdP; AGPL-3.0, run unmodified as a separate service; Keycloak is the Apache-2.0 alternative) | `ghcr.io/zitadel/zitadel:v4.20.0` |
| First-party compatibility mode | Argon2id | 1.0.0 |

## Storage, media, push

| Area | Tool | Version |
|---|---|---|
| Object storage | `ObjectStorage` port → aws-sdk-go-v2 S3 (presets: AWS S3, MinIO, Cloudflare R2) | **1.47.1** (s3 1.114.1) |
| Image ingest (validate, orient, strip EXIF/GPS) | govips (`-tags vips`, cgo) over system libvips (Debian 13 trixie `libvips42t64`, libvips 8.16.1) | govips **2.20.0** |
| Image delivery (dynamic sizes, WebP/AVIF) | imgproxy (`darthsim/imgproxy`), signed URLs from `internal/platform/imgproxy` | **v4.0.20** (Docker Hub, 2026-10-28) |
| Video / audio | ffmpeg / ffprobe (optional, external) | — |
| Push (details: [Push notifications](/server/push)) | Web Push + VAPID (`webpush-go`), FCM (Firebase Admin Go `messaging`), APNs HTTP/2 token auth (`apns2`) | webpush-go **1.4.0**, firebase.google.com/go/v4 **4.22.0**, apns2 **0.25.0** |

## Observability

| Area | Tool | Version |
|---|---|---|
| Traces / metrics / logs | OpenTelemetry SDK (OTLP via `OTEL_*`), otelhttp, otelconnect | **1.47.0** (contrib 0.72.0, otelconnect 0.12.0) |
| Logging | `log/slog` + otelslog bridge | stdlib |
| Metrics endpoint | Prometheus `/metrics` — optional, off by default | exporter 0.69.0 |
| Backends | any OTLP backend; locally `grafana/otel-lgtm` (Grafana + Tempo + Loki + Prometheus + Pyroscope in one container) | `0.38.1` |

## Testing and security

| Area | Tool | Version |
|---|---|---|
| Unit / integration | `go test` + Testcontainers | **0.44.0** |
| Load | k6 (`test/load/api.js`) | `grafana/k6:2.3.0` |
| Static analysis | `go vet`, staticcheck (golangci-lint v2), govulncheck | golangci-lint 2.14.0, govulncheck 1.8.0 |

## Infrastructure

| Area | Tool |
|---|---|
| Containers | Docker / Docker Compose (profiles: `observability`, `idp`, `minio`) |
| Orchestration | Kubernetes + Helm chart (`apps/server/deployments/helm`) |
| Postgres in k8s | CloudNativePG (3 instances, sync replica, PITR) |
| GitOps | Argo CD |
| Cloud infra | OpenTofu (single IaC tool; written once the cloud target is chosen) |

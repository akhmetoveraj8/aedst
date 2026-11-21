---
title: "Security standard"
description: "The roadmap.sh API security checklist mapped to AEDST: what each item means here, where it is already enforced, and what new code must do."
---

# Security standard

Every item of the roadmap.sh API Security checklist is either **already enforced** by a gate in this
repo, or is a **rule for new code** that review checks. "Enforced" names the file or gate; do not
re-implement what it already does, and do not weaken it. Secure by default: a new feature starts closed
(authenticated, rate-limited, validated, least privilege) and opens only by an explicit, reviewed change.

## Authentication

| Item | AEDST |
|---|---|
| No Basic auth; use a standard | OIDC with ZITADEL (Keycloak alternative); the server is a resource server only (`apps/server/docs/adr/0017-identity-provider.md`) |
| Do not reinvent authentication | Forbidden: self-built sign-in, MFA, recovery, social login, password hashing, sessions on the server |
| Max retry / lockout on login | The IdP's lockout and brute-force protection; never in AEDST code |
| Encrypt sensitive data | TLS everywhere; secrets only from the environment or a secret store; on clients, Keystore + Tink (Android), Keychain (Apple), OS keyring (Desktop), httpOnly cookies (web BFF) |

## JWT

| Item | AEDST |
|---|---|
| Strong signing keys | Asymmetric keys held by the IdP, fetched by JWKS; the server never signs tokens |
| Do not take the algorithm from the header | `apps/server/internal/platform/auth/oidc.go`: keys come only from the IdP's JWKS and the algorithm is inferred from the key (`jws.WithInferAlgorithmFromKey`), with issuer, audience and expiry validated; never pass a header-chosen algorithm or an HMAC secret |
| Short TTL | Access tokens are short-lived and refreshed by the client through the IdP; no long-lived bearer tokens |
| No sensitive data in the payload | Claims carry subject, roles and scopes only; never PII beyond what the IdP sets, never secrets |
| Small payload | No custom claims beyond roles; look up anything else server-side |
| One library | jwx only (a second JWT/JOSE library is forbidden); JWTs are verified only in `httpserver.AuthInterceptor` |

## OAuth / OIDC

| Item | AEDST |
|---|---|
| Validate `redirect_uri` server-side | Exact-match redirect URIs registered at the IdP; the web BFF builds callbacks from config, never from the request |
| No implicit flow (`response_type=token`) | Authorization code + PKCE on every client (`oauth4webapi` on web, AppAuth-style native flows) |
| `state` against CSRF | `state` and `nonce` checked on every callback |
| Default scope, validated per app | Each client has its own IdP application with the minimum scopes |

## Access control

| Item | AEDST |
|---|---|
| Throttling against brute force and DoS | Per-user rate limit (`AEDST_API_RATE_LIMIT_PER_MINUTE`, DragonflyDB, fails open), load shedding (`AEDST_MAX_IN_FLIGHT`), per-service message size caps, server timeouts (`apps/server/internal/platform/httpserver/server.go`); edge rate limits in the ingress |
| HTTPS and secure ciphers | TLS terminated at the ingress with modern ciphers only; HSTS from the server (`HSTSMaxAge` in `apps/server/internal/platform/httpserver/middleware.go`) and the web app (`apps/web/app/next.config.ts`) |
| No directory listings | No file server in the API; static files are served by Next.js or object storage with private buckets and signed URLs |
| Private APIs on safe-listed IPs | Metrics and pprof listen on a separate address (`AEDST_METRICS_ADDR`), never on the public port; admin RPCs are role-gated by default |
| Client IP | `apps/server/internal/platform/clientip` (trusted-hop strategy); never trust `X-Forwarded-For` blindly |

## Input

| Item | AEDST |
|---|---|
| Validate every input | Protovalidate on every request field with a bound, plus domain validation; Zod for client-only data; React Hook Form with the protovalidate resolver ([validation](/web/validation)) |
| Correct content type | Connect enforces its content types and `Connect-Protocol-Version` (`modulekit.Mount`); a new plain endpoint must reject any other content type with 415 |
| SQL injection | sqlc only; no string-built SQL (architecture test) |
| XML / YAML entity attacks (XXE, billion laughs) | No XML parsing in the API; if a format requires it, disable entity expansion and DTDs |
| Uploads | Through `apps/server/internal/platform/storage` to object storage (presigned, size-capped); images re-encoded by govips (EXIF/GPS strip, pixel limit) before anyone sees them |

## Processing

| Item | AEDST |
|---|---|
| Every endpoint behind auth | `AuthInterceptor` on every RPC; a public RPC is declared in the module's `Public` hook and reviewed |
| No personal ID in URLs (`users/242/orders`) | The caller is the token's subject; ids are opaque UUIDv7 (`apps/server/internal/shared/ids`); no email/phone in paths or query strings |
| UUID over auto-increment | UUIDv7 everywhere |
| Object-level authorization (BOLA) | Every query scoped by the owner (`AND user_id = $2`); foreign objects are `NOT_FOUND` |
| Mass assignment | Separate request messages per RPC plus `update_mask`; server-owned fields (`id`, `version`, timestamps, owner) are never read from a request |
| No blocking on large data | Streams and River jobs (queue `media`) for heavy work; bounded page sizes |
| Debug off in production | pprof off by default (`AEDST_PPROF_ENABLED=false`); no reflection service on the public port; errors redacted by `httpserver.ToConnectError` |
| SSRF | Outbound HTTP only through configured clients (`http.DefaultClient` is forbidden by lint) to allowlisted hosts; never fetch a URL taken from a request without an allowlist. A URL a customer registers (webhook endpoint) goes only through `webhooks.NewHTTPClient`: `https` only, the connected address must be public unicast (checked after DNS resolution, so re-binding to loopback, private, link-local or metadata addresses is refused), no redirects, no environment proxy |
| Non-executable stacks, hardened images | Minimal `debian:trixie-slim` runtime as UID 65532 (`apps/server/deployments/docker/Dockerfile`), `runAsNonRoot` and `readOnlyRootFilesystem` in `apps/server/deployments/helm/aedst-server/values.yaml` |

## Output

| Item | AEDST |
|---|---|
| `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors 'none'`, CSP `default-src 'none'` on the API | `apps/server/internal/platform/httpserver/security.go`, tested in `hardening_test.go` |
| CSP on web | Nonce-based CSP in `proxy.ts`; a new third-party origin needs a CSP change in the same PR |
| Remove fingerprinting headers | `poweredByHeader: false` on web; the Go server sets no `Server`/`X-Powered-By` |
| Never return credentials or tokens | Responses never carry secrets, token hashes or other users' data; logs never contain them (`sloglint`, review) |
| Correct status codes | The shared error vocabulary ([api-design](/engineering/api-design#errors)) |

## Monitoring

Centralized logs, traces and metrics through OpenTelemetry (OTLP); errors and crashes in Sentry;
alerts from the collector's backend. Never log passwords, tokens, cookies, full JWTs, idempotency
bodies or PII; `slog` attributes are as visible as the message. Security-relevant operator actions are
written to `admin.audit_log` in the same transaction. IDS/IPS and WAF belong to the platform (ingress,
cloud), not to application code.

## CI/CD and supply chain

| Item | AEDST |
|---|---|
| Unit and integration tests | `task test`, integration tests with Postgres, behaviour scenarios |
| Code review, no self-approval | `.github/CODEOWNERS`, branch protection ([github-setup](../../agent/github-setup.md)), the `review-platform` skill |
| Continuous security analysis | `gosec` in golangci-lint, `govulncheck` (`task vuln`), gitleaks (`.gitleaks.toml`), `cargo-deny` on Desktop |
| Known-vulnerable dependencies | Renovate (`config:best-practices`), SHA-pinned Actions, `task deps:check`; a security release is applied the week it ships, through the release-age security fast path when it is younger than a day (`apps/web/pnpm-workspace.yaml` comment, [decisions/web](/decisions/web)) |
| Rollback | Helm releases roll back; a new migration must stay compatible with the previous release (expand, then contract in a later release) so a rollback never meets a schema it cannot read |

## Rules for new code

1. A new RPC is authenticated, rate-limited and validated unless a reviewed `Public` entry says otherwise.
2. A new query is scoped by owner; a new admin operation is audited.
3. A new outbound call uses a configured client with a timeout and a host allowlist.
4. A new secret is an environment variable documented in the config reference, never a literal.
5. A new dependency in a security-sensitive area (crypto, auth, parsing) needs a recorded reason.
6. Run the security checklist of `apps/server/.claude/agents/security-auditor.md` on server diffs.

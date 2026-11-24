# Server ADRs

One numbering for all server decisions. ADRs 0001-0016 live in
[`docs/content/decisions/`](../../../../docs/content/decisions) (published on the docs site);
the ones below were written inside the app and keep their files here. Numbers are never reused.

| # | Decision | File |
|---|---|---|
| 0001-0016 | Modular monolith, ConnectRPC, PostgreSQL, River, module boundaries, media, attestation, ... | [`docs/content/decisions/`](../../../../docs/content/decisions) |
| 0017 | Identity provider and OIDC resource-server auth (ZITADEL by default) | [0017-identity-provider.md](0017-identity-provider.md) |
| 0018 | Google Play Integrity verification (STANDARD API) | [0018-play-integrity-verification.md](0018-play-integrity-verification.md) |
| 0019 | Remove first-party authentication; pure OIDC resource server (supersedes the first-party parts of 0017) | [0019-remove-first-party-auth.md](0019-remove-first-party-auth.md) |
| 0020 | Location-transparent units: module and feature services from one codebase (topology as configuration) | [0020-location-transparent-units.md](0020-location-transparent-units.md) |
| 0021 | NATS JetStream bridge and a Rust WebSocket gateway (amends 0014, supersedes the realtime transport of 0008) | [0021-nats-jetstream-and-rust-gateway.md](0021-nats-jetstream-and-rust-gateway.md) |
| 0022 | Event forwarding across databases, per-database River clients, service identity, media remote hook (completes 0020) | [0022-event-forwarding-and-service-identity.md](0022-event-forwarding-and-service-identity.md) |
| 0023 | Optional components, enablement criteria and scaling limits (idempotency_keys stays unpartitioned) | [0023-optional-components-and-scaling-limits.md](0023-optional-components-and-scaling-limits.md) |

The table of recorded decisions with "revisit when" is
[`docs/content/decisions/server.md`](../../../../docs/content/decisions/server.md). The next ADR is 0024.

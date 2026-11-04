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

The table of recorded decisions with "revisit when" is
[`docs/content/decisions/server.md`](../../../../docs/content/decisions/server.md). The next ADR is 0020.

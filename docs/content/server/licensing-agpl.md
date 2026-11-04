---
title: "ZITADEL and the AGPL-3.0"
description: "What AGPL-3.0 obliges us to do with ZITADEL, how the deployment keeps it an unmodified separate service, the machine check that enforces it, and the Keycloak exit plan."
---

# ZITADEL and the AGPL-3.0

ZITADEL (the template's default identity provider, ADR-0017, `apps/server/docs/adr/0017-identity-provider.md`)
is licensed **AGPL-3.0** for its core, console and hosted login since v3 (v2 and earlier were Apache-2.0; its
proto definitions, SDKs, APIs, examples, docs and Helm chart stay Apache-2.0; facts as recorded in the ADR on
2026-09-29, re-check the upstream `LICENSE` before relying on them). This page says what that obliges us to do,
how the repository keeps us on the safe side of it, and how we leave if we ever have to.

**This is an engineering control, not legal advice.** Have counsel confirm the points marked "counsel" before a
product that depends on the distinction ships. Nothing here has been reviewed by a lawyer.

## What AGPL-3.0 obliges, in plain terms

| Clause | Meaning for us |
|---|---|
| Using, running and configuring the program | Free. Setting environment variables, Helm values, projects, roles, branding supported by ZITADEL's own settings is **configuration, not modification**. |
| Separate program talking over a network (OIDC, HTTP, gRPC) | The AGPL's copyleft covers ZITADEL and works *based on* it. Our Go server, web, Android, Apple and Desktop apps talk to it over OIDC/HTTP only and are separate works (the licence calls separate programs on the same host or cluster an "aggregate"). Their licence is unaffected. |
| Network-use clause (section 13) | If you **modify** the program and users interact with it remotely, you must offer those users the Corresponding Source of **your modified version**. The unmodified program triggers no such offer. |
| Conveying (sections 4 to 6) | Handing a copy (source or image) to someone else carries source-offer duties. Pulling the official image ourselves and running it does not convey it. Redistributing a ZITADEL image or binary to customers, or publishing a mirror, does (counsel). |
| Modifying | Any patch, fork, rebuild with changes, or code linked into ZITADEL makes a modified version. From then on the network-use clause applies to every user of that instance, and the modified source must be published under the AGPL. |
| Linking | Importing ZITADEL's Go packages (module `github.com/zitadel/zitadel`) into our server would make our server a work based on it. Its **Apache-2.0** libraries (`github.com/zitadel/oidc`, `schema`, `logging`, the proto and SDK repositories) are a different matter and may be used. |

Open question for counsel: ZITADEL **Actions** (scripts executed inside ZITADEL to customise tokens or flows).
We treat them as configuration of the unmodified program; whether a licence reviewer agrees is **UNVERIFIED**.
Until then keep Actions small, keep them in this repository, and prefer claims mapping that needs none.

## The rule

> ZITADEL is run **unmodified**, as a **separate service**, from the **official image**, **pinned**, and our code
> never links to it. If we ever need to change ZITADEL itself, we do not patch it: we first publish the source of
> that change under the AGPL (an obligation we choose not to take on) or we move to the exit plan below.

## How the deployment keeps it unmodified

| Control | Where | Enforced by |
|---|---|---|
| Only the official images `ghcr.io/zitadel/zitadel` and `ghcr.io/zitadel/zitadel-login`; no other registry, no `-patched`/fork name | `apps/server/deployments/docker/docker-compose.yml` (dev profile `idp`), any Kubernetes or Helm manifest | `scripts/check-zitadel-agpl.mjs` |
| Production references are **pinned by digest** (`@sha256:...`, or a `digest:` next to `repository:`), not a floating tag | `apps/server/deployments/k8s/**`, `apps/server/deployments/helm/**`, `deployments/zitadel/helm-values*.yaml` | the same check (digest is mandatory in those paths; the dev compose file may use a version tag) |
| No Dockerfile builds `FROM` a ZITADEL image, copies from one (`COPY --from`), or copies ZITADEL files | `apps/server/deployments/docker/Dockerfile*` | the same check |
| No `git clone` of the ZITADEL repository, no `go build`/`go install`/`go get` of `github.com/zitadel/zitadel`, no patch applied to it, no `.go`, `.patch`, `.diff` or `go.mod` file inside `deployments/zitadel/` | deployment scripts and directory | the same check |
| Our `go.mod` never requires `github.com/zitadel/zitadel` (no linking) | `apps/server/go.mod` | the same check |
| Separate process and namespace: its own container, its own database and role on the shared PostgreSQL cluster (no grants across the two databases), reached only over OIDC/HTTP from the app | `deployments/k8s/postgres/base/cluster.yaml` (role `zitadel`, `Database` `aedst-pg-zitadel`), `deployments/zitadel/README.md`, Helm values | review; deploy ZITADEL in its own namespace (`identity`, see `helm-values.example.yaml`) |
| Configuration and bootstrap through ZITADEL's public API only (`bootstrap.sh`, `import-users.sh`) | `apps/server/deployments/zitadel/` | review |

Run the check with `task check:agpl` (also part of `task check`). It first runs a **negative self-test** (25
fixtures: official images, digest-pinned manifests and clean Dockerfiles must pass; foreign images, a Dockerfile
`FROM zitadel`, `COPY --from` a ZITADEL image, a missing digest in a Kubernetes path, a clone/build of the source,
a patch, a `github.com/zitadel/zitadel` requirement and source files in the deployment directory must each be
reported), so a regression that makes the check pass everything fails the check itself. It is a static scan of
`apps/server`; it cannot see what an operator deploys by hand, and it cannot prove the pinned digest is the one
upstream published. Verify that digest against the upstream release when you bump it (cosign verification of the
upstream signature is **UNVERIFIED**: not checked here).

Not covered by the check, by design: how a downstream product's CI mirrors images. If a product mirrors the official
image into its own registry unmodified, keep it private or publish the source offer (counsel).

## What to do if you must change ZITADEL

1. Stop. Check whether the need is configuration, an Action, a custom login app built on the public API, or a
   feature request upstream. Those do not modify ZITADEL.
2. A real patch means a modified version. Either accept the AGPL consequences (publish the full source of the
   modified ZITADEL to all its users, keep it available for as long as the instance runs, and add the source offer
   to the login UI) or use the exit plan. Do **not** deploy a patched image quietly: the check above will fail.
3. Record the decision in [decisions](/decisions/server) and update this page.

## Exit plan: Keycloak (Apache-2.0)

The server is a standards-based OIDC resource server (ADR-0017): no code in `internal/` is ZITADEL-specific. Leaving
is an environment and data migration, not a rewrite. Triggers: counsel or the customer's policy forbids AGPL
software in the stack, ZITADEL changes its licence again, a required change would be a patch to ZITADEL, or a
security fix we cannot wait for upstream would need a fork.

| Step | Detail |
|---|---|
| 1. Stand up Keycloak | Official Keycloak image (Apache-2.0, CNCF), its own database on the cluster; replace the `idp` compose profile and `deployments/zitadel/` with a Keycloak equivalent (the bootstrap script is the only ZITADEL-specific part). Pin by digest. |
| 2. Server configuration | `AEDST_OIDC_ISSUER` = the realm URL, `AEDST_OIDC_AUDIENCE` = the audience a Keycloak audience mapper adds, `AEDST_OIDC_ROLES_CLAIM=realm_access.roles`, `AEDST_OIDC_ROLES_ORG` empty. **User ids change with the issuer**: a UUID subject (Keycloak) is used as-is, any other subject is mapped to `ids.FromExternal(issuer, subject)`, so every existing user row keyed by the ZITADEL-derived id would be orphaned. Before cut-over, give each Keycloak user a UUID subject equal to the id already stored for them (compute `ids.FromExternal` for the old issuer and subject, create the Keycloak user with that id) or re-key the tables; this is the hardest part of the exit and is **not implemented or rehearsed**. |
| 3. Token type | The server requires a JOSE `typ` from `AEDST_OIDC_TOKEN_TYPES` (default `at+jwt`, `JWT`). Keycloak's default access-token `typ` is `Bearer` (to my knowledge, **UNVERIFIED** for the version you run): either enable its RFC 9068 `at+jwt` access-token type or add `Bearer` to `AEDST_OIDC_TOKEN_TYPES` knowing that ID-only claims are still refused. |
| 4. Users | Export from ZITADEL (management/user APIs) and import with Keycloak's admin REST partial import or user-creation API. Password hashes from ZITADEL (argon2/bcrypt/scrypt depending on settings) can be imported only if Keycloak has a matching hash provider; otherwise force a password reset by mail (the same fallback `import-users.sh` documents in the other direction). Passkeys cannot be exported: users re-enrol. **UNVERIFIED** end to end. |
| 5. Clients | Change the issuer, client ids and redirect URIs in the web (app and admin), Android, Apple and Desktop configurations; each is configuration (`docs/content/web/projects.md` for the web projects). Ship client releases that accept the new issuer before cutting over; keep ZITADEL running for sessions until refresh tokens expire. |
| 6. Cut over and remove | Switch the server issuer; the server verifies one issuer only (no multi-issuer routing), so do it in a maintenance window; delete ZITADEL, its namespace, database, role, Helm values, compose profile, this page's controls and `task check:agpl`. |

Cost estimate and a rehearsal have **not** been done. Before a product relies on this plan, rehearse steps 1 to 5 in
staging with a copy of the user table and record the elapsed time here.

## Revisit when

ZITADEL's licence changes again; counsel disagrees with any row above; a product needs to distribute the images;
Actions turn out to need a patch; Keycloak (or another Apache-2.0 provider) closes the feature gap that made ZITADEL
the default (multi-tenancy by organisation, light runtime, hosted login v2).

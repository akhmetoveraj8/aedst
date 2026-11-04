## What / Why

<!-- What changed, and why: the motivation, not a restatement of the diff. -->

## Spec / ADR

<!-- Link the spec this implements (apps/server/specs/<module>/<feature>.md) and/or the ADR or
     decision (docs/content/decisions/) for any architectural decision this PR makes. -->

## Shared checklist (every PR)

- [ ] `task check` is green locally
- [ ] Every new or changed version was verified against its registry, or is marked `UNVERIFIED` in the code and below
- [ ] A new dependency is on the platform allowlist and the matching `docs/content/library-first/<platform>.md` page is updated in this PR
- [ ] No hand-edited generated files (server `gen/`, web `generated/`, `packages/design-tokens/dist/`, token palettes); the source was changed and regenerated instead
- [ ] No contradiction of a recorded decision (`docs/content/decisions.md` and `docs/content/decisions/<platform>.md`); if a decision changes, both pages are updated here
- [ ] Docs updated where behaviour changed; everything new is in English (Russian only in `docs/archive` and locale files)
- [ ] User-facing strings exist in all five locales (en, ru, tg/tj, uz, ar)
- [ ] No unrelated changes bundled from other apps
- [ ] Verification claims are honest: Android was verified on the JVM only, Apple and Desktop were not built (see `docs/content/status.md`)

## apps/server

- [ ] `task server:check` passes (gen:check, lint, arch, vuln, tests)
- [ ] Module boundaries respected: other modules reached only through `api/`; new module registered via `modulekit.Register`
- [ ] Migrations pass `task lint:migrations` (no unguarded lock on a large table; `CONCURRENTLY` indexes in a no-transaction migration)
- [ ] A new retryable command is wrapped with `idempotency.Check`/`Save` and has a replay test
- [ ] A new integration event is published inside the state-changing transaction (River `InsertTx`), is SQL-guarded against double publish, and has a publish test and an idempotent-redelivery test per consumer
- [ ] Lists that can grow use keyset pagination; tables that only grow ship a retention policy
- [ ] No banned dependency (NATS/Kafka/RabbitMQ, Redlock, second JWT library, ORM, third-party router, `golang.org/x/image`)

## apps/web

- [ ] Forms use React Hook Form with the protovalidate resolver and `shared/ui` Field; server calls go through the generated Connect client and TanStack Query (no raw `fetch` in modules)
- [ ] Dates use `shared/date`; URL state uses nuqs; UI state uses zustand; analytics go through `shared/lib/analytics`
- [ ] UI elements come only from `apps/web/shared/ui/`; no color literals
- [ ] No ESLint/Prettier/RxJS; a new third-party origin comes with a CSP update
- [ ] Web tests, typecheck, Biome and knip pass; bundle budget respected

## apps/android

- [ ] Module rules respected (feature does not depend on another feature's implementation; data modules do not depend on each other)
- [ ] Screens take UI state and lambdas, not ViewModels; writes go through the local store, not straight to the network
- [ ] No `security-crypto`, Retrofit, Koin or `tv-foundation` lists; JDK stays 21
- [ ] ktlint, detekt, lint and unit tests pass; strings in all five locales

## apps/apple

- [ ] Stack respected: SwiftUI + Observation, GRDB, connect-swift, Nuke, Tuist (no XcodeGen, SwiftData, swift-perception)
- [ ] No banned concurrency constructs (`DispatchQueue`, `Task.detached`, `@unchecked Sendable`) without a recorded decision
- [ ] Logic lives in models, not in Views; no PII or tokens logged without private privacy; Keychain, not `UserDefaults`
- [ ] Apple scripts pass (`apps/apple/scripts/check-feature-boundaries.sh`, `check-file-size.sh`); not built on a Mac unless stated below

## apps/desktop

- [ ] Only approved crates (`docs/content/library-first/desktop.md`), workspace dependencies only; no hand-written Connect or OIDC client, hand-mirrored DTOs, committed generated code, `unwrap()` or `unsafe`
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` and `cargo deny check` pass, or are listed as not run below
- [ ] Desktop is frozen: bug fixes and the work in its own tasks only, no new features, until its first green CI run
- [ ] Not built locally unless stated below

## UNVERIFIED items and notes

<!-- List anything you could not verify (versions, builds, platforms). -->

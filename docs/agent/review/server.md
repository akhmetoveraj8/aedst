# AI review prompt: apps/server

Review the pull request diff under `apps/server/`. Report findings only; do not push fixes.

## Read first

1. `apps/server/AGENTS.md` (module boundaries, events, pagination rules)
2. `docs/content/library-first/server.md` (approved stack, explicit rejections)
3. `docs/content/decisions/server.md` and `apps/server/docs/adr/` (do not accept a change that contradicts a recorded decision)
4. `apps/server/.claude/agents/architect-reviewer.md` and `apps/server/.claude/agents/security-auditor.md`: apply both checklists to the diff

## Also check

- Generated code (`apps/server/gen/**`) is not hand-edited; sqlc and buf outputs match their sources.
- No dependency outside the approved list; a new one needs the matching update to `docs/content/library-first/server.md`.
- A new migration passes `scripts/lint-migrations.sh` rules (no unguarded lock on a large table; indexes on existing tables created concurrently).
- A new state-changing event has a transactional publish test and an idempotent-redelivery test.
- A proposal or change that moves backend work to Rust (a new service, a rewrite of a hot path) carries the evidence of [ADR-0025](../../../apps/server/docs/adr/0025-rust-admission-criteria.md) R1-R7 (profile, tuned Go, no existing component, Protobuf contract, no business or security logic on the Rust side, off switch, green CI); "it is heavy" alone is a finding. No JWT is verified outside `internal/platform/auth` (the gateway asks `RealtimeService`, ADR-0026).
- Engineering standard (`docs/agent/quality-bar.md`; full pages in `docs/content/engineering/`): modern Go for the pinned toolchain (`modernize`, `perfsprint` and `usestdlibvars` are lint gates; also flag older idioms they miss), the API design checklist in `docs/content/engineering/api-design.md` for any proto or handler change, the security table in `docs/content/engineering/security.md`, and the backend rules in `docs/content/engineering/performance.md` (indexed keyset queries, only needed columns, no N+1, no network call inside a transaction, slow work in River jobs).

Post findings as a PR review. If nothing applies, approve with no comments.

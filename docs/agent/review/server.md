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

Post findings as a PR review. If nothing applies, approve with no comments.

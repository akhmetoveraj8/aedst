---
name: write-spec
description: Turn a short task description (usually a GitHub Issue marked ai-task) into a spec for a human to approve BEFORE any scaffolding or implementation, then drive the approved spec to a verified "done". Use for a new feature, a new event, or a new state-changing command in any app. Not for one-line bug fixes.
argument-hint: "<app> <short task description>"
---

# write-spec

Two phases separated by a human gate: **(A) write one spec and stop**, then **(B) implement it against an explicit Definition of Done**. Never scaffold, write tests or write implementation code in phase A.

The spec template lives in exactly one place. Do not copy it into this skill, the Issue or a doc; copy the file.

## Phase A: write the spec, then stop

1. **Read the rules for the app named in the task**, nothing more: `docs/agent/INDEX.md` (only the row for the platform), `apps/<app>/AGENTS.md` (or its `README.md`), `docs/content/library-first/<platform>.md`. Do not propose anything recorded as rejected in `docs/content/decisions.md` or the platform decisions page.
2. **Pick the shape.**
   - Server change (new RPC, event, state-changing command): copy [`apps/server/specs/_template.md`](../../../apps/server/specs/_template.md) to `apps/server/specs/<module>/<feature>.md`.
   - Client-only change (no new RPC): `apps/<app>/specs/<feature>.md` using the same template, with the API, Events and Errors sections replaced by: screens touched, strings added (all five locales: en, ru, tg, uz, ar; web names Tajik `tj`), offline behaviour (outbox type or "online only"), analytics events, and tests planned.
   - A feature that must exist on several clients: write ONE behaviour spec and follow the `client-recipe` skill for the per-platform files; do not write one spec per client.
3. **Find the closest existing module to copy** and name it in the spec. `tasks` exists on every platform. Worked examples to imitate for depth and tone: [`complete-task.md`](../../../apps/server/specs/tasks/complete-task.md) (Command with an event and an idempotency edge case) and [`reopen-task.md`](../../../apps/server/specs/tasks/reopen-task.md).
4. **Fill every section.** "None" is a valid answer, an empty section is not. Each edge case is a Given / When / Then that a test can assert. Every error row names both `sharederrors.Kind` and `connect.Code`.
5. **Verify versions** you cite against a registry or write `UNVERIFIED`.
6. Set `Status: Draft`. Post the spec as a comment on the Issue (or print it in the session), ask for approval, and **stop**.

## Phase B: after the human approves

1. Set `Status: Approved` in the spec file.
2. Tests first (they fail), then implementation, in the order the app's `AGENTS.md` gives. Do not edit generated files; change the source (proto, sql, tokens) named in the spec and regenerate.
3. **Definition of Done** (all must hold; report each as pass / fail / not run):
   - [ ] Every Scenario in the spec has a test that asserts it (name the test next to the scenario or in the PR).
   - [ ] Every Errors row is reachable and tested.
   - [ ] If the spec has Events: a transactional-publish test and an idempotent-redelivery test exist (server rule).
   - [ ] If the spec adds strings: all five locales are present; `task check:i18n` passes.
   - [ ] New dependency? The `add-dependency` skill was followed (allowlist and Library-First page in the same change).
   - [ ] `features.yaml` row updated if a feature or behaviour was added; `task check:features` passes.
   - [ ] `task check` passes, plus the app's own gate (`task verify:<platform>` prints it). Run the `verify-status` skill before claiming anything about what was built or run.
   - [ ] The spec is `Status: Implemented` and still matches the code (edit the spec if the code legitimately diverged).
4. Finish with a report: DoD checklist with evidence (command and result), anything not run and why.

## Rules

- A one-line bug fix does not need a spec.
- Never edit generated files; the spec names the source that changes.
- If approval has not been given in words, phase B has not started.

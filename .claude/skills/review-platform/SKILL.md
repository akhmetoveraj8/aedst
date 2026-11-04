---
name: review-platform
description: Review a diff or PR for one AEDST platform (server, web, android, apple, desktop) against the project's own review checklist in docs/agent/review/<platform>.md, by delegating to the matching read-only reviewer subagent. Use before reporting a change done, or when asked to review code under apps/<platform>.
argument-hint: "<server|web|android|apple|desktop> [base-branch or PR number]"
---

# review-platform

One skill for all five platforms, on purpose: the checklists already live in [`docs/agent/review/`](../../../docs/agent/review/) (`server.md`, `web.md`, `android.md`, `apple.md`, `desktop.md`) and are also what the CI review workflows use. A separate skill per platform would be a second copy that drifts. The skill picks the platform; the checklist stays in one file.

## Procedure

1. **Decide the platforms** from the diff: `git diff --name-only <base>...HEAD` (or the staged and unstaged diff). Map `apps/<platform>/**` to a platform. A diff touching several platforms gets one review per platform, run in parallel.
2. **Delegate** each to its subagent, passing the base to diff against and nothing else (do not hand over your own conclusion; the reviewer must form its own):
   - `server-reviewer`, `web-reviewer`, `android-reviewer`, `apple-reviewer`, `desktop-reviewer` (definitions in `.claude/agents/`).
3. **Cross-cutting pass** (you, not the subagent): `task check` for the repo-wide gates, and confirm that any changed rule is reflected in `docs/content/decisions*` and the Library-First page in the same diff.
4. **Merge findings**: de-duplicate, keep severity order (blocker, major, minor, nit), keep each finding's evidence and the file:line.
5. **State what the review could not cover**: Apple and Desktop are statically reviewed only; Android has no device evidence; CI was not observed. Use the `verify-status` vocabulary.

## Output

A single list of findings, then "Not covered:" with the reasons. If there are no findings, say so and list what was checked. Do not apply fixes unless the user asks.

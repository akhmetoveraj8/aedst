---
name: quality-pass
description: Self-review a change against the AEDST engineering standard (modern language features, API design, security, performance, scalability) before reporting it done. Fixes what it finds in the agent's own diff, runs the gates, then hands off to review-platform and verify-status. Use at the end of every code change, and when asked to make code senior-level, faster or more secure.
argument-hint: "[base-branch]"
---

# quality-pass

Sources: [`docs/agent/quality-bar.md`](../../../docs/agent/quality-bar.md) (short form) and
[`docs/content/engineering/`](../../../docs/content/engineering/index.md) (full pages). This skill is the
procedure; the pages are the rules.

## 1. Scope the diff

`git diff --name-only` (staged and unstaged, or against the base). Only your own changes: several
sessions may share the tree, so never "fix" files you did not touch.

## 2. Walk the four lenses over every changed file

For each lens, open the matching page and check only the rules that apply to the files in the diff.

1. **Modern language**: is there an older idiom where the pinned toolchain has a newer one? Any
   experimental or `unstable_` feature? Go: `golangci-lint run --enable-only modernize,perfsprint,usestdlibvars`
   (in `apps/server`) must report 0 issues.
2. **API design** (proto, handlers, events, endpoints): the "Checklist for a new RPC".
3. **Security**: identity from the token, owner scoping, input bounds, no secrets or PII in logs, URLs or
   responses, outbound calls through configured clients, CSP updated for any new origin.
4. **Performance and scale**: queries indexed and column-limited, no N+1, bounded payloads and pages,
   slow work in jobs, web chunks lazy-loaded where possible, budgets untouched or raised with a reason.

Fix every finding in your own diff. A finding you cannot fix (out of scope, needs a decision) goes to the
report, not into a silent workaround.

## 3. Run the gates

`task check`, then the commands `task verify:<platform>` prints for each touched platform that this
machine can run (`task doctor`). Frozen platforms (Android, Apple, Desktop) get static review only.

## 4. Independent review

Run the `review-platform` skill for each touched platform; do not pass it your conclusions.

## Output

Per lens: findings fixed, findings left open (with the reason), and "not applicable" lenses. Then the
gates run with their result, and what was not verified, in `verify-status` wording.

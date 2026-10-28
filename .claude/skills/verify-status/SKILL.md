---
name: verify-status
description: Establish what can honestly be claimed about build and test status on THIS machine before saying "it works", "it builds" or "tests pass". Use before any completion report, PR description or status.md edit, and whenever a claim about Android, Apple, Desktop or CI is about to be made.
---

# verify-status

Rule from `AGENTS.md`: honesty about verification. A passing repo-wide script says nothing about whether a platform builds. This skill makes the claim match the evidence.

## Procedure

1. **What this machine can do**: run `task doctor`. It prints the highest level reachable per platform (static, tests, build).
2. **Run only what that level allows**, with the exact commands from `task verify:<server|web|android|apple|desktop>`. Run the ones relevant to the files touched; do not run others to pad the report.
3. **Read the recorded status** in [`docs/content/status.md`](../../../docs/content/status.md) (verification table, "What can be verified where", exit criteria).
4. **Write the claim using the vocabulary below.** Never write a stronger word than the evidence.

| Evidence you have | You may say |
|---|---|
| Command ran in this session and passed | "`<command>` passed here (<date>, <machine class>)" |
| Command ran and failed | "failed", with the tail of the output |
| Toolchain missing | "not run: <tool> is not installed here" |
| Only reading the code | "statically reviewed, not compiled" |
| CI result you did not see | "UNVERIFIED: no CI run observed" |

5. **Platform ceilings** (unless `status.md` was updated after a real build):
   - Server, Web: tests and build can be claimed once they ran.
   - Android: JVM only (unit tests, assemble, lint, ktlint, detekt). Never "works on a device".
   - Apple, Desktop: never "builds" or "passes". Say "statically reviewed".
   - CI workflows, image build, cosign, Helm, Argo CD: never "works" until a run is seen on GitHub (see "CI evidence" in `docs/content/status.md`).
6. **If you changed a platform's status**, update the verification table and `features.yaml` `verification:` in the same change, with the command, date and machine. A platform moves to Verified only when its exit criteria in `status.md` all ran.

## Report format

```
Ran:      <command> -> pass/fail
Not run:  <command> -> <reason>
Claims:   <platform>: <allowed phrase from the table>
```

## Done when

- [ ] Every claim in the final message maps to a "Ran" line or is phrased with a weaker word.
- [ ] No Apple, Desktop or device claim stronger than "statically reviewed".

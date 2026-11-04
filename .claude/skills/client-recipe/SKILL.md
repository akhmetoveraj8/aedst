---
name: client-recipe
description: Add or change the same feature on the AEDST clients (web, Android, Apple, Desktop) using the eight-step recipe (declare, domain, data, presentation, navigation, i18n, wire, test) and keep parity. Use for any feature that must exist on more than one client.
argument-hint: "<feature> [platforms]"
---

# client-recipe

Source of truth: [`docs/content/client-recipe.md`](../../../docs/content/client-recipe.md) (the file each step produces on each platform) and the reference behaviour [`docs/content/features/tasks.md`](../../../docs/content/features/tasks.md). This skill is the procedure; do not copy the table here, open it.

## Procedure

1. **Spec**: an approved behaviour spec exists (`write-spec` skill). One behaviour spec for all clients.
2. **Pick the platforms** that exist in this checkout (`ls apps`) and are in scope. Server is the contract; do the RPC first if the feature needs one, and regenerate clients (`task web:generate`, `task android:generate`, `task apple:generate`) instead of hand-editing generated code.
3. **Go platform by platform, step by step**, in the order of the recipe table:
   1. Declare in `features.yaml` (same row for all five platforms: `id`, `flagged`, `outbox` types, `i18n_namespace`, `routes`).
   2. Domain. A use case exists only where there is client logic (validation, composition, idempotency key).
   3. Data. Exactly one file per platform touches proto types. The outbox method is `deliver` on every platform.
   4. Presentation (ViewModel and view).
   5. Navigation. Typed routes, no strings at call sites.
   6. i18n: five locales, key mapping from `docs/content/i18n.md` (web `tj`, others `tg`).
   7. Wire in the composition root.
   8. Test, including the replay of the shared behaviour fixtures in `docs/contract/behavior/`.
4. **Start with web** (the verified client that can run tests here), then Android, then Apple and Desktop. Copy the `tasks` files on that platform, do not invent a new shape.
5. **Unknown values**: every client must tolerate an unknown enum value and respect list-query rules from the recipe's "Rules that hold on every platform" section. Read that section before step 2.

## Parity gates

```bash
task check:features    # shape: same flagged set, same outbox types, every layer present
task check:behavior    # shared scenarios replay
task check:i18n        # five locales in parity
task check
```

A platform may not claim more in `features.yaml` than its verification level (`implemented`, never `verified`, for Apple and Desktop).

## Done when

- [ ] The feature row in `features.yaml` is present for every platform in scope, with `evidence` paths that exist.
- [ ] Every platform in scope has the file for each of the eight steps (or a documented `exceptions:` entry with a reason).
- [ ] Behaviour fixtures replay on every platform where the toolchain exists; otherwise the report says "not run: <why>".
- [ ] Apple and Desktop edits are reported as "statically reviewed, never compiled".

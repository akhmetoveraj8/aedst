# Quality bar (read on every code task)

The short form of [docs/content/engineering](../content/engineering/index.md). It adds to the Library-First
rule and the decisions; it never overrides them. Open the full page only for the area you touch.

## Modern language ([full](../content/engineering/modern-language.md))

- Write for the **pinned** toolchain: Go 1.27 (`apps/server/go.mod`), TypeScript 7 / React 19.3 /
  Next 16.4 (`apps/web/pnpm-workspace.yaml`), Kotlin 2.5.0-RC (2.4 stable feature set), Swift 6 mode on the 6.3 compiler, Rust edition
  2024 capped at MSRV 1.92. If your training predates the pin, read the release notes first.
- Use the newer idiom when one exists (Go: `errors.AsType`, `new(expr)`, `WaitGroup.Go`, iterators,
  `min`/`max`, `slices`/`maps`, `synctest`; React: Compiler instead of manual memo, Actions, `use`,
  `ref` as prop; Kotlin: explicit backing fields, `when` guards). Go is gated by `modernize`.
- No experimental, preview or `unstable_` features without a decision row.

## API design ([full](../content/engineering/api-design.md); use the `api-design` skill)

- Contract first in `.proto`, copied from `aedst.tasks.v1`: own request/response per RPC, standard verbs,
  Protovalidate bounds on every input, comments on every field.
- Lists: `page_size` + opaque `page_token` / `next_page_token`, keyset underneath, typed filters.
- Writes: `update_mask`, `expected_version`, `Idempotency-Key` or guarded SQL, event in the same transaction.
- Errors from the shared vocabulary, `NOT_FOUND` for foreign objects, no internal detail.
- Additive only within `v1`; breaking = new `v2` package beside it (`buf breaking`).

## Security ([full](../content/engineering/security.md))

- Identity from the token only; every query scoped by owner; roles in `AEDST_ROLE_POLICY`.
- No self-built auth, no second JWT library, no token or PII in logs, URLs or responses.
- Validate every input at the boundary and in the domain; no string-built SQL; outbound HTTP only
  through configured clients with timeouts and an allowlist.
- New secret = environment variable, never a literal; new security-sensitive dependency = recorded reason.

## Performance ([full](../content/engineering/performance.md))

- Budgets fail CI (`bundle-budget.json`, `lighthouserc.json`, k6, p95 < 200 ms); measure before and after.
- Web: Server Components first, `"use client"` at the leaf, lazy-load what is not needed now,
  `next/image` / `next/font` only, virtualize long lists, no inline scripts.
- Server: indexed keyset queries, only needed columns, no N+1, slow work in River jobs, bounded payloads,
  cache-aside with TTL and invalidation, nothing network-bound inside a transaction.

## Structure, accessibility, SEO

- Code goes into a module, then a feature; modules meet only through public contracts, features never
  import each other ([modules and features](../content/architecture/modules-and-features.md)).
- UI meets WCAG 2.2 AA: kit components only, named controls, keyboard access, no colour-only state,
  logical (right-to-left safe) properties ([accessibility](../content/engineering/accessibility.md)).
- Web: `landing` pages ship canonical, hreflang, JSON-LD and stay static; `admin` is never indexed
  ([SEO by project](../content/web/seo-by-project.md)).
- Every roadmap.sh item is a rule for new code even where no gate exists yet; close a gap, update its
  status ([roadmap coverage](../content/engineering/checklists.md)).

## Before you say "done"

Run the `quality-pass` skill: it checks the diff against this page, runs the gates, and states what was
not verified (`verify-status`).

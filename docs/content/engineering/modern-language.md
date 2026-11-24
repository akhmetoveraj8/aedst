---
title: "Modern language features"
description: "Which language and standard-library features of each pinned toolchain new AEDST code must use, which are off limits because they are experimental, and how each rule is enforced."
---

# Modern language features

New code is written for the toolchain the repo **pins**, not for the release the author learned first.
Older idioms that a newer release replaced are review findings. Experimental or preview features are
not used: they can change or disappear in a patch release, and a template must not depend on them.

The versions below were verified against the official release notes on 2026-11-04. The pin files are
the source of truth; when one changes, update this page in the same change.

| Platform | Pinned in | Version | Language level |
|---|---|---|---|
| Server | `apps/server/go.mod`, `mise.toml` | Go 1.27.4 | `go 1.27.3` |
| Web | `apps/web/pnpm-workspace.yaml` | TypeScript 7.0, React 19.3, Next.js 16.4 | `strict: true` |
| Android | `apps/android/gradle/libs.versions.toml` | Kotlin 2.5.0-RC (owner exception; latest stable 2.4.21), JDK 21 | Kotlin 2.4 stable feature set until 2.5.0 final |
| Apple | `apps/apple/Project.swift`, `mise.toml` (Xcode 26.6) | Swift 6.3 compiler | Swift 6 language mode, iOS 18 / macOS 15 floor |
| Desktop | `apps/desktop/rust-toolchain.toml`, `apps/desktop/Cargo.toml` | Rust 1.99.1 toolchain | Edition 2024, **MSRV 1.92** |

Android, Apple and Desktop are frozen ([status](/status)): the rules below apply when they are
unfrozen, and no feature work starts there because of this page.

## How to stay current (every platform)

1. Read the release notes of the pinned version before writing a non-trivial change. If your
   knowledge predates the pin, the notes are the authority, not your memory.
2. Run the platform's modernizer when it exists (Go: the `modernize` linter, `go fix`). Do not
   hand-write what a modernizer can rewrite.
3. A feature that needs a newer toolchain or a higher minimum OS is a version bump first
   (`add-dependency` skill, registry-verified), never a silent `#available` scatter or a nightly flag.
4. Never claim a feature exists in a version you have not verified; write `UNVERIFIED`.

## Go 1.27 (server)

Enforced by `apps/server/.golangci.yml`: `modernize` (all analyzers), `perfsprint` and
`usestdlibvars` run in `task server:lint` and CI. All three are auto-fixable
(`golangci-lint run --fix`); the fixer does not add imports, so build and vet after it.

Use:

| Feature | Since | Instead of |
|---|---|---|
| Generic methods (methods with their own type parameters; they cannot satisfy interface methods) | 1.27 | A free function taking the receiver |
| `encoding/json` backed by json/v2 (stricter: rejects invalid UTF-8 and duplicate names; much faster unmarshal), `encoding/json/v2` and `jsontext` | 1.27 | Third-party JSON libraries; never set `GOEXPERIMENT=nojsonv2` without a decision |
| `uuid` standard package (already used by `apps/server/internal/shared/ids`) | 1.27 | A third-party UUID module in new code |
| `strings.CutLast` / `bytes.CutLast`, `URL.Clone`, `Values.Clone` | 1.27 | Index arithmetic, hand copies |
| `httptest.NewTestServer` with `testing/synctest`, `synctest.Sleep` | 1.27 | Real sleeps and wall-clock timeouts in tests |
| `/debug/pprof/goroutineleak` profile (behind `AEDST_PPROF_ENABLED`) | 1.27 | Ad-hoc goroutine counting |
| `new(expr)` for pointers to values (optional proto/sqlc fields) | 1.26 | A `ptr[T]` helper or a temporary variable |
| `errors.AsType[T](err)` | 1.26 | `var t T; errors.As(err, &t)` |
| `reflect` iterators (`Type.Fields()`), `slog.NewMultiHandler` | 1.26 | Index loops, hand-written fan-out handlers |
| `testing/synctest` for concurrency and timer tests | 1.25 | Sleeps, injected tickers written only for tests |
| `sync.WaitGroup.Go(f)` | 1.25 | `wg.Add(1); go func() { defer wg.Done() }()` |
| Container-aware `GOMAXPROCS` (respects the cgroup CPU limit) | 1.25 | `go.uber.org/automaxprocs` (do not add it) |
| Range over functions (`iter.Seq`, `maps.Keys`, `slices.Collect`, `strings.SplitSeq`) and over ints | 1.23 / 1.22 | Building intermediate slices only to loop over them |
| `min`, `max`, `clear`, `slices.*`, `maps.*`, `cmp.Compare` | 1.21 | Hand-written loops and helpers |
| `testing.B.Loop` in benchmarks, `os.Root` for path-confined file access | 1.24 | `for i := 0; i < b.N; i++`, `filepath.Join` on untrusted names |

Not used: `GOEXPERIMENT=simd` and any other experiment; `golang.org/x/exp` in production code.

## TypeScript 7, React 19.3, Next.js 16.4 (web)

TypeScript 7 is the native compiler: same type system as 6.0, stricter defaults (`strict`,
`module: esnext`, `noUncheckedSideEffectImports`), and the removed options (`baseUrl`,
`moduleResolution: node10`, `esModuleInterop: false`, import `asserts`) are errors. Tools that need the
compiler API use `@typescript/typescript6` until 7.1.

Use:

- **React Compiler** is on (`reactCompiler: true` in `apps/web/app/next.config.ts` and the marketing
  config). Do not add `useMemo`, `useCallback` or `memo` for render performance; add them only for
  referential identity a dependency array or external store really needs, with a comment.
- **Actions**: `<form action>`, `useActionState`, `useOptimistic`, `useFormStatus` for mutations with
  pending and optimistic state; forms still go through React Hook Form where `apps/web/app/AGENTS.md`
  says so.
- `use()` for promises and context, `ref` as a prop (no `forwardRef`), `<Context>` as the provider,
  ref cleanup functions, document metadata (`<title>`, `<meta>`) in components.
- `useEffectEvent` instead of disabling the exhaustive-deps rule; `<Activity>` to keep hidden UI state
  without rendering cost; `<ViewTransition>` (stable in 19.3) for route and list transitions.
- Next.js 16: `proxy.ts` (never `middleware.ts`), awaited `params`/`cookies()`/`headers()`, Server
  Components by default with `"use client"` at the smallest leaf, `updateTag`/`refresh` after
  mutations, Turbopack. **Cache Components** (`cacheComponents`, `"use cache"`) are not enabled yet;
  turning them on is a decision ([decisions/web](/decisions/web)), and Next 17 makes them the default.

Not used: experimental Next flags (`turbopackRustReactCompiler`, `turbopackGc`), `unstable_*` APIs in new
code, `any` (Biome `noExplicitAny` is an error), non-null `!` without a comment. Naming and export
shapes follow [conventions/web](../../agent/conventions/web.md).

## Kotlin 2.5.0-RC (Android, frozen)

The compiler is 2.5.0-RC by owner decision (2026-11-21). Until 2.5.0 final ships and its release notes are
reviewed, the allowed feature set is the Kotlin 2.4 stable set below; a 2.5 feature needs a recorded decision.

Use (stable): context parameters (explicit context arguments are still experimental), explicit backing
fields (`val state: StateFlow<UiState> field = MutableStateFlow(UiState())` instead of the
`_state`/`state` pair), `kotlin.uuid.Uuid`, `kotlin.time.Clock`/`Instant`, nested type aliases,
data-flow exhaustiveness for `when`, guard conditions in `when` (`is X if cond ->`), non-local
`break`/`continue`, multi-dollar interpolation, `isSorted*()`.

Not used: collection literals, the return-value checker (`-Xreturn-value-checker`), name-based
destructuring, context-sensitive resolution, `Uuid.generateV4/V7` (experimental), any `-X` language flag
or `@OptIn` to an experimental language feature without a recorded decision.

## Swift 6.3 compiler, Swift 6 mode (Apple, frozen, never compiled)

Xcode 26.6 ships Swift 6.3; Swift 6.4 needs Xcode 27 and is not available here.

Use: complete data-race safety (Swift 6 mode, no `@preconcurrency` or `nonisolated(unsafe)` without a
comment), typed throws `throws(E)` for closed error sets, `~Copyable` where ownership matters,
`Mutex`/`Atomic` from Synchronization instead of locks and queues, `nonisolated` on types and
extensions, `@concurrent` to move work off the caller's actor, `@Observable` and `NavigationStack`,
Swift Testing (`@Test`, `#expect`) for new tests, `count(where:)`.

Availability-gated APIs (`InlineArray`, `Span`) need the iOS 18 / macOS 15 floor checked first; their
exact minimum OS is `UNVERIFIED`. Default MainActor isolation is a project-wide setting, not a per-file
choice: adopting it is a decision.

## Rust edition 2024, MSRV 1.92 (Desktop, frozen)

The toolchain is 1.99.1 but `rust-version = "1.92"` caps the language and std to 1.92. Anything newer
(`if let` guards in match arms and `cfg_select!` in 1.95, `assert_matches!` in 1.96) needs an MSRV
bump first. Whether clippy's `incompatible_msrv` lint catches every case is `UNVERIFIED`.

Use: let chains (`if let Some(x) = a && x > 0`), async closures and `AsyncFn*` bounds, `LazyLock` and
`OnceLock` instead of `lazy_static`/`once_cell`, `#[expect(lint, reason = "...")]` instead of
`#[allow]`, trait upcasting, `Vec::extract_if`, `Vec::pop_if`, `get_disjoint_mut`, `Result::flatten`,
`File::lock`, `Duration::from_mins`, `std::io::pipe`. Workspace lints already deny `unsafe_code`,
`unwrap_used` and `clippy::all` (`apps/desktop/Cargo.toml`).

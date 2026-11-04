# core:ui-tv — Aedst TV Design System (Jetpack Compose for TV)

Thin, 10-foot/D-pad-focused companion to [`core:ui`](../ui/README.md), used only by `:app-tv`. See [CONVENTIONS.md](../../../../CONVENTIONS.md) for the naming rules every file here follows, and [docs/content/library-first.md](../../../../docs/content/library-first.md) for why `androidx.tv:tv-material` (official Jetpack Compose for TV) is the approved library here rather than a custom leanback/focus framework.

## Why this is a separate module, not a fork of `core:ui`

`core:ui`'s `Aedst*` components are built for touch/phone interaction: Material3 primitives, tap targets, scroll gestures. A 10-foot UI driven by a D-pad has genuinely different requirements — focus traversal instead of touch, scroll-into-view on focus instead of fling gestures, and TV-specific Material components (`androidx.tv.material3`) with their own focus/scale animation contract that Material3's phone components don't expose.

This is the same reasoning Apple's `apps/apple` codebase uses `#if os(iOS)` / `#if os(macOS)` branches for platform divergence inside otherwise-shared code — except Android has no equivalent compile-time branch inside a single Compose source set, so the module boundary (`core:ui` vs. `core:ui-tv`) does that job instead: components that must render differently for D-pad focus live here, named `Tv*` instead of `Aedst*` so both can sit on the classpath of the same consumer without a naming clash; components that don't diverge (theme tokens, spacing) stay in `core:ui` and are reused as-is via an `api` dependency.

## What's reused from `core:ui` as-is

Declared as an `api(project(":core:ui"))` dependency (so `:app-tv` gets these transitively without its own direct dependency on `core:ui`):

- `theme/Theme.kt` — `AedstTheme` (wraps the shared Material3 color scheme/typography/shapes; also used to preview the components below).
- `theme/AedstSpacing.kt` — the generated spacing scale, reused directly for TV layout padding/arrangement.
- `theme/AedstLightPalette.kt`, `AedstDarkPalette.kt`, `AedstRadius.kt`, `AedstElevation.kt`, `ExtendedColors.kt`, `Type.kt`, `Shape.kt` — same semantic tokens, no TV-specific variant needed.

**Known gap:** `androidx.tv.material3.MaterialTheme` (used internally by `TvPrimaryButton`/`TvTopAppBar`) keeps its own default TV color scheme — it is not yet bridged from `AedstTheme`'s Aedst palette the way `core:ui`'s Material3 `MaterialTheme` is. Porting the full Aedst palette into a `androidx.tv.material3.ColorScheme` (mirroring `core/ui/theme/Theme.kt`'s `LightColors`/`DarkColors`) is a follow-up, not done here to keep this module thin.

## Components (`src/main/kotlin/com/aedst/core/ui/tv/`)

| File | What it wraps | Why it diverges from `core:ui` |
|---|---|---|
| `TvPrimaryButton.kt` | `androidx.tv.material3.Button` | TV `Button` has a distinct focus/scale animation contract vs. Material3's `Button`. `app-tv` hands it to `feature/auth` through `AuthNavGraph(actionButton = ...)` for the device sign-in and account screens (that module must not depend on `core:ui-tv`). |
| `TvTopAppBar.kt` | `androidx.tv.material3.Surface` + `Text` (no native TV `TopAppBar` exists) | Header layout tuned for overscan-safe margins and D-pad focus groups instead of a touch app bar. |
| `TvUpgradeRequiredScreen.kt` | `TvPrimaryButton` + `androidx.tv.material3.Text` | Blocking `CLIENT_UPGRADE_REQUIRED` screen (ADR-0009) with overscan-safe margins and the only button focused on arrival; strings come from `core:ui`. |
| `TvLazyRow.kt`, `TvLazyColumn.kt` | Compose Foundation `LazyRow` / `LazyColumn` | D-pad-navigable lists with TV defaults (spacing tokens, focus-friendly content padding). `androidx.tv:tv-foundation` is not used (deprecated; rejected in library-first). |

All of these are thin wrappers, analogous to how `core:ui`'s `Aedst*` components wrap Material3 primitives — no business logic, no duplicated layout engine, just TV-appropriate defaults (Aedst spacing tokens, sane arrangement/state defaults) around the official `androidx.tv` primitives.

Only `androidx.tv:tv-material` is declared in `build.gradle.kts`; `androidx.tv:tv-foundation` is no longer needed (deprecated; `TvLazyRow`/`TvLazyColumn` wrap the standard Compose Foundation `LazyRow`/`LazyColumn`).

## Verification status

This module compiles as part of `:app-tv:assembleDebug` and its JVM tests (`TvComponentsTest`, including the focus and D-pad key handling and an accessibility check of the upgrade screen) run in `testDebugUnitTest` (see [status](../../../../docs/content/status.md)). It has **not** been run on a TV device or emulator.

Before merging, run `./gradlew :core:ui-tv:compileDebugKotlin ktlintCheck detekt`.

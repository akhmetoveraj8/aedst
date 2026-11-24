# @aedst/design-tokens

Single source of truth for AEDST design tokens: colors (light/dark), spacing, radius, elevation,
typography and motion durations. Tokens are [DTCG](https://www.designtokens.org/) JSON in
`tokens/`; [Style Dictionary](https://styledictionary.com/) v5 (`usesDtcg: true`, ESM) generates
committed code into each platform's design-system directory. Web values are the reference: the
colors are stored as OKLCH exactly as in shadcn's `globals.css`.

```
tokens/                     <- edit these (only place values live)
  color/light.json          color.light.<name>   (DTCG color objects, oklch / srgb)
  color/dark.json           color.dark.<name>    (must define exactly the same names)
  spacing.json  radius.json  elevation.json  typography.json  motion.json
build.mjs                   Style Dictionary config + the few custom hooks
```

## Commands

```sh
pnpm install                # once (in packages/design-tokens)
pnpm build                  # regenerate all outputs
pnpm check                  # build, then fail if any generated file differs from git (drift check, for CI)
```

`check` exits non-zero when regenerating changed or created a tracked/untracked generated file,
i.e. someone edited a token without committing the regenerated output (or hand-edited an output).

## Generated outputs (all carry `GENERATED — do not edit; edit packages/design-tokens/tokens`)

| Platform | Files | Consumed by |
|---|---|---|
| Web | `apps/web/shared/ui/tokens.css` | `@import`ed by the `globals.css` of each web project (`apps/web/app|admin|marketing/src/app/styles/`). `:root` (light + scales) and `.dark`. Colors keep the shadcn variable names (`--background`, `--primary-foreground`, `--sidebar-ring`, ...), `--radius` is the shadcn radius base, everything else is `--aedst-*`. `globals.css` `@theme inline` maps them to Tailwind. |
| Android | `apps/android/core/ui/src/main/kotlin/com/aedst/core/ui/theme/`: `AedstLightPalette.kt`, `AedstDarkPalette.kt` (`Color`), `AedstSpacing.kt`, `AedstRadius.kt`, `AedstElevation.kt` (`Dp`), `AedstTypeScale.kt` (`sp`/`Dp`/`const val` weights), `AedstMotion.kt` (`const val` ms) | `Theme.kt`, `ExtendedColors.kt`, `Type.kt`, `AedstShapesScale.kt`, components |
| Apple | `apps/apple/Core/AedstDesignSystem/Sources/AedstDesignSystem/`: `AedstLightPalette.swift`, `AedstDarkPalette.swift` (`Color`), `AedstSpacing.swift`, `AedstRadius.swift`, `AedstElevation.swift`, `AedstTypeScale.swift` (`CGFloat`), `AedstMotion.swift` (seconds) | `AedstColor.swift` pairs the palettes into adaptive light/dark colors; components |
| Desktop (Rust + Slint) | `apps/desktop/crates/aedst-ui/ui/aedst_tokens.slint` (one `AedstTokens` global: colors resolve through its `dark` flag, e.g. `AedstTokens.background`, `spacing-md`, `radius-lg`, `motion-duration-fast`) | `aedst_layout.slint` (`AedstLayout.rtl`) and the `Aedst*` components |

Built-in Style Dictionary formats/transforms are used wherever one exists (`color/oklch`,
`color/composeColor`, `color/ColorSwiftUI`, `color/hex8android`, `size/compose/dp|sp`,
`size/swift/remToCGFloat`, `time/seconds`; formats `compose/object`, `ios-swift/any.swift`). Custom
code in `build.mjs` is limited to: AEDST naming transforms (CONVENTIONS.md), the web file layout
(`:root` + `.dark` in one file), the Slint globals format (Style Dictionary has no Slint format), and
whitespace/`const val` normalisation of the Kotlin/Swift output so ktlint/detekt/SwiftLint pass.

## How to add a token

1. Add it to the right file under `tokens/` using a DTCG `$type`:
   - color: add the **same name to both** `color/light.json` and `color/dark.json` (the build fails if they differ). Value: `{"colorSpace": "oklch", "components": [L, C, H], "alpha": 0.1}` or `srgb` with `components` 0..1.
   - `dimension` (spacing/radius/elevation/line height): `{"value": 4, "unit": "px"}` (px = dp on Android, pt on Apple).
   - `fontSize`: same shape as dimension. `fontWeight`: number. `time`: milliseconds as a number (Style Dictionary's `time` type).
2. `pnpm build`, review the generated diff, commit tokens and outputs together.
3. Use the new constant from the hand-written layer of each platform (e.g. `Theme.kt`,
   `AedstColor.swift`). A new **color** name needs a line in those pairing layers; `globals.css`
   needs an `@theme inline` entry (`--color-<name>: var(--<name>)`) for a Tailwind utility.
4. New group (a new top-level key)? Add its file(s) to the `platforms.*.files` lists in `build.mjs`.

To override the web CSS variable name of a token set
`"$extensions": {"com.aedst": {"cssName": "radius"}}` (used for `radius.lg` -> `--radius`).

## Drift check

`pnpm check` (`node build.mjs --check`) regenerates and then runs `git diff --name-only` and
`git ls-files --others` over exactly the generated paths. Run it in CI after
`pnpm install --frozen-lockfile` in this directory.

## Decisions / known differences

- Light/dark neutrals were previously hand-converted differently per platform (Android was off by ~10 sRGB
  levels, desktop had a slightly lighter dark popover, chart greys differed). All now derive from web's OKLCH values.
- `destructiveForeground`, `success*` and `warning*` have no web CSS variable; they exist for the native
  platforms (values taken from the previous Apple implementation) and are also emitted to CSS.
- The spacing scale is Android's 4px scale plus `xxs`. Apple call sites were remapped by name so their pixel values are unchanged.
- Typography is the Material-style scale used on Android plus `small`/`mono` (desktop). Apple keeps Dynamic Type
  text styles (`AedstTypography`) on purpose; `AedstTypeScale` there is reference-only.

# Design-system snapshot tests

Pixel snapshots of the core components (`AedstButton`, `AedstBadge`, `AedstAlert`,
`AedstTextField`, `AedstCard`, `AedstSkeleton`). Library: Point-Free
[swift-snapshot-testing](https://github.com/pointfreeco/swift-snapshot-testing) (test target only).
The tests are in `ComponentSnapshotTests.swift`; the variants and the per-OS helper
(`assertComponent`) are in `SnapshotSupport.swift`.

## Variants (reference images per component group)

iOS Simulator (UIKit trait collections, `displayScale` pinned to 2):

| Name | Idiom / size class | Canvas | Style | Dynamic Type | Direction |
|---|---|---|---|---|---|
| `iphone-light` | phone, compact | 390 pt | light | default | LTR |
| `iphone-dark` | phone, compact | 390 pt | dark | default | LTR |
| `iphone-a11y-xxxl` | phone, compact | 390 pt, 3x height | light | accessibilityXXXL | LTR |
| `ipad-light` | pad, regular/regular | 820 pt | light | default | LTR |
| `ipad-dark` | pad, regular/regular | 820 pt | dark | default | LTR |
| `iphone-rtl-ar` | phone, compact | 390 pt | light | default | RTL, locale `ar` |

macOS (AppKit: the view is hosted in an `NSHostingView` whose `appearance` is `.aqua` / `.darkAqua`;
there are no size classes and no Dynamic Type on macOS):

| Name | Canvas | Appearance | Direction |
|---|---|---|---|
| `mac-light` | 480 pt | aqua | LTR |
| `mac-dark` | 480 pt | darkAqua | LTR |
| `mac-rtl-ar` | 480 pt | aqua | RTL, locale `ar` |

RTL covers layout mirroring (the SwiftUI `layoutDirection` and `locale` environment). The
component demo texts are English literals, so this does not check Arabic copy.

Rasterization differs per OS/runtime. Every variant is therefore recorded on the runner that
checks it (the iOS references on the CI simulator runtime, the `mac-*` ones on the CI macOS
image). Do not compare images across runtimes or machines.

## STATUS: no reference images exist yet

The references (`__Snapshots__/ComponentSnapshotTests/*.png`) could not be recorded in the authoring
environment (no Xcode, no Swift toolchain), and this suite was never compiled or run (UNVERIFIED).

So that this does not turn CI red with "no reference" noise, the suite is gated by `SnapshotMode.swift`
(env var `AEDST_SNAPSHOTS`):

| Value | Effect |
|---|---|
| `auto` (default) | Run only if references for this OS family exist; otherwise the tests are **skipped** |
| `verify` | Always run; a missing or differing reference **fails** (CI sets `SNAPSHOT_TESTING_RECORD=never`, nothing is written) |
| `record` | Always run; with `SNAPSHOT_TESTING_RECORD=all` the images are written |
| `skip` | Never run |

Once references are committed, `auto` becomes strict verification: a real diff always fails.

## Record (once, then after intentional visual changes)

One command, either way (details, pinned environment and PR flow: `docs/content/apple/snapshots.md`):

```sh
# CI (no Mac needed): Actions > apple-record-snapshots > Run workflow. It records on the runner image that
# checks them, verifies the recording once, uploads __Snapshots__ as an artifact and opens/updates a PR.
# On a Mac (same Xcode / simulator runtime as CI, see scripts/snapshots.sh):
cd apps/apple && make snapshots-record     # = bash scripts/snapshots.sh record
```

The script records the iOS Simulator variants and the macOS variants, writes `__Snapshots__/ENVIRONMENT.txt`
(Xcode, simulator runtime, macOS major) and then verifies the fresh recording. `verify` compares the current
environment to that file first, so a drifted runner image gives one clear message instead of pixel diffs.
Review the PNGs in the PR like any visual change.

Manual equivalent (what the script runs; `xcodebuild` forwards `TEST_RUNNER_`-prefixed variables to the test
process with the prefix stripped):

```sh
cd apps/apple/Core/AedstDesignSystem
TEST_RUNNER_AEDST_SNAPSHOTS=record TEST_RUNNER_SNAPSHOT_TESTING_RECORD=all xcodebuild test   -scheme AedstDesignSystem-Package -destination "platform=iOS Simulator,name=iPhone 17,OS=26.6"
TEST_RUNNER_AEDST_SNAPSHOTS=record TEST_RUNNER_SNAPSHOT_TESTING_RECORD=all xcodebuild test   -scheme AedstDesignSystem-Package -destination "platform=macOS"
```

A recording run reports every written image as an issue ("re-run to assert"), so its exit code is non-zero by
design; the verify pass is what must be green. CI never records in the check jobs.

## Notes

- `AedstSkeleton` is animated; the snapshot keeps its shapes <= 200 pt wide so the shimmer
  gradient (offset +-200 pt) is clipped out in any animation phase and the image is deterministic.
- Keep one `assertComponent` per component group; add states as rows in the existing view
  rather than new tests, to keep the reference count (6 iOS + 3 macOS per group) small.
- Heights are fixed per group (x3 for `iphone-a11y-xxxl`); if a layout clips, raise the number.

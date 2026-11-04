---
title: Snapshot tests
description: How the design-system pixel snapshots are recorded, verified and kept from failing CI before references exist.
---

# Apple snapshot tests

`Core/AedstDesignSystem/Tests/AedstDesignSystemTests/Snapshots` holds pixel snapshots of the core components (swift-snapshot-testing, test target only): iPhone light/dark/xxxl/RTL, iPad light/dark and macOS light/dark/RTL. Variants and per-component rows: that folder's `README.md`.

**Status: no reference images are recorded.** They cannot be produced without Xcode, so the suite has never run (UNVERIFIED). The setup below makes that safe: nothing is red because references are missing, nothing records during a normal CI run, and once references exist a real diff always fails.

## The switch: `AEDST_SNAPSHOTS`

Read by `SnapshotMode.swift` (the suite is `.enabled(if: SnapshotMode.shouldRun)`):

| Value | Effect |
|---|---|
| `auto` (default) | Run only if committed references exist for this OS family (`iphone-`/`ipad-` for iOS, `mac-` for macOS). Otherwise the tests are reported as **skipped** |
| `verify` | Always run. A missing or differing reference fails. Used with `SNAPSHOT_TESTING_RECORD=never` so nothing is written |
| `record` | Always run. With `SNAPSHOT_TESTING_RECORD=all` the images are written |
| `skip` | Never run |

For `xcodebuild test` the variable needs the `TEST_RUNNER_` prefix; `apps/apple/scripts/snapshots.sh` adds it. `swift test` (the per-package CI matrix) reads it as is and runs in `auto`.

## One command

```sh
cd apps/apple
make snapshots-record      # = bash scripts/snapshots.sh record   (Mac with Xcode)
make snapshots-verify      # = bash scripts/snapshots.sh verify
make snapshots-status      # what is recorded, and on which environment
```

`record` deletes the old references, records the iOS Simulator and macOS variants, writes `__Snapshots__/ENVIRONMENT.txt` (Xcode version, simulator device and OS, macOS major) and then **verifies the fresh recording** (it must pass without writing). A recording run reports each written image as an issue ("re-run to assert"), so its own exit code is ignored; the verify pass is the proof.

`verify` first compares the current environment with `ENVIRONMENT.txt`: a drifted runner image or Xcode produces one clear "re-record" message instead of dozens of pixel diffs. It skips a platform that has no references (GitHub notice, exit 0).

## CI

| Workflow | Does |
|---|---|
| `apple-ci.yml` job `snapshot-test` | `scripts/snapshots.sh verify`. Never records. No references: skipped with a notice. References: strict |
| `apple-ci.yml` job `test` (matrix, `swift test`) | `SNAPSHOT_TESTING_RECORD=never`, `AEDST_SNAPSHOTS=auto` (macOS variants verify only if committed) |
| `apple-record-snapshots.yml` | **Manual** (`workflow_dispatch`, macOS runner, Xcode 26.6, scheme and simulator derived from Xcode). Runs `snapshots.sh doctor`, then `snapshots.sh record`, uploads `__Snapshots__` as artifact `apple-snapshot-references`, and by default commits them to `chore/apple-snapshots-<branch>` and opens or updates a PR |

A PR opened with the default `GITHUB_TOKEN` does not start other workflows: close and reopen it (or push an empty commit) to run `apple-ci` on the new references.

## First recording (checklist)

1. Run `apple-record-snapshots` from the branch. Its `Doctor` step prints the schemes Xcode lists, the available iOS Simulator destinations and the pair the script will use. If the next step still cannot find a destination, read that output first and, if needed, force a choice with the `SNAPSHOT_SCHEME`, `SNAPSHOT_SIM_DEVICE` and `SNAPSHOT_SIM_OS` environment variables (the `-showdestinations` line format is parsed from memory and UNVERIFIED).
2. Review the PNGs in the PR like any visual change, merge.
3. From then on `apple-ci` verifies strictly. Re-run the workflow after an intentional visual change or a runner/Xcode bump.

## Why not record in the check jobs

References are rasterizer-specific (fonts, antialiasing, runtime). Recording and checking on the same runner image keeps them comparable; a check job that records would turn every diff into a silent pass.

## Runbook

Where the images come from and how they get into git:

1. **Derivation.** `scripts/snapshots.sh` never hard-codes a simulator or scheme. It reads the schemes from `xcodebuild -list` (preferring `AedstDesignSystem-Package`, then `AedstDesignSystem`, then the first) and the destinations from `xcodebuild -showdestinations -scheme <scheme>`: available iOS Simulators only, "Any iOS Simulator Device" and the ineligible block dropped, then the base `iPhone <N>` model on the newest iOS runtime (so record and verify on one runner image always pick the same device). The chosen name and runtime go into `ENVIRONMENT.txt`. `bash scripts/snapshots.sh doctor` prints the lists and the choice on any Mac.
2. **Recording** (the only time images are written): run `apple-record-snapshots` (`gh workflow run apple-record-snapshots.yml --ref <branch>`) or `make snapshots-record` on a Mac. It deletes the old references, records iOS and macOS, writes `ENVIRONMENT.txt` and verifies the fresh recording.
3. **Getting them out.** The workflow always uploads the whole `__Snapshots__` folder as the artifact `apple-snapshot-references` (14 days). With `open_pr` (default) it also commits to `chore/apple-snapshots-<branch>` (force-pushed, bot-owned) and opens or updates a PR against the dispatched branch. With `open_pr` off, download the artifact and copy the folder into `Core/AedstDesignSystem/Tests/AedstDesignSystemTests/Snapshots/__Snapshots__` yourself. On failure the result bundles and `env.diff` are uploaded as `apple-snapshot-record-logs`.
4. **Review and merge.** Look at the PNGs in the PR like any visual change. A PR created with the default `GITHUB_TOKEN` does not start `apple-ci`; close and reopen it.
5. **Re-record** after an intentional visual change, an Xcode or runner-image change (`verify` fails with the environment message), or a new component. Never edit a PNG by hand.

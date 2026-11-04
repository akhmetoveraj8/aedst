# AI review prompt: apps/apple

Review the pull request diff under `apps/apple/`. Report findings only; do not push fixes.

## Read first

1. `apps/apple/AGENTS.md` (situational rules) and `apps/apple/README.md` (layout, commands)
2. `docs/content/library-first/apple.md` (approved stack, explicit rejections)
3. `docs/content/decisions/apple.md` (recorded decisions; do not accept a contradicting change)
4. `docs/agent/conventions/apple.md` (naming)

## Also check

- Module boundaries per `apps/apple/scripts/check-feature-boundaries.sh`: features do not import other features' internals.
- Concurrency: no `DispatchQueue`, `Task.detached`, `@unchecked Sendable` or `nonisolated(unsafe)` without a recorded decision.
- Banned: XcodeGen, SwiftData, swift-perception, a hand-written image loader; use Observation, GRDB, Nuke, connect-swift.
- Logic lives in the model, not in a SwiftUI `View`; no token or PII logged without private privacy; Keychain is not bypassed with `UserDefaults`; no new App Transport Security exception.
- No color literals (`apps/apple/scripts/check-color-literals.sh`); files stay within `apps/apple/scripts/check-file-size.sh` limits; generated token files are not hand-edited.

Post findings as a PR review. If nothing applies, approve with no comments.

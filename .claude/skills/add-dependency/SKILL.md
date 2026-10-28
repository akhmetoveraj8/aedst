---
name: add-dependency
description: Add or bump a dependency (npm, Go module, Gradle, SwiftPM, vcpkg, GitHub Action, toolchain) the AEDST way: Library-First order, registry-verified version, allowlist and Library-First page updated in the same change. Use before writing any new utility or touching a manifest.
argument-hint: "<platform> <need or package>"
---

# add-dependency

Source of truth: [`docs/content/library-first/general.md`](../../../docs/content/library-first/general.md) plus the platform page (`docs/content/library-first/<platform>.md`). Do not reproduce them; follow them.

## 1. Do you need it at all? (stop at the first yes)

In this order: standard library, platform API, a library already in this repo's manifest (`package.json`, `go.mod`, `libs.versions.toml`, `Package.swift`, `vcpkg.json`), existing code in this repo. Custom code needs a documented technical reason (missing functionality, unsupported platform, incompatible API, unacceptable performance, security or compliance, domain logic). "Simpler" and "only 50 lines" are not reasons.

## 2. Is it allowed?

Check the platform's explicit-rejections list and `docs/content/decisions.md`. If it is rejected or kept by owner decision, stop and tell the user; do not re-propose. One primary tool per responsibility: no second competitor in the allowlist.

## 3. Verify the version against the registry

Never write a version from memory. Registry per platform: npm registry (`npm view <pkg> version`), `go list -m -versions <module>`, Maven Central or Google Maven, GitHub releases or tags, vcpkg baseline. Latest stable; a pre-release only with a documented reason. If the registry is unreachable write `UNVERIFIED` in the PR and leave the version unset. Versions of web packages live once in `apps/web/pnpm-workspace.yaml` (`"catalog:"` in each `package.json`). Toolchain versions live only in `mise.toml` (Qt: `apps/desktop/qt-version.txt`).

## 4. Edit manifest and allowlist in the SAME change

| Platform | Manifest | Allowlist that fails the build if missing | Page to update |
|---|---|---|---|
| Server | `go.mod` (`go mod tidy`) | `apps/server/architecturetest/approved_modules.txt`, depguard in `.golangci.yml` | `docs/content/library-first/server.md` |
| Web | `pnpm-workspace.yaml` catalog + project `package.json` | `knip.jsonc` of the project (`apps/web/app`, `admin`, `landing`) | `docs/content/library-first/web.md` |
| Android | `apps/android/gradle/libs.versions.toml` | `check-catalog-allowlist` in `apps/android/scripts/check-policies.sh` | `docs/content/library-first/android.md` |
| Apple | `Package.swift` of the owning Core package | `apps/apple/scripts/approved-packages.txt` | `docs/content/library-first/apple.md` |
| Desktop | `apps/desktop/vcpkg.json` | desktop policy checks | `docs/content/library-first/desktop.md` |

If the choice is a decision (not just a use of an approved pattern), add a row to the platform decisions page with "Revisit when".

## 5. Verify

```bash
task check                 # boundaries, docs links, naming, knip
task <platform>:lint       # or task server:check for the server
```

Then the platform test target if the toolchain exists (`task verify:<platform>` prints it). Report anything not run.

## Done when

- [ ] Library-First order walked; reason recorded if custom code was chosen instead.
- [ ] Version verified against the registry (or `UNVERIFIED`).
- [ ] Manifest, allowlist and Library-First page changed together.
- [ ] No rejected or competing tool introduced; no generated or lock file edited by hand.
- [ ] Gates above pass or are reported as not run.

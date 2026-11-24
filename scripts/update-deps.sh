#!/usr/bin/env bash
# Update dependencies of every platform to their latest STABLE versions,
# using each ecosystem's own tooling (no hand-rolled version resolution):
#
#   server   go get -u ./... + go mod tidy               (apps/server)
#   web      pnpm update --latest                        (apps/web workspace: catalog in pnpm-workspace.yaml, docs, packages/*)
#   android  Gradle wrapper → latest release (catalog versions: Renovate only)
#   apple    swift package update inside Tuist/          (apps/apple; macOS only)
#   desktop  cargo update (compatible versions only)     (apps/desktop)
#   tools    mise upgrade --bump                         (mise.toml)
#
# "Stable" means: Go modules — the proxy's latest release (no pre-releases);
# npm — the `latest` dist-tag, filtered by pnpm's minimumReleaseAge;
# Gradle — Renovate (renovate.json) never proposes alpha/beta/rc/... and only the wrapper is bumped here;
# SwiftPM — highest release tag inside each package's `from:` range (majors
# stay manual on purpose); cargo — semver-compatible versions inside Cargo.toml's requirements.
#
# Continuous updates are Renovate's job (renovate.json). This script is the
# on-demand "bump everything now" path; it never commits. Review the diff,
# then run `task check` / `task test`, and update docs/content/<platform>/stack.md and
# docs/content/library-first.md when a version in them moved.
#
# Usage:
#   scripts/update-deps.sh                 # all platforms
#   scripts/update-deps.sh server web      # selected platforms
#   scripts/update-deps.sh --check         # only report what is outdated
#   scripts/update-deps.sh --no-verify     # skip build/test after updating
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALL_PLATFORMS=(server web android apple desktop tools)
CHECK_ONLY=0
VERIFY=1
PLATFORMS=()

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --no-verify) VERIFY=0 ;;
    -h | --help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    server | web | android | apple | desktop | tools) PLATFORMS+=("$arg") ;;
    *)
      echo "unknown argument: $arg (expected: ${ALL_PLATFORMS[*]} --check --no-verify)" >&2
      exit 2
      ;;
  esac
done
[[ ${#PLATFORMS[@]} -eq 0 ]] && PLATFORMS=("${ALL_PLATFORMS[@]}")

FAILED=()
# Platforms run in subshells (each cd-s and may fail independently), so skips
# are collected through a file rather than an array.
SKIP_FILE="$(mktemp)"
trap 'rm -f "$SKIP_FILE"' EXIT

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

skip() {
  warn "$1: skipped — $2"
  echo "$1 ($2)" >>"$SKIP_FILE"
}

update_server() {
  have go || { skip server "go not installed"; return 0; }
  log "server: Go modules"
  cd "$ROOT/apps/server"
  if [[ $CHECK_ONLY -eq 1 ]]; then
    # Direct dependencies with a newer release available.
    go list -m -u -f '{{if and (not .Indirect) .Update}}{{.Path}}: {{.Version}} -> {{.Update.Version}}{{end}}' all
    return 0
  fi
  go get -u ./...
  go get -u -t ./...
  go mod tidy
  if [[ $VERIFY -eq 1 ]]; then
    go build ./...
    go vet ./...
    go test ./...
  fi
}

update_web() {
  have pnpm || { skip web "pnpm not installed"; return 0; }
  local dirs=("$ROOT/apps/web" "$ROOT/docs")
  local pkg
  for pkg in "$ROOT"/packages/*/; do
    [[ -f "$pkg/package.json" ]] && dirs+=("${pkg%/}")
  done
  local dir
  for dir in "${dirs[@]}"; do
    log "web: ${dir#"$ROOT"/}"
    cd "$dir"
    if [[ $CHECK_ONLY -eq 1 ]]; then
      pnpm outdated || true # exits 1 when something is outdated
      continue
    fi
    # --latest crosses semver ranges (majors included) to the `latest` tag;
    # exact pins in package.json stay exact.
    # apps/web is a pnpm workspace (shared, app, admin, marketing) whose versions live in the
    # `catalog:` of pnpm-workspace.yaml, so it is updated recursively from its root. Whether
    # pnpm rewrites catalog entries is UNVERIFIED here; if not, Renovate bumps the catalog.
    if [[ "$dir" == "$ROOT/apps/web" ]]; then pnpm update -r --latest; else pnpm update --latest; fi
    if [[ $VERIFY -eq 1 && -f package.json ]]; then
      if node -e 'process.exit(require("./package.json").scripts?.typecheck ? 0 : 1)'; then pnpm typecheck; fi
      if node -e 'process.exit(require("./package.json").scripts?.test ? 0 : 1)'; then pnpm test; fi
    fi
  done
  if [[ $CHECK_ONLY -eq 0 && $VERIFY -eq 1 ]]; then
    local proj
    for proj in app admin marketing; do
      cd "$ROOT/apps/web/$proj"
      pnpm lint
      pnpm knip
    done
  fi
}

update_android() {
  # Library versions in gradle/libs.versions.toml are Renovate's job (renovate.json: stable only, grouped
  # toolchain PRs); the in-repo ben-manes/version-catalog-update plugins were removed. Only the wrapper is bumped here.
  local gradlew="$ROOT/apps/android/gradlew"
  [[ -x "$gradlew" || -f "$gradlew" ]] || { skip android "apps/android/gradlew missing"; return 0; }
  have java || { skip android "JDK 21 not installed (mise install java)"; return 0; }
  log "android: Gradle wrapper (catalog versions: Renovate)"
  cd "$ROOT/apps/android"
  if [[ $CHECK_ONLY -eq 1 ]]; then
    bash ./gradlew --version | grep -E '^Gradle '
    return 0
  fi
  bash ./gradlew wrapper --gradle-version latest --distribution-type bin
  # Run twice: the second run uses the new wrapper and checksums it.
  bash ./gradlew wrapper --gradle-version latest --distribution-type bin
  if [[ $VERIFY -eq 1 ]]; then
    bash ./gradlew assembleDebug testDebugUnitTest
  fi
}

update_apple() {
  [[ "$(uname -s)" == "Darwin" ]] || { skip apple "needs macOS + Xcode"; return 0; }
  have swift || { skip apple "swift not installed"; return 0; }
  log "apple: Swift packages (Tuist/Package.swift)"
  cd "$ROOT/apps/apple/Tuist"
  if [[ $CHECK_ONLY -eq 1 ]]; then
    swift package update --dry-run
    return 0
  fi
  swift package update
  cd "$ROOT/apps/apple"
  if have tuist; then
    tuist install
    [[ $VERIFY -eq 1 ]] && make test
  else
    skip apple-verify "tuist not installed"
  fi
  warn "apple: SwiftPM stays inside each 'from:' range; bump majors in Tuist/Package.swift by hand."
}

update_desktop() {
  have cargo || { skip desktop "cargo not installed"; return 0; }
  log "desktop: cargo update (apps/desktop)"
  cd "$ROOT/apps/desktop"
  if [[ $CHECK_ONLY -eq 1 ]]; then
    cargo update --dry-run
    return 0
  fi
  cargo update
  warn "desktop: major bumps (Slint, the Rust toolchain in rust-toolchain.toml) stay manual; run cargo deny check."
  [[ $VERIFY -eq 1 ]] && cargo test --workspace
}

update_tools() {
  have mise || { skip tools "mise not installed"; return 0; }
  log "tools: mise.toml"
  cd "$ROOT"
  if [[ $CHECK_ONLY -eq 1 ]]; then
    mise outdated --bump || true
    return 0
  fi
  mise upgrade --bump
  warn "tools: keep go in apps/server/go.mod and node/pnpm in the CI workflows in sync with mise.toml."
}

for platform in "${PLATFORMS[@]}"; do
  # errexit is ignored inside an if/|| condition, so the subshell runs as a
  # plain command and its status is read afterwards.
  set +e
  (
    set -e
    "update_$platform"
  )
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    warn "$platform: FAILED (exit $status)"
    FAILED+=("$platform")
  fi
done

echo
if [[ -s "$SKIP_FILE" ]]; then
  warn "skipped:"
  sed 's/^/   - /' "$SKIP_FILE" >&2
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  warn "failed: ${FAILED[*]}"
  exit 1
fi
log "done — review 'git diff', then update docs/content/<platform>/stack.md"

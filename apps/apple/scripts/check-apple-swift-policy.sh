#!/usr/bin/env bash
# Static policy for apps/apple that needs no Swift toolchain (works on Windows/Linux with bash + grep + sed):
#   1. Swift 6 language mode everywhere: every Core/*, Features/*, App/Shared and Tuist Package.swift has
#      `swiftLanguageModes: [.v6]`; every package except Tuist enables the two verified upcoming features;
#      Config/Base.xcconfig and Project.swift set SWIFT_VERSION 6 + SWIFT_STRICT_CONCURRENCY complete.
#   2. Concurrency escape hatches: production sources (not Tests, not Generated) may use `@unchecked Sendable` /
#      `nonisolated(unsafe)` only in the files listed in ESCAPE_ALLOWLIST below, each of which carries a reason in
#      docs/content/decisions/apple.md; a new use needs a reason comment `// concurrency-ok: ...` on the same line.
#   3. connect-swift stack (decisions/apple.md: the grpc-swift-2 migration was reverted 2026-10-29): no gRPC runtime
#      imports or packages in sources or manifests; Core/AedstNetwork declares connect-swift and swift-protobuf;
#      buf.gen.yaml runs protoc-gen-connect-swift; the version floors in Package.swift are the ones the Library-First
#      and stack pages state.
#
#   scripts/check-apple-swift-policy.sh              check the real tree
#   scripts/check-apple-swift-policy.sh --self-test  the checker must FAIL on a deliberately bad tree and pass on a good one
#   scripts/check-apple-swift-policy.sh ROOT [DOCS]  check ROOT as if it were apps/apple (DOCS = docs/content directory)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

# Production files allowed to contain an unchecked escape hatch (reason: decisions/apple.md, "Swift 6 language mode").
ESCAPE_ALLOWLIST="Core/AedstMedia/Sources/AedstMedia/BackgroundUploader.swift
Core/AedstMedia/Sources/AedstMedia/ImageDownsampler.swift
App/iOS/Sources/OutboxBackgroundTask.swift"

run_checks() {
  local root="$1" docs="$2" status=0
  cd "$root"

  # 1. Swift 6 mode + upcoming features ------------------------------------------------------------------------------
  local manifest
  while IFS= read -r manifest; do
    if ! grep -q 'swiftLanguageModes: \[\.v6\]' "$manifest"; then
      echo "::error file=apps/apple/$manifest::missing 'swiftLanguageModes: [.v6]' (Swift 6 language mode for every package)"
      status=1
    fi
    if grep -qE 'swiftLanguageMode\(\.v5\)|swiftLanguageVersions|swift-tools-version: ?5' "$manifest"; then
      echo "::error file=apps/apple/$manifest::Swift 5 language mode or tools-version"
      status=1
    fi
    case "$manifest" in
      ./Tuist/Package.swift) ;;
      *)
        for feature in NonisolatedNonsendingByDefault InferIsolatedConformances; do
          if ! grep -q "enableUpcomingFeature(\"$feature\")" "$manifest"; then
            echo "::error file=apps/apple/$manifest::upcoming feature $feature is not enabled (verified in Swift 6.2/6.3, see decisions/apple.md)"
            status=1
          fi
        done ;;
    esac
  done < <(find . -name Package.swift -not -path '*/.build/*' -not -path '*/checkouts/*' -not -path '*/.swiftpm/*' -not -path '*/scripts/fixtures/*' | sort)

  if ! grep -qE '^SWIFT_VERSION *= *6$' Config/Base.xcconfig 2>/dev/null; then
    echo "::error file=apps/apple/Config/Base.xcconfig::SWIFT_VERSION must be 6"; status=1
  fi
  if ! grep -qE '^SWIFT_STRICT_CONCURRENCY *= *complete$' Config/Base.xcconfig 2>/dev/null; then
    echo "::error file=apps/apple/Config/Base.xcconfig::SWIFT_STRICT_CONCURRENCY must be complete"; status=1
  fi
  if ! grep -q '"SWIFT_VERSION": "6"' Project.swift 2>/dev/null || ! grep -q '"SWIFT_STRICT_CONCURRENCY": "complete"' Project.swift 2>/dev/null; then
    echo "::error file=apps/apple/Project.swift::project-level SWIFT_VERSION 6 / SWIFT_STRICT_CONCURRENCY complete missing (the UI-test target has no xcconfig)"
    status=1
  fi

  # 2. Concurrency escape hatches in production code -----------------------------------------------------------------
  local hit file
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file="${hit%%:*}"; file="${file#./}"
    case "$hit" in *'concurrency-ok:'*) continue ;; esac
    if ! printf '%s\n' "$ESCAPE_ALLOWLIST" | grep -qxF "$file"; then
      echo "::error file=apps/apple/$file::unchecked concurrency escape without '// concurrency-ok: reason' and not in the allowlist: ${hit#*:}"
      status=1
    fi
  done < <(grep -rnE '@unchecked Sendable|nonisolated\(unsafe\)' --include='*.swift' Core App Features 2>/dev/null |
    grep -vE '/(Tests|Generated|\.build)/|^(\./)?Core/AedstTesting/' || true)

  # 3. connect-swift stack ---------------------------------------------------------------------------------------------
  local leak
  leak="$(grep -rnE 'import (GRPCCore|GRPCProtobuf|GRPCNIOTransport[A-Za-z0-9]*|GRPCInProcessTransport)\b|grpc-swift|GRPCClientFactory' \
    --include='*.swift' --include='Package.swift' Core App Features Tuist 2>/dev/null |
    grep -vE '/(Generated|\.build)/' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' || true)"
  if [ -n "$leak" ]; then
    echo "::error::gRPC runtime leftovers (the Apple client stays on connect-swift, decisions/apple.md):"
    echo "$leak"
    status=1
  fi

  local net=Core/AedstNetwork/Package.swift url
  for url in connectrpc/connect-swift apple/swift-protobuf; do
    if ! grep -q "github.com/$url\"" "$net" 2>/dev/null; then
      echo "::error file=apps/apple/$net::missing dependency https://github.com/$url"
      status=1
    fi
  done
  if ! grep -q 'protoc-gen-connect-swift' buf.gen.yaml 2>/dev/null || grep -q 'protoc-gen-grpc-swift' buf.gen.yaml 2>/dev/null; then
    echo "::error file=apps/apple/buf.gen.yaml::must run protoc-gen-connect-swift and not protoc-gen-grpc-swift-2"
    status=1
  fi

  # Floors in Package.swift == versions stated in the docs (Library-First page and stack page).
  local pair name floor
  for pair in connectrpc/connect-swift apple/swift-protobuf; do
    name="${pair#*/}"
    floor="$(sed -nE "s|.*github\.com/$pair\", from: \"([0-9]+\.[0-9]+\.[0-9]+)\".*|\1|p" "$net" 2>/dev/null | head -n 1)"
    if [ -z "$floor" ]; then
      echo "::error file=apps/apple/$net::cannot read the 'from:' floor of $name"
      status=1
    elif [ -d "$docs" ]; then
      if ! grep -qF "$floor" "$docs/library-first/apple.md" || ! grep -qF "$floor" "$docs/apple/stack.md"; then
        echo "::error::$name floor $floor in $net is not stated in docs/content/library-first/apple.md and docs/content/apple/stack.md (update the docs in the same change)"
        status=1
      fi
    fi
  done

  return "$status"
}

self_test() {
  local tmp good bad failures=0
  tmp="$(mktemp -d)"
  good="$tmp/good"; bad="$tmp/bad"

  make_tree() { # dir
    local d="$1"
    mkdir -p "$d/Core/AedstNetwork" "$d/Config" "$d/Core/AedstCore/Sources" "$d/docs/library-first" "$d/docs/apple"
    cat >"$d/Core/AedstNetwork/Package.swift" <<'EOF'
// swift-tools-version: 6.0
import PackageDescription
let swiftSettings: [SwiftSetting] = [
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]
let package = Package(
    name: "AedstNetwork",
    dependencies: [
        .package(url: "https://github.com/connectrpc/connect-swift", from: "1.2.3"),
        .package(url: "https://github.com/apple/swift-protobuf", from: "1.39.0"),
    ],
    targets: [],
    swiftLanguageModes: [.v6]
)
EOF
    printf 'SWIFT_VERSION = 6\nSWIFT_STRICT_CONCURRENCY = complete\n' >"$d/Config/Base.xcconfig"
    printf '"SWIFT_VERSION": "6", "SWIFT_STRICT_CONCURRENCY": "complete"\n' >"$d/Project.swift"
    printf 'plugins:\n  - local: protoc-gen-connect-swift\n' >"$d/buf.gen.yaml"
    printf '1.2.3 1.39.0\n' >"$d/docs/library-first/apple.md"
    printf '1.2.3 1.39.0\n' >"$d/docs/apple/stack.md"
    printf 'public struct Fine: Sendable {}\n' >"$d/Core/AedstCore/Sources/Fine.swift"
  }

  make_tree "$good"
  if ! (run_checks "$good" "$good/docs") >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: the good tree was rejected"; failures=1
  fi

  expect_fail() { # description, mutation command run inside the bad tree
    rm -rf "$bad"; make_tree "$bad"
    (cd "$bad" && eval "$2")
    if (run_checks "$bad" "$bad/docs") >/dev/null 2>&1; then
      echo "SELF-TEST FAIL: not rejected: $1"; failures=1
    fi
  }
  expect_fail "package without swiftLanguageModes" "sed -i.bak 's/swiftLanguageModes: \[.v6\]/swiftLanguageModes: [.v5]/' Core/AedstNetwork/Package.swift"
  expect_fail "missing upcoming feature" "sed -i.bak '/InferIsolatedConformances/d' Core/AedstNetwork/Package.swift"
  expect_fail "xcconfig not Swift 6" "sed -i.bak 's/SWIFT_VERSION = 6/SWIFT_VERSION = 5/' Config/Base.xcconfig"
  expect_fail "unchecked Sendable in production" "printf 'final class Leaky: @unchecked Sendable {}\n' >Core/AedstCore/Sources/Leaky.swift"
  expect_fail "import GRPCCore leftover" "printf 'import GRPCCore\n' >Core/AedstCore/Sources/Old.swift"
  expect_fail "grpc plugin in buf.gen.yaml" "printf '  - local: protoc-gen-grpc-swift-2\n' >>buf.gen.yaml"
  expect_fail "connect-swift dependency missing" "sed -i.bak '/connect-swift/d' Core/AedstNetwork/Package.swift"
  expect_fail "doc version drift" "printf 'nothing\n' >docs/apple/stack.md"
  # An annotated escape hatch is accepted.
  rm -rf "$bad"; make_tree "$bad"
  printf 'final class Ok: @unchecked Sendable {} // concurrency-ok: guarded by a lock\n' >"$bad/Core/AedstCore/Sources/Ok.swift"
  if ! (run_checks "$bad" "$bad/docs") >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an annotated escape hatch was rejected"; failures=1
  fi

  rm -rf "$tmp"
  if [ "$failures" -eq 0 ]; then
    echo "OK self-test: check-apple-swift-policy rejects every bad tree and accepts the good one."
  else
    echo "FAIL self-test"
  fi
  return "$failures"
}

case "${1:-}" in
  --self-test) self_test ;;
  "")
    run_checks "$here/.." "$here/../../../docs/content"
    echo "OK: Swift 6 settings, concurrency escape hatches and the connect-swift stack match the policy."
    ;;
  *) run_checks "$1" "${2:-}" ;;
esac

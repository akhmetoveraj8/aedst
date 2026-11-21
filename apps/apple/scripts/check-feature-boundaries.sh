#!/usr/bin/env bash
# Fails if any apps/apple/Features/<Name>/Package.swift declares a local
# package dependency on another Features/* package. See "The boundary rule,
# translated" in docs/content/apple/architecture.md — Features/* may depend on
# Core/*, never on another Features/* package. Then runs check-feature-layers.sh
# (layers inside a feature) and the other static policy scripts.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

for package_file in Features/*/Package.swift; do
  feature_name=$(basename "$(dirname "$package_file")")

  # .package(path: "../../Features/<Other>") references, excluding self-reference.
  violations=$(grep -oE '\.package\(path: *"[^"]*Features/[A-Za-z0-9_-]+"\)' "$package_file" \
    | grep -v "Features/${feature_name}\"" || true)

  if [ -n "$violations" ]; then
    echo "::error file=$package_file::Features/$feature_name depends on another feature package:"
    echo "$violations"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "OK: no feature package depends on another feature package."
fi


# Layer rules inside each feature package ("One business logic, two UI builds"): Domain is plain Swift, the two UI
# targets never import Data or the other platform's toolkit, every UI file is one whole-file platform guard.
bash scripts/check-feature-layers.sh || status=1
bash scripts/check-feature-layers.sh --self-test || status=1

# The remaining repo-policy checks ride on this entry point (CI and `task boundaries` both
# call it): no color literals outside the generated tokens, the file-size policy, the approved-package list,
# confinement of Keychain / web-auth APIs, the library-first custom rules (static mirror of SwiftLint), and the
# Swift 6 / concurrency-escape / connect-swift-stack policy (check-apple-swift-policy.sh).
bash scripts/check-color-literals.sh || status=1
bash scripts/check-file-size.sh || status=1
bash scripts/check-dependencies.sh || status=1
bash scripts/check-apple-sensitive-apis.sh || status=1
bash scripts/check-swiftlint-rules-static.sh || status=1
bash scripts/check-plist-locales.sh || status=1
bash scripts/check-apple-swift-policy.sh || status=1
bash scripts/check-apple-swift-policy.sh --self-test || status=1

exit "$status"

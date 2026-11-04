#!/usr/bin/env bash
# Module-boundary gates for apps/android (docs/content/android/architecture.md, "The boundary rule"):
#
#   1. feature/<a> never depends on feature/<b> (Gradle project dependency).
#   2. core/* never depends on any feature/* (Gradle project dependency).
#   3. app*/ and core/* never import a feature's internals (`com.aedst.feature.<x>.(domain|data|presentation)`); the
#      app reaches a feature only through its `navigation` package (*NavGraph and the few shell composables there).
#   4. Visibility: inside a feature, Screen / ViewModel / Repository / Module classes and interfaces are `internal`
#      (or private); the public surface is the NavGraph and a Route composable that is not exposing them.
#
# Usage: check-feature-boundaries.sh   (run from anywhere; scripts/test-gates.sh seeds a violation per rule)
set -euo pipefail

cd "$(dirname "$0")/.."

status=0
fail() {
  echo "::error file=$1::$2"
  status=1
}

# 1. feature -> other feature.
for gradle_file in feature/*/build.gradle.kts; do
  feature_name=$(basename "$(dirname "$gradle_file")")
  violations=$(grep -oE 'project\(":feature:[a-zA-Z0-9_-]+"\)' "$gradle_file" \
    | grep -v "\":feature:${feature_name}\"" || true)
  if [ -n "$violations" ]; then
    fail "$gradle_file" "feature/$feature_name depends on another feature module: $violations"
  fi
done

# 2. core -> feature.
for gradle_file in core/*/build.gradle.kts; do
  violations=$(grep -oE 'project\(":feature:[a-zA-Z0-9_-]+"\)' "$gradle_file" || true)
  if [ -n "$violations" ]; then
    fail "$gradle_file" "$(dirname "$gradle_file") depends on a feature module (core must not know features): $violations"
  fi
done

# 3. app / core importing a feature's internals (one recursive grep: per-file loops are very slow in Git Bash).
hits=$(grep -rnE --include='*.kt' --exclude-dir=build '^import com\.aedst\.feature\.[a-z]+\.(domain|data|presentation)\b' app app-tv core 2>/dev/null || true)
if [ -n "$hits" ]; then
  fail "app/core" "Imports a feature's internals (only its navigation package is public API):"
  echo "$hits"
fi

# 4. Visibility of feature internals. A top-level declaration named *Screen / *ViewModel / *Repository / *RepositoryImpl
# / *Module that carries no `internal` or `private` modifier is public.
hits=$(grep -rnE --include='*.kt' --exclude-dir=build '^(abstract |open |data |sealed |final |fun )*(class|interface|object) [A-Za-z0-9]*(Screen|ViewModel|Repository|RepositoryImpl|Module)\b' feature/*/src/main 2>/dev/null \
  | grep -vE ':[0-9]+:(internal|private) ' || true)
if [ -n "$hits" ]; then
  fail "feature" "Public Screen/ViewModel/Repository/Module type in a feature; mark it internal (public API is *NavGraph and *Route only):"
  echo "$hits"
fi

if [ "$status" -eq 0 ]; then
  echo "OK: feature/core module boundaries hold and feature internals are internal."
fi

exit "$status"

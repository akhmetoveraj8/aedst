#!/usr/bin/env bash
# Module-boundary gates for apps/android (docs/content/android/architecture.md, "The boundary rule"):
#
#   1. feature/<a> never depends on feature/<b> (Gradle project dependency).
#   2. core/* never depends on any feature/* (Gradle project dependency).
#   3. app*/ and core/* never import a feature's internals (`com.aedst.feature.<x>.(domain|data|presentation)`); the
#      app reaches a feature only through its `navigation` package (*NavGraph and the few shell composables there).
#   4. Visibility: inside a feature, Screen / ViewModel / Repository / Module classes and interfaces are `internal`
#      (or private); the public surface is the NavGraph and a Route composable that is not exposing them.
#   5. A feature's domain is its own Kotlin Multiplatform module, `feature/<a>/domain` (docs/content/android/kmp.md):
#      a. only `feature/<a>` depends on `:feature:<a>:domain`;
#      b. a domain module depends on multiplatform modules only (those applying `kmp.library.convention`), never on
#         an Android module or a feature;
#      c. `feature/*/domain` sources import nothing Android or JVM-only (`android.*`, `androidx.*`, `java.*`,
#         `javax.*`, `dagger.*`, OkHttp, Connect, protobuf) and nothing from the feature's data / presentation /
#         navigation packages;
#      d. `commonMain` of any module imports no `android.*`, `java.*`, `javax.*` or `dagger.*` (it must compile for
#         a non-JVM target the day one is added).
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
  violations=$(grep -oE 'project\(":feature:[a-zA-Z0-9_:-]+"\)' "$gradle_file" \
    | grep -vE "\":feature:${feature_name}(:domain)?\"" || true)
  if [ -n "$violations" ]; then
    fail "$gradle_file" "feature/$feature_name depends on another feature module: $violations"
  fi
done

# 2. core -> feature.
for gradle_file in core/*/build.gradle.kts; do
  violations=$(grep -oE 'project\(":feature:[a-zA-Z0-9_:-]+"\)' "$gradle_file" || true)
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

# 5a. Only feature/<a> may depend on :feature:<a>:domain.
for gradle_file in app/build.gradle.kts app-tv/build.gradle.kts benchmark/build.gradle.kts; do
  [ -f "$gradle_file" ] || continue
  violations=$(grep -oE 'project\(":feature:[a-zA-Z0-9_-]+:domain"\)' "$gradle_file" || true)
  if [ -n "$violations" ]; then
    fail "$gradle_file" "Depends on a feature's domain module (only the feature itself may; the app reaches a feature through its navigation package): $violations"
  fi
done

# 5b. A domain module depends on multiplatform modules only.
for gradle_file in feature/*/domain/build.gradle.kts; do
  [ -f "$gradle_file" ] || continue
  if ! grep -q 'kmp\.library\.convention' "$gradle_file"; then
    fail "$gradle_file" "A feature domain module must apply libs.plugins.kmp.library.convention (common code, no Android plugin)."
  fi
  while IFS= read -r dependency; do
    [ -n "$dependency" ] || continue
    dependency_dir=$(sed -E 's/^project\(":(.*)"\)$/\1/; s|:|/|g' <<< "$dependency")
    if ! grep -qs 'kmp\.library\.convention' "$dependency_dir/build.gradle.kts"; then
      fail "$gradle_file" "Domain module depends on $dependency, which is not a multiplatform module (allowed: modules applying kmp.library.convention, e.g. :core:common)."
    fi
  done < <(grep -oE 'project\(":[a-zA-Z0-9_:-]+"\)' "$gradle_file" || true)
done

# 5c. Domain sources: nothing Android, nothing JVM-only, nothing from the feature's outer layers.
hits=$(grep -rnE --include='*.kt' --exclude-dir=build '^import (android|androidx|java|javax|dagger|okhttp3|com\.connectrpc|com\.google\.protobuf)\.' feature/*/domain/src 2>/dev/null || true)
if [ -n "$hits" ]; then
  fail "feature/*/domain" "Platform import in a feature domain module (the domain is common code: kotlin.*, kotlinx.coroutines and core/common only):"
  echo "$hits"
fi
hits=$(grep -rnE --include='*.kt' --exclude-dir=build '^import com\.aedst\.feature\.[a-z]+\.(data|presentation|navigation)\b' feature/*/domain/src 2>/dev/null || true)
if [ -n "$hits" ]; then
  fail "feature/*/domain" "A feature domain module imports the feature's data / presentation / navigation layer (the dependency points the other way):"
  echo "$hits"
fi

# 5d. commonMain of every module stays free of Android and JVM-only APIs.
hits=$(grep -rnE --include='*.kt' --exclude-dir=build '^import (android|java|javax|dagger)\.' core/*/src/commonMain feature/*/domain/src/commonMain 2>/dev/null || true)
if [ -n "$hits" ]; then
  fail "commonMain" "Android or JVM-only import in commonMain (move the code to androidMain / jvmMain, or use the kotlin.* equivalent):"
  echo "$hits"
fi

if [ "$status" -eq 0 ]; then
  echo "OK: feature/core module boundaries hold, feature internals are internal and domain modules are common code."
fi

exit "$status"

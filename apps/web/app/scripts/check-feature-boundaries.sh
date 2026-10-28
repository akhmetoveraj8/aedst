#!/usr/bin/env bash
# Feature-module boundaries for apps/web (microfrontend-ready layout, see
# docs/content/web/microfrontends.md). Fails when:
#
#  1. a file under src/modules/<a>/** imports src/modules/<b>/** (modules talk
#     only through src/shared/**, the registry in src/app, or the network);
#  2. code outside src/modules (src/app, src/shared, src/test, ...) imports
#     anything of a module except its `public` surface, its `manifest`, its
#     single-export `entries/*` (what pages import, so a barrel does not drag
#     every client chunk of the module into the route) or its client-safe
#     `outbox` entry (offline-outbox handlers)
#     (type-only i18n catalogue imports in messages.d.ts / test/render.tsx
#     are the one exception); src/shared must not import modules at all;
#  3. a module lacks `manifest.ts` or `public.ts`, its manifest `id` differs
#     from its folder, its manifest imports anything but `@/shared/**`, or the
#     registry (src/app/config/modules/registry.ts) does not list it;
#  4. a `useFeatureFlag("x")` in a module is missing from that manifest's
#     `featureFlags`.
#  5. a file under src/modules/** or src/shared/** imports src/app/** (`@/app/`,
#     `@app/` or a relative path into app/): the dependency direction is
#     app -> modules -> shared, never upwards (shared i18n routing lives in
#     src/shared/i18n).
#
# AEDST_WEB_ROOT points the checks at another tree: `pnpm check:selftest`
# runs them against deliberately broken fixtures and requires a failure.
#
# Mirrors the feature-boundary checks on Android/Apple/Desktop:
#   apps/android/scripts/check-feature-boundaries.sh
#   apps/apple/scripts/check-feature-boundaries.sh
#   apps/desktop/scripts/check-feature-boundaries.sh
set -euo pipefail

cd "${AEDST_WEB_ROOT:-$(dirname "$0")/..}"

status=0
fail() { # file line message
  echo "::error file=$1,line=$2::$3"
  status=1
}

# Matches `from "..."` and `import("...")` of an @/modules or relative
# modules/ specifier; prints "file:line:specifier-without-quote".
module_imports() {
  grep -rnoE "(from[[:space:]]+|import\()[\"'](@/modules/[A-Za-z0-9_./-]+|(\.\./)+modules/[A-Za-z0-9_./-]+)" \
    --include="*.ts" --include="*.tsx" "$@" 2>/dev/null \
    | sed -E "s#^([^:]+):([0-9]+):(from[[:space:]]+|import\()[\"']#\1:\2:#" \
    || true
}

# --- 1. module -> other module -------------------------------------------
for module_dir in src/modules/*/; do
  module_name=$(basename "$module_dir")
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    file="${hit%%:*}"
    rest="${hit#*:}"
    line_no="${rest%%:*}"
    target="${rest#*:}"
    imported="${target##*modules/}"
    imported_module="${imported%%/*}"
    if [ "$imported_module" != "$module_name" ]; then
      fail "$file" "$line_no" "src/modules/$module_name imports from another feature module: $target (use src/shared, the registry or an RPC)"
    fi
  done < <(module_imports "$module_dir")
done

# --- 2. outside -> module internals ---------------------------------------
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  line_no="${rest%%:*}"
  target="${rest#*:}"
  case "$file" in src/modules/*) continue ;; esac
  case "$file" in
    ../shared/*)
      fail "$file" "$line_no" "../shared must not depend on feature modules: $target"
      continue
      ;;
  esac
  sub="${target#*modules/}"   # e.g. tasks/public, tasks/ui/X, tasks/i18n/en.json
  sub="${sub#*/}"
  case "$sub" in
    public|manifest|outbox|entries/*) ;;
    i18n/*.json)
      case "$file" in
        src/test/*|src/app/config/i18n/messages.d.ts) ;;
        *) fail "$file" "$line_no" "only src/test and messages.d.ts may import module catalogues: $target" ;;
      esac
      ;;
    *) fail "$file" "$line_no" "import a module only through its public.ts or manifest.ts, not: $target" ;;
  esac
done < <(module_imports src e2e)

# --- 5. modules/shared -> app (upward import) ------------------------------
# `import "..."`, `from "..."`, `import("...")` and `vi.mock("...")` of @/app/,
# @app/ or a relative path into app/.
app_import_re='(from[[:space:]]+|import[[:space:]]*\(?|vi\.mock\()["'"'"'](@/app/|@app/|(\.\./)+app/)[^"'"'"']*'
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  fail "$file" "${rest%%:*}" "src/modules and src/shared must not import src/app (${rest#*:}); move the shared code into src/shared"
done < <(grep -rnoE "$app_import_re" --include="*.ts" --include="*.tsx" src/modules ../shared 2>/dev/null || true)

# --- 3. manifest + public + registry --------------------------------------
registry=src/app/config/modules/registry.ts
for module_dir in src/modules/*/; do
  module_name=$(basename "$module_dir")
  manifest="$module_dir""manifest.ts"
  for required in manifest.ts public.ts; do
    if [ ! -f "$module_dir$required" ]; then
      fail "${module_dir%/}" 1 "src/modules/$module_name is missing $required"
    fi
  done
  [ -f "$manifest" ] || continue

  declared_id=$(sed -nE 's/^[[:space:]]*id:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)
  if [ "$declared_id" != "$module_name" ]; then
    fail "$manifest" 1 "manifest id \"$declared_id\" must equal the folder name \"$module_name\""
  fi

  while IFS=: read -r line_no spec; do
    case "$spec" in
      @/shared/*) ;;
      *) fail "$manifest" "$line_no" "manifest.ts is UI-free data and may import only @/shared/**, not: $spec" ;;
    esac
  done < <(grep -nE "^(import|export)[^\"']* from " "$manifest" | grep -v "^[0-9]*:import type" \
    | sed -E "s#^([0-9]+):.* from [\"']([^\"']+)[\"'].*#\1:\2#" || true)
  if grep -nE "^import[[:space:]]+[\"']" "$manifest" >/dev/null; then
    fail "$manifest" 1 "manifest.ts must not have side-effect imports"
  fi

  if ! grep -q "@/modules/$module_name/manifest" "$registry"; then
    fail "$registry" 1 "module \"$module_name\" is not listed in the registry"
  fi
done

# --- 4. feature flags declared in the manifest -----------------------------
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  line_no="${rest%%:*}"
  flag="${rest#*:}"
  module_name=$(echo "$file" | cut -d/ -f3)
  if ! grep -qE "featureFlags:[[:space:]]*\[[^]]*\"$flag\"" "src/modules/$module_name/manifest.ts" 2>/dev/null; then
    fail "$file" "$line_no" "feature flag \"$flag\" is not listed in src/modules/$module_name/manifest.ts featureFlags"
  fi
done < <(grep -rnoE "useFeatureFlag\(\"[^\"]+\"" --include="*.ts" --include="*.tsx" src/modules 2>/dev/null \
  | sed -E 's#^([^:]+):([0-9]+):useFeatureFlag\("(.*)"#\1:\2:\3#' || true)

if [ "$status" -eq 0 ]; then
  echo "OK: module boundaries hold (no cross-module imports; outside code uses public.ts/manifest.ts only; manifests valid and registered)."
fi

exit "$status"

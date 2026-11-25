#!/usr/bin/env bash
# Module and feature boundaries for one web project (app, admin or marketing;
# layout: docs/content/architecture/modules-and-features.md and
# docs/content/web/microfrontends.md). Hosted by the app project and run for
# every project: `check-feature-boundaries.sh [project-dir]` (default: the app
# project; each project's `pnpm check:feature-boundaries` passes its own
# directory, scripts/check-boundaries.sh runs all three). This script is the
# boundary gate; import cycles are Biome's noImportCycles and unused files are
# knip's (docs/content/decisions/web.md).
# Fails when:
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
#  6. a file under src/modules/<m>/features/<a>/** imports
#     src/modules/<m>/features/<b>/** (a feature never imports another
#     feature; shared code moves to the module's own lib/ or ui/);
#  7. a module's shared code (any folder of the module except features/ and
#     entries/, e.g. lib/, ui/) imports one of its features. Only the
#     composition level may: entries/*, public.ts, outbox.ts and tests that
#     sit in the module root;
#  8. a feature folder holds anything but `ui/` and `lib/`
#     (src/modules/<m>/features/<feature>/{ui,lib}), or a file sits directly
#     under features/;
#  9. a project file imports another web project by path (../app, ../admin,
#     ../marketing): projects meet only in ../shared and over the network.
#
# Rules 6 and 7 (and rule 1 for relative specifiers) resolve `./` and `../`
# imports, so a relative path cannot bypass them.
#
# AEDST_WEB_ROOT (or the first argument) points the checks at another tree: `pnpm check:selftest`
# runs them against deliberately broken fixtures and requires a failure.
#
# Mirrors the feature-boundary checks on Android/Apple/Desktop:
#   apps/android/scripts/check-feature-boundaries.sh
#   apps/apple/scripts/check-feature-boundaries.sh
#   a desktop boundaries script (not written yet)
set -euo pipefail

cd "${1:-${AEDST_WEB_ROOT:-$(dirname "$0")/..}}"

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
done < <(module_imports src e2e server ../shared)

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

# --- 6, 7. features: no feature -> feature, no module shared -> feature ----
# Collapses "." and ".." segments of a path (pure bash, no realpath -m).
normalize_path() {
  local IFS=/ part out=() last
  for part in $1; do
    case "$part" in
      "" | .) ;;
      ..)
        last=$((${#out[@]} - 1))
        if [ "$last" -ge 0 ] && [ "${out[$last]}" != ".." ]; then
          unset "out[$last]"
          out=("${out[@]}")
        else
          out+=(..)
        fi
        ;;
      *) out+=("$part") ;;
    esac
  done
  echo "${out[*]}"
}

import_re='(from[[:space:]]+|import[[:space:]]*\(?[[:space:]]*|vi\.mock\()["'"'"']'
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  line_no="${rest%%:*}"
  spec="${rest#*:}"
  case "$spec" in
    @/modules/*) target="src/modules/${spec#@/modules/}" ;;
    *) target=$(normalize_path "$(dirname "$file")/$spec") ;;
  esac
  case "$target" in src/modules/*/*) ;; *) continue ;; esac
  from="${file#src/modules/}" # <module>/features/<feature>/ui/x.tsx
  to="${target#src/modules/}"
  from_module="${from%%/*}"
  to_module="${to%%/*}"
  if [ "$from_module" != "$to_module" ]; then
    # Alias imports are reported by rule 1; this catches the relative form.
    case "$spec" in
      .*) fail "$file" "$line_no" "src/modules/$from_module imports from another feature module by a relative path: $spec" ;;
    esac
    continue
  fi
  from_in="${from#*/}" # features/<feature>/ui/x.tsx | lib/x.ts | public.ts
  to_in="${to#*/}"
  case "$to_in" in features/*/*) ;; *) continue ;; esac
  to_feature="${to_in#features/}"
  to_feature="${to_feature%%/*}"
  case "$from_in" in
    features/*/*)
      from_feature="${from_in#features/}"
      from_feature="${from_feature%%/*}"
      if [ "$from_feature" != "$to_feature" ]; then
        fail "$file" "$line_no" "feature $from_module/$from_feature imports another feature ($from_module/$to_feature): $spec (move the shared code to src/modules/$from_module/lib or ui)"
      fi
      ;;
    entries/*) ;;
    */*) fail "$file" "$line_no" "module shared code must not import a feature: $spec (only entries/, public.ts, outbox.ts and module-root tests compose features)" ;;
  esac
done < <(grep -rnoE "$import_re"'(@/modules/|\.\.?/)[^"'"'"']+' \
  --include="*.ts" --include="*.tsx" src/modules 2>/dev/null \
  | sed -E "s#^([^:]+):([0-9]+):$import_re#\1:\2:#" \
  || true)

# --- 8. feature folder shape: features/<feature>/{ui,lib} ------------------
for entry in src/modules/*/features/*; do
  [ -e "$entry" ] || continue
  if [ ! -d "$entry" ]; then
    fail "$entry" 1 "features/ holds only feature folders; move this file into features/<feature>/{ui,lib} or the module's lib/ or ui/"
    continue
  fi
  for child in "$entry"/*; do
    [ -e "$child" ] || continue
    case "$(basename "$child")" in
      ui | lib) [ -d "$child" ] || fail "$child" 1 "a feature holds only the folders ui/ and lib/" ;;
      *) fail "$child" 1 "a feature holds only the folders ui/ and lib/ (src/modules/<module>/features/<feature>/{ui,lib})" ;;
    esac
  done
done

# --- 9. project -> other web project ---------------------------------------
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  fail "$file" "${rest%%:*}" "a web project never imports another project (${rest#*:}); share code through ../shared"
done < <(grep -rnoE "$import_re"'(\.\./)+(app|admin|marketing)/(src|server)/[^"'"'"']*' \
  --include="*.ts" --include="*.tsx" src server 2>/dev/null || true)

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
  echo "OK: module boundaries hold in $(basename "$PWD") (no cross-module or cross-feature imports; module shared code imports no feature; outside code uses public.ts, manifest.ts and entries only; manifests valid and registered)."
fi

exit "$status"

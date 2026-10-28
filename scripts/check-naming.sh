#!/usr/bin/env bash
# Checks file/resource naming conventions that per-platform linters don't cover
# (file names, directories) — see /CONVENTIONS.md for the full standard.
#
# Usage:
#   ./scripts/check-naming.sh            # check all tracked files
#   ./scripts/check-naming.sh --staged   # check only staged files (pre-commit)
#   ./scripts/check-naming.sh --stdin    # check the paths on stdin (used by apps/web `pnpm check:selftest`)
set -euo pipefail

fail=0
warn() { echo "WARNING: $*"; }
err()  { echo "ERROR: $*"; fail=1; }

if [[ "${1:-}" == "--staged" ]]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
elif [[ "${1:-}" == "--stdin" ]]; then
  files=$(cat)
else
  files=$(git ls-files)
fi

kebab='^[a-z0-9]+(-[a-z0-9]+)*$'
pascal='^[A-Z][a-zA-Z0-9]*$'
snake='^[a-z0-9]+(_[a-z0-9]+)*$'

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ -f "$f" ]] || continue  # skip files deleted-but-not-yet-committed
  base=$(basename -- "$f")
  name="${base%.*}"
  name="${name%.d}" # `foo.d.ts` declaration files: the stem is `foo`
  case "$f" in apps/web/*) name="${name%.test}"; name="${name%.spec}"; name="${name%.contract}" ;; esac # `foo.contract.test.ts`: the stem is `foo`

  case "$f" in
    # --- Generated code: naming is owned by the generator, not us ---
    apps/server/gen/*)
      ;;

    # --- Web (apps/web: shared, app, admin, landing) ---
    apps/web/shared/ui/*)
      ;; # shadcn/ui-generated primitives: documented kebab-case exception
    apps/web/*/src/app/*/page.tsx|apps/web/*/src/app/*/layout.tsx|apps/web/*/src/app/*/loading.tsx|apps/web/*/src/app/*/error.tsx|apps/web/*/src/app/*/not-found.tsx|apps/web/*/src/app/*/route.ts|apps/web/*/src/app/*/global-error.tsx)
      ;; # Next.js framework-mandated literal file names
    apps/web/*/src/test/*)
      ;; # test helpers (render.tsx, mocks): not part of the app's naming surface
    apps/web/shared/*.tsx|apps/web/app/src/*.tsx|apps/web/admin/src/*.tsx|apps/web/landing/src/*.tsx)
      # Every React file outside shared/ui: PascalCase, name = the exported component.
      # Framework names (page, layout, opengraph-image, ...) are fixed by Next.js. A
      # <name>.test.tsx / <name>.stories.tsx follows its subject; a kebab-case test is
      # fine only when its subject is a plain .ts file next to it.
      stem="${base%%.*}"
      case "$stem" in
        page|layout|loading|error|not-found|global-error|route|template|default|opengraph-image|twitter-image|icon|apple-icon) ;;
        *)
          if [[ "$stem" =~ $pascal ]]; then
            :
          elif [[ "$base" == *.test.tsx && "$stem" =~ $kebab && -f "${f%/*}/$stem.ts" ]]; then
            :
          else
            err "$f: React file must be PascalCase.tsx (component name = file name); framework files keep Next.js names"
          fi
          ;;
      esac
      ;;
    apps/web/shared/*.ts|apps/web/app/src/*.ts|apps/web/admin/src/*.ts|apps/web/landing/src/*.ts)
      stem="${base%%.*}" # foo.browser.test.ts, foo.d.ts: the stem is `foo`
      [[ "$stem" =~ $kebab ]] || err "$f: utility file must be kebab-case.ts"
      ;;

    # --- Server (apps/server, Go) ---
    apps/server/*.go)
      [[ "$name" =~ $snake ]] || err "$f: Go file must be snake_case.go (or one lowercase word)"
      ;;

    # --- Android (apps/android, Kotlin) ---
    apps/android/*.kt)
      [[ "$name" =~ $pascal ]] || err "$f: Kotlin file must be PascalCase.kt"
      ;;
    apps/android/*/res/*.xml)
      [[ "$name" =~ $snake ]] || err "$f: Android resource must be snake_case"
      ;;

    # --- Apple (apps/apple, Swift) ---
    apps/apple/*.swift)
      [[ "$name" =~ ^[A-Z][a-zA-Z0-9]*(\+[A-Z][a-zA-Z0-9]*)?$ ]] || err "$f: Swift file must be PascalCase.swift (Type+Extension.swift allowed)"
      ;;

    # --- Desktop (apps/desktop, C++/Qt) ---
    apps/desktop/*.cpp|apps/desktop/*.hpp|apps/desktop/*.h)
      [[ "$name" =~ $snake ]] || err "$f: C++ file must be snake_case.cpp/.hpp/.h (see CONVENTIONS.md)"
      ;;
    apps/desktop/*.ui)
      [[ "$name" =~ $snake ]] || err "$f: Qt .ui file must be snake_case"
      ;;
  esac
done <<< "$files"

if [[ $fail -ne 0 ]]; then
  echo ""
  echo "Naming check failed. See CONVENTIONS.md for the standard." >&2
  exit 1
fi
echo "Naming check passed."

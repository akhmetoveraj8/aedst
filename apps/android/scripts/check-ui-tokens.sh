#!/usr/bin/env bash
# UI token and screen-structure gates for hand-written Compose code (docs/content/ui-kit.md, library-first/android.md).
#
#   1. No raw `<number>.dp` outside core/ui: spacing is AedstSpacing.*, sizes that are not spacing steps carry an
#      inline `// allow-dp: <reason>` marker on the same line.
#   2. No `RoundedCornerShape(` outside core/ui: shapes are AedstShapesScale.* (or `// allow-shape: <reason>`).
#   3. No `Text("Literal")` outside @Preview code: user-facing strings come from string resources (5 locales).
#   4. Every *Screen.kt has a preview: @AedstWindowSizePreviews or @Preview in the file itself, or in a sibling
#      *Preview*.kt file in the same directory that calls the screen by name.
#
# core/ui (the design system) and the generated theme files are the only places allowed to define raw values. Tests,
# androidTest, sharedTest and build output are not scanned.
#
# Usage: check-ui-tokens.sh [root ...]   (default: app app-tv core feature; arguments exist for scripts/test-gates.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

roots=("$@")
[ "${#roots[@]}" -eq 0 ] && roots=(app app-tv core feature)

status=0
fail() {
  echo "::error file=apps/android/$1::$2"
  status=1
}

mapfile -t files < <(find "${roots[@]}" -name '*.kt' -type f \
  -not -path '*/build/*' -not -path '*/kotlin-gen/*' \
  -not -path '*/src/test/*' -not -path '*/src/androidTest/*' -not -path '*/src/sharedTest/*' 2>/dev/null | sort)

# The design system and generated theme files may define raw values: scan everything except core/ui (and any file
# whose first lines say GENERATED).
mapfile -t token_files < <(printf '%s\n' "${files[@]}" | grep -v '^core/ui/' || true)

# 1 + 2: raw dp and shapes outside the design system. One grep over all files (per-file loops are very slow in Git Bash).
hits=$(printf '%s\0' "${token_files[@]}" | xargs -0 grep -nE '[0-9]\.dp\b' 2>/dev/null | grep -v 'allow-dp:' || true)
if [ -n "$hits" ]; then
  fail "ui" "Raw .dp outside core/ui; use AedstSpacing.* (or add '// allow-dp: <reason>' for a size that is not a spacing step):"
  echo "$hits"
fi
hits=$(printf '%s\0' "${token_files[@]}" | xargs -0 grep -nE 'RoundedCornerShape\(' 2>/dev/null | grep -v 'allow-shape:' || true)
if [ -n "$hits" ]; then
  fail "ui" "RoundedCornerShape outside core/ui; use AedstShapesScale.* (or add '// allow-shape: <reason>'):"
  echo "$hits"
fi

# 3: literal Text("...") outside preview code. A top-level declaration block counts as preview code when its
# annotations include @Preview / @AedstWindowSizePreviews or its name contains "Preview"; files named *Preview*.kt
# are preview files. awk tracks the current top-level block (a line starting in column 0 with an annotation or fun).
hits=$(printf '%s\n' "${files[@]}" | grep -v 'Preview[A-Za-z]*\.kt$' | tr '\n' '\0' | xargs -0 awk '
  FNR == 1 { in_preview = 0; pending_preview = 0 }
  /^@/ { if ($0 ~ /^@(Preview|AedstWindowSizePreviews)/) pending_preview = 1; next }
  /^(private |internal |public )?(inline )?fun / { in_preview = pending_preview || ($0 ~ /Preview/); pending_preview = 0 }
  /^(class|object|interface|data class|sealed|enum|val|private val|internal val|const|private const|annotation)/ { in_preview = 0; pending_preview = 0 }
  !in_preview && /Text\("[A-Za-z]/ { print FILENAME ":" FNR ": " $0 }
' || true)
if [ -n "$hits" ]; then
  fail "ui" "Literal Text(\"...\") outside @Preview; use stringResource(R.string.*) in all five locales:"
  echo "$hits"
fi

# 4: a preview for every screen.
for file in "${files[@]}"; do
  case "$file" in *Screen.kt) ;; *) continue ;; esac
  screen="$(basename "$file" .kt)"
  dir="$(dirname "$file")"
  if grep -qE '@AedstWindowSizePreviews|@Preview' "$file"; then continue; fi
  found=0
  for sibling in "$dir"/*Preview*.kt; do
    [ -f "$sibling" ] || continue
    if grep -qE '@AedstWindowSizePreviews|@Preview' "$sibling" && grep -qF "${screen}(" "$sibling"; then found=1; fi
  done
  if [ "$found" -eq 0 ]; then
    fail "$file" "$screen has no preview: add @AedstWindowSizePreviews (core/ui adaptive) or @Preview to this file, or a sibling *Preview*.kt that calls ${screen}(."
  fi
done

if [ "$status" -eq 0 ]; then
  echo "OK: no raw dp / RoundedCornerShape / literal Text outside core/ui, and every *Screen.kt has a preview."
fi
exit "$status"

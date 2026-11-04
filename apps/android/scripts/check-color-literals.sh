#!/usr/bin/env bash
# Fails when a hand-written Kotlin file builds a Compose Color from a hex literal (Color(0xFF...)). Colors come from the
# design tokens: core/ui/theme/Aedst{Light,Dark}Palette.kt are GENERATED from packages/design-tokens (first line says
# "GENERATED") and are the only files allowed to contain literals; everything else reads MaterialTheme.colorScheme or
# the palette objects (success/warning/info/... exist there).
set -euo pipefail

cd "$(dirname "$0")/.."

status=0
while IFS= read -r file; do
  case "$file" in */build/*|*/kotlin-gen/*) continue ;; esac
  if head -n 3 "$file" | grep -q 'GENERATED'; then continue; fi
  hits=$(grep -nE 'Color\(\s*0[xX][0-9a-fA-F]+' "$file" || true)
  if [ -n "$hits" ]; then
    echo "::error file=apps/android/$file::Color literal outside the generated theme files; use theme tokens:"
    echo "$hits"
    status=1
  fi
done < <(find app app-tv benchmark core feature -name '*.kt' -type f 2>/dev/null)

if [ "$status" -eq 0 ]; then
  echo "OK: no Color(0x...) literals outside the generated theme files."
fi
exit "$status"

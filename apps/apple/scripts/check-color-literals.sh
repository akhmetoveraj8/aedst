#!/usr/bin/env bash
# Fails if hand-written app code builds a color from a literal (RGB components, hex integer,
# #colorLiteral). Every color must come from the design tokens (AedstColor / the generated
# AedstLightPalette + AedstDarkPalette), so a theme change is one edit in
# packages/design-tokens. Exempt:
#   - files that start with the GENERATED header (the palettes) and any Generated/ directory,
#   - test sources (Tests/): they may draw fixtures,
#   - a line carrying the marker `color-literal-ok` (with a reason) for a deliberate exception.
set -euo pipefail

cd "$(dirname "$0")/.."

patterns=(
  'Color\(\s*(red|white|hue|hex)\s*:'
  'Color\(\s*\.(sRGB|displayP3|genericRGB)'
  '(UI|NS|CG)Color\(\s*(red|white|hue|displayP3Red|srgbRed)\s*:'
  '#colorLiteral'
  '[Cc]olor.*\b0x[0-9A-Fa-f]{6,8}\b'
)
regex=$(IFS='|'; echo "${patterns[*]}")

status=0
while IFS= read -r -d '' file; do
  if head -n 12 "$file" | grep -q "GENERATED"; then
    continue
  fi
  hits=$(grep -nE "$regex" "$file" | grep -v 'color-literal-ok' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do
      echo "::error file=${file},line=${hit%%:*}::color literal outside the generated token files: ${hit#*:}"
    done <<< "$hits"
    status=1
  fi
done < <(find Core Features App -name '*.swift' \
  -not -path '*/Generated/*' -not -path '*/.build/*' -not -path '*/.swiftpm/*' \
  -not -path '*/Tests/*' -print0)

if [ "$status" -eq 0 ]; then
  echo "OK: no color literals outside the generated token files."
fi
exit "$status"

#!/usr/bin/env bash
# File-size policy for hand-written Swift (line counts, comments included):
#   <= 300  green   (nothing printed)
#   301-400 yellow  (notice: consider splitting)
#   401-500 high    (warning: split in the next change that touches the file)
#   > 500   red     (error, exit 1)
# Generated code (Generated/ directories, files with a GENERATED header) is excluded, so the
# generated token palettes and Connect stubs never count. A line `// file-size-ok: <reason>`
# in the first 12 lines moves a file one level down (an explicit, reviewable exception that
# still cannot exceed 700 lines).
set -euo pipefail

cd "$(dirname "$0")/.."

green=0; yellow=0; high=0; red=0

while IFS= read -r -d '' file; do
  if head -n 12 "$file" | grep -q "GENERATED"; then
    continue
  fi
  lines=$(wc -l < "$file" | tr -d ' ')
  limit_red=500
  if head -n 12 "$file" | grep -q "file-size-ok:"; then
    limit_red=700
  fi

  if [ "$lines" -gt "$limit_red" ]; then
    echo "::error file=${file}::${lines} lines (limit ${limit_red}): split this file"
    red=$((red + 1))
  elif [ "$lines" -gt 400 ]; then
    echo "::warning file=${file}::${lines} lines (>400, high): split soon"
    high=$((high + 1))
  elif [ "$lines" -gt 300 ]; then
    echo "::notice file=${file}::${lines} lines (>300, yellow)"
    yellow=$((yellow + 1))
  else
    green=$((green + 1))
  fi
done < <(find Core Features App -name '*.swift' \
  -not -path '*/Generated/*' -not -path '*/.build/*' -not -path '*/.swiftpm/*' -print0)

echo "File size: ${green} green, ${yellow} yellow (301-400), ${high} high (401-500), ${red} red (>500)."
[ "$red" -eq 0 ]

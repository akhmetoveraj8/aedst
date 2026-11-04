#!/usr/bin/env bash
# File-size policy for hand-written Kotlin (.kt/.kts):
#   <= 300 lines  green
#   301-400       yellow (reported)
#   401-500       high warning (reported as a CI warning)
#   > 500         red: fails the check; split the file
# Excluded: build/ output, generated protobuf/Connect code (src/main/kotlin-gen) and files whose first lines say
# "GENERATED" (design-token theme files).
set -euo pipefail

cd "$(dirname "$0")/.."

YELLOW=300
HIGH=400
RED=500
status=0
yellow=0
high=0

while IFS= read -r file; do
  case "$file" in */build/*|*/kotlin-gen/*|./.gradle/*|./.kotlin/*) continue ;; esac
  if head -n 3 "$file" | grep -q 'GENERATED'; then continue; fi
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$RED" ]; then
    echo "::error file=apps/android/$file::$lines lines (> $RED): split this file."
    status=1
  elif [ "$lines" -gt "$HIGH" ]; then
    echo "::warning file=apps/android/$file::$lines lines (> $HIGH): high; split soon."
    high=$((high + 1))
  elif [ "$lines" -gt "$YELLOW" ]; then
    echo "yellow: $file has $lines lines (> $YELLOW)."
    yellow=$((yellow + 1))
  fi
done < <(find . \( -name '*.kt' -o -name '*.kts' \) -type f -not -path '*/build/*' -not -path '*/kotlin-gen/*')

if [ "$status" -eq 0 ]; then
  echo "OK: no Kotlin file over $RED lines ($high high, $yellow yellow)."
fi
exit "$status"

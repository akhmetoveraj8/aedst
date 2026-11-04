#!/usr/bin/env bash
# Library-First allowlist gate: every library and plugin in gradle/libs.versions.toml must be listed in
# docs/content/library-first/android.md (section "Version catalog allowlist"). Adding a dependency therefore needs the
# doc change in the same PR, which is the rule in AGENTS.md ("approved before first use").
#
# Library entries are matched by their `group:artifact` coordinate, plugin entries by their plugin id. Local
# convention plugins (id = "aedst.*") and BOM-managed entries are matched the same way; nothing is exempt except the
# convention plugins, which live in build-logic/.
#
# Usage: check-catalog-allowlist.sh [catalog] [doc]   (arguments exist for scripts/test-gates.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

catalog="${1:-gradle/libs.versions.toml}"
doc="${2:-../../docs/content/library-first/android.md}"

status=0

if [ ! -f "$doc" ]; then
  echo "::error::Allowlist document not found: $doc"
  exit 1
fi

# `module = "group:artifact"` in [libraries]; `id = "plugin.id"` in [plugins] (skipping aedst.* convention plugins).
entries=$(awk '
  /^\[libraries\]/ { section = "lib"; next }
  /^\[plugins\]/ { section = "plugin"; next }
  /^\[/ { section = ""; next }
  section == "lib" && match($0, /module = "[^"]+"/) { print substr($0, RSTART + 10, RLENGTH - 11) }
  section == "plugin" && match($0, /id = "[^"]+"/) { id = substr($0, RSTART + 6, RLENGTH - 7); if (id !~ /^aedst\./) print id }
' "$catalog" | sort -u)

if [ -z "$entries" ]; then
  echo "::error::No entries parsed from $catalog"
  exit 1
fi

missing=""
count=0
while IFS= read -r entry; do
  count=$((count + 1))
  pattern="${entry//./\.}" # coordinates only contain letters, digits, . : - _, so escaping dots is enough
  # Whole-coordinate match: `androidx.compose.ui:ui` must not be satisfied by `androidx.compose.ui:ui-graphics`.
  if ! grep -qE -- "(^|[^A-Za-z0-9_.:-])${pattern}($|[^A-Za-z0-9_-])" "$doc"; then
    missing="$missing $entry"
    echo "::error file=apps/android/$catalog::'$entry' is in the version catalog but not in the allowlist ($doc, section \"Version catalog allowlist\"). Add it there in the same change."
    status=1
  fi
done <<< "$entries"

if [ "$status" -eq 0 ]; then
  echo "OK: all $count catalog libraries and plugins are in the Library-First allowlist."
fi
exit "$status"

#!/usr/bin/env bash
# The app's declared languages must be the same everywhere, or a locale silently falls back to English:
#   - CFBundleLocalizations in App/iOS/Info.plist and App/macOS/Info.plist are identical (as sets);
#   - each app has an App/<platform>/Resources/<locale>.lproj/InfoPlist.strings for every declared locale;
#   - every locale carries the same keys as the English file;
#   - the declared set equals the locales every String Catalog translates (en, ru, tg, uz, ar).
# Text-based on purpose (no plutil, which only exists on a Mac), so it runs on any machine and in `task check`.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0
fail() {
  echo "::error::$1"
  status=1
}

# Locales listed under CFBundleLocalizations, sorted, one per line.
declared() {
  awk '/<key>CFBundleLocalizations<\/key>/{f=1;next} f&&/<\/array>/{exit} f&&/<string>/{gsub(/.*<string>|<\/string>.*/,"");print}' "$1" | sort
}

expected="ar
en
ru
tg
uz"

for platform in iOS macOS; do
  plist="App/$platform/Info.plist"
  got=$(declared "$plist")
  if [ "$got" != "$expected" ]; then
    fail "$plist CFBundleLocalizations is [$(echo "$got" | tr '\n' ' ')], expected [$(echo "$expected" | tr '\n' ' ')]"
  fi
  base="App/$platform/Resources/en.lproj/InfoPlist.strings"
  if [ ! -f "$base" ]; then
    fail "$base is missing"
    continue
  fi
  base_keys=$(sed -n 's/^"\([^"]*\)".*/\1/p' "$base" | sort)
  for locale in $expected; do
    file="App/$platform/Resources/$locale.lproj/InfoPlist.strings"
    if [ ! -f "$file" ]; then
      fail "$file is missing"
      continue
    fi
    keys=$(sed -n 's/^"\([^"]*\)".*/\1/p' "$file" | sort)
    if [ "$keys" != "$base_keys" ]; then
      fail "$file has different keys than en.lproj/InfoPlist.strings"
    fi
  done
done

# String Catalogs: every catalog localizes exactly the declared set (grep on the locale keys at their indent).
for catalog in $(find Core Features App -name Localizable.xcstrings -not -path '*/.build/*'); do
  for locale in $expected; do
    if ! grep -q "^        \"$locale\" : {" "$catalog"; then
      fail "$catalog has no \"$locale\" localization"
    fi
  done
done

if [ "$status" -eq 0 ]; then
  echo "OK: Info.plist locales, InfoPlist.strings and String Catalogs agree (ar en ru tg uz)."
fi
exit "$status"

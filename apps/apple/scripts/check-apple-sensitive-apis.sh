#!/usr/bin/env bash
# Sensitive-platform-API confinement for apps/apple (Library-First / security, machine-enforced, no Xcode needed):
#   1. Keychain item APIs (SecItem*, kSecClass/kSecValue*/kSecReturn*/kSecMatch*, kSecAttr* other than the SecKey
#      key-material attributes kSecAttrKey*) appear only in Core/AedstPersistence/.../Keychain.swift;
#   2. AuthenticationServices / ASWebAuthenticationSession / WebKit / WKWebView / SFSafariViewController appear only in
#      Features/Auth/.../Data/WebAuthenticator.swift (the one OIDC browser seam);
#   3. kSecAttrSynchronizable may never be true / Any in app code (no iCloud Keychain sync of tokens).
# Test sources (Tests/) and Generated/ are exempt (the Keychain integration test queries the real store).
# Comment-only lines never count. Usage:
#   scripts/check-apple-sensitive-apis.sh              scan apps/apple/{Core,Features,App}
#   scripts/check-apple-sensitive-apis.sh --self-test  fixtures: bad tree must fail every rule, good tree must pass
#   scripts/check-apple-sensitive-apis.sh ROOT         scan ROOT as if it were apps/apple
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

# scan_rule NAME REGEX ALLOWED_PATH_REGEX TOKEN_SKIP_REGEX   (prints violations, returns 1 when any)
scan_rule() {
  # One grep over the tree (a per-file loop takes minutes on Git Bash for Windows); the loop runs over hits only.
  local name="$1" regex="$2" allow="$3" skip="$4" bad=0 hit f rest n tok rel text
  while IFS= read -r hit; do
    f="${hit%%:*}"; rest="${hit#*:}"; n="${rest%%:*}"; tok="${rest#*:}"
    rel="${f#./}"; rel="${rel%.fixture}"
    if [ -n "$allow" ] && printf '%s\n' "$rel" | grep -qE "$allow"; then continue; fi
    if [ -n "$skip" ] && printf '%s\n' "$tok" | grep -qE "$skip"; then continue; fi
    text="$(sed -n "${n}p" "$f")"
    if printf '%s\n' "$text" | grep -qE '^[[:space:]]*//'; then continue; fi
    echo "::error file=apps/apple/$rel,line=$n::[$name] '$tok' is not allowed here"
    bad=1
  done < <(grep -rnoE --include='*.swift' --include='*.swift.fixture' \
    --exclude-dir=Tests --exclude-dir=UITests --exclude-dir=Generated --exclude-dir=.build --exclude-dir=.swiftpm \
    "$regex" Core Features App 2>/dev/null | sort || true)
  return "$bad"
}

run_checks() {
  cd "$1"
  local status=0
  scan_rule keychain-only-in-keychain-swift \
    '\bSecItem[A-Za-z]*|\bkSec(Class|Value|Return|Match)[A-Za-z]*|\bkSecAttr[A-Z][A-Za-z]*' \
    '^Core/AedstPersistence/Sources/AedstPersistence/Keychain\.swift$' '^kSecAttrKey' || status=1
  scan_rule web-auth-only-in-web-authenticator \
    '^[[:space:]]*(@_exported )?import (AuthenticationServices|WebKit|SafariServices)\b|\bWKWebView\b|\bSFSafariViewController\b|\bASWebAuthenticationSession\b' \
    '^Features/Auth/Sources/Auth/Data/WebAuthenticator\.swift$' '' || status=1
  scan_rule no-icloud-keychain-sync \
    'kSecAttrSynchronizable[A-Za-z ]*:[[:space:]]*(true|kCFBooleanTrue|kSecAttrSynchronizableAny)' '' '' || status=1
  return "$status"
}

if [ "${1:-}" = "--self-test" ]; then
  fx="$here/fixtures/sensitive"
  ok=0
  if ! (run_checks "$fx/good" >/dev/null 2>&1); then echo "SELF-TEST FAIL: good tree rejected"; ok=1; fi
  out="$(run_checks "$fx/bad" 2>&1 || true)"
  for rule in keychain-only-in-keychain-swift web-auth-only-in-web-authenticator no-icloud-keychain-sync; do
    if ! printf '%s\n' "$out" | grep -q "\[$rule\]"; then echo "SELF-TEST FAIL: bad fixtures did not trip $rule"; ok=1; fi
  done
  [ "$ok" -eq 0 ] && echo "OK self-test: good tree passes, bad tree trips all 3 sensitive-API rules (check-apple-sensitive-apis.sh)."
  exit "$ok"
fi

root="$(cd "${1:-$here/..}" && pwd)"
if run_checks "$root"; then
  echo "OK: Keychain, web-authentication and iCloud-sync APIs are confined to their single files."
else
  exit 1
fi

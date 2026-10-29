#!/usr/bin/env bash
# Proves that removing platforms really works: for each profile, generate a product with
# `template-new`, then run the repo-wide policy checks inside the generated tree.
#   scripts/check-template-profiles.sh [profile ...]     (default: core mobile)
# A broken removal (dangling task include, doc link, allowlist entry, features.yaml row) fails here
# instead of in the first product built from the template.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profiles=("$@")
[[ ${#profiles[@]} -eq 0 ]] && profiles=(core mobile)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for profile in "${profiles[@]}"; do
  out="$work/$profile"
  echo "== profile: $profile"
  node "$root/scripts/template-new.mjs" --name demo --profile "$profile" --out "$out" >/dev/null
  (
    cd "$out"
    git init -q
    git -c user.name=ci -c user.email=ci@example.invalid add -A
    # check-features needs the yaml package the repo-wide scripts install.
    if [[ -d "$root/scripts/node_modules" && ! -d scripts/node_modules ]]; then
      cp -R "$root/scripts/node_modules" scripts/node_modules
    fi
    bash scripts/check-naming.sh
    bash scripts/check-file-size.sh
    node scripts/check-color-literals.mjs
    node scripts/check-i18n-parity.mjs
    node scripts/check-features.mjs
    node scripts/check-docs.mjs
  )
  echo "OK: profile $profile"
done

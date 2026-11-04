#!/usr/bin/env bash
# AppRpcContract.kt (the list of RPCs the app is allowed to depend on; ProtoContractTest checks it against the server's
# descriptors) must match the RPCs the code really calls, in both directions:
#   - every `client.<rpc>(` call in main code has a "<package>.<Service>/<Rpc>" entry (otherwise a server rename would
#     not fail the contract test), and
#   - every entry has at least one call site (otherwise the contract guards an RPC nobody uses).
# Matching is by RPC name (lowerCamel call vs UpperCamel entry); two services sharing an RPC name are not told apart.
# OkHttp's client.newCall(...) is not an RPC and is ignored; comment lines are ignored.
#
# Usage: check-rpc-contract.sh [contract.kt] [source-root ...]   (arguments exist for scripts/test-gates.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

contract="${1:-core/network/src/test/kotlin/com/aedst/core/network/contract/AppRpcContract.kt}"
[ "$#" -gt 0 ] && shift
roots=("$@")
[ "${#roots[@]}" -eq 0 ] && roots=(core feature app app-tv)

status=0

# RPC names in the contract: the part after the last slash, first letter lower-cased.
declared=$(grep -oE '"[a-z0-9_.]+\.[A-Za-z]+/[A-Za-z]+"' "$contract" | sed -E 's#.*/([A-Za-z])([A-Za-z]*)"#\L\1\E\2#' | sort -u)

# RPC calls in main code (not tests, not generated code, not comments).
called=$(find "${roots[@]}" -name '*.kt' -type f -path '*/src/main/*' -not -path '*/kotlin-gen/*' -not -path '*/build/*' -print0 2>/dev/null \
  | xargs -0 grep -hE 'client\.[a-z][A-Za-z0-9]*\(' 2>/dev/null \
  | grep -vE '^\s*(\*|//)' \
  | grep -oE 'client\.[a-z][A-Za-z0-9]*\(' \
  | sed -E 's/client\.([A-Za-z0-9]+)\(/\1/' \
  | grep -vx 'newCall' | sort -u || true)

if [ -z "$declared" ] || [ -z "$called" ]; then
  echo "::error::Could not extract RPC names (declared: $(echo "$declared" | wc -w), called: $(echo "$called" | wc -w)); check scripts/check-rpc-contract.sh"
  exit 1
fi

for rpc in $called; do
  if ! grep -qx "$rpc" <<< "$declared"; then
    echo "::error file=apps/android/$contract::The code calls client.$rpc(...) but AppRpcContract has no entry for it; add \"<package>.<Service>/${rpc^}\"."
    status=1
  fi
done
for rpc in $declared; do
  if ! grep -qx "$rpc" <<< "$called"; then
    echo "::error file=apps/android/$contract::AppRpcContract lists ${rpc^} but no code calls client.$rpc(...); remove the entry (or restore the call)."
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "OK: AppRpcContract matches the $(wc -w <<< "$called") RPCs the app calls."
fi
exit "$status"

#!/usr/bin/env bash
# Generates one OpenAPI 3.1 document per proto package into docs/public/openapi/
# (served by the docs site at /openapi/<package>.yaml) with the Connect-aware
# protoc-gen-connect-openapi plugin. Nothing here is hand-written OpenAPI: the
# .proto files are the only source.
#
#   bash scripts/gen-openapi.sh           write the documents
#   bash scripts/gen-openapi.sh --check   exit 1 when a committed document is stale
#
# The plugin runs through `go run <module>@<version>` so its version is pinned
# here and it adds nothing to the server's go.mod (it is a build tool, not a
# runtime dependency). Version verified against proxy.golang.org; bump it here
# and in docs/content/library-first/server.md together.
set -euo pipefail

PLUGIN="connectrpc.com/protoc-gen-connect-openapi@v0.30.0"

cd "$(dirname "$0")/.."
out=../../docs/public/openapi
# Relative, so the path means the same to Git Bash and to the native plugin process on Windows.
work="$(mktemp -d -p .)"
trap 'rm -rf "$work"' EXIT

hash_out() {
  [ -d "$out" ] || return 0
  find "$out" -type f -name '*.yaml' | LC_ALL=C sort | xargs -r sha256sum
}

before="$(hash_out)"
mkdir -p "$out"
rm -f "$out"/*.yaml

for dir in api/proto/aedst/*/v*/; do
  dir="${dir%/}"
  version="$(basename "$dir")"
  module="$(basename "$(dirname "$dir")")"
  package="aedst.${module}.${version}"
  base="$work/${package}.base.yaml"
  cat >"$base" <<EOF
openapi: 3.1.0
info:
  title: AEDST ${module} API (${package})
  description: Generated from apps/server/${dir}. ConnectRPC over HTTP, one POST per RPC (GET where the RPC has no side effects). Do not edit by hand.
  version: ${version}
EOF
  template="$(printf '{"version":"v2","plugins":[{"local":["go","run","%s"],"out":"%s","strategy":"all","opt":["format=yaml","path=%s.yaml","base=%s","allow-get"]}]}' \
    "$PLUGIN" "$out" "$package" "$base")"
  buf generate --template "$template" --path "$dir"
done

after="$(hash_out)"
if [ "${1:-}" = "--check" ] && [ "$before" != "$after" ]; then
  echo "docs/public/openapi was out of date; it has been regenerated (task gen:openapi), review and commit it:" >&2
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  exit 1
fi
echo "OpenAPI documents in docs/public/openapi are up to date"

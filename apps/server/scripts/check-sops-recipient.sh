#!/usr/bin/env bash
# Refuse to encrypt for the placeholder age recipient shipped in .sops.yaml: a
# file encrypted for it can never be decrypted by anyone.
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -q 'age1REPLACE0WITH0' .sops.yaml; then
  echo "error: .sops.yaml still has the placeholder age recipient." >&2
  echo "Generate a key (age-keygen -o key.txt), put the printed age1... public key in .sops.yaml, and see deployments/secrets/README.md." >&2
  exit 1
fi

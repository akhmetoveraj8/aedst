#!/usr/bin/env bash
# Pre-commit secret scan of the staged diff (lefthook `gitleaks`). Skipped when gitleaks is not
# installed; CI runs the scan unconditionally (policies-ci.yml, config in .gitleaks.toml).
#
# gitleaks >= 8.19 uses `gitleaks git --pre-commit --staged`; older releases only know
# `gitleaks protect --staged`. The pinned version is in mise.toml.
# UNVERIFIED locally: no gitleaks binary was available when this was written.
set -uo pipefail

cd "$(dirname "$0")/.."

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "skip: gitleaks is not installed (mise install); CI scans every push"
  exit 0
fi

if gitleaks git --help >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --no-banner
fi
exec gitleaks protect --staged --redact --no-banner

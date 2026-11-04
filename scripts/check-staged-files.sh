#!/usr/bin/env bash
# Pre-commit guard (lefthook `staged-files`): reject staged files that
#   - have a non-ASCII character in their path (pasted chat prompts, "Screenshot 2026-… ".png with narrow
#     no-break spaces, Cyrillic names: they break shells, CI globs and Windows/macOS checkouts), or
#   - are larger than 1 MiB (binaries and dumps do not belong in git; use releases/LFS/object storage).
#
#   bash scripts/check-staged-files.sh              # checks the index (what lefthook runs)
#   AEDST_ALLOW_LARGE_FILES=1 git commit ...        # deliberate, reviewed exception for the size rule only
#
# Deleted paths are ignored. Needs bash and git.
set -uo pipefail

limit=$((1024 * 1024))
bad=0

while IFS= read -r -d '' path; do
  if printf '%s' "$path" | LC_ALL=C grep -q -P '[^\x00-\x7F]'; then
    printf 'error: non-ASCII file name staged: %s\n' "$path" >&2
    bad=1
    continue
  fi
  [ "${AEDST_ALLOW_LARGE_FILES:-0}" = "1" ] && continue
  size="$(git cat-file -s ":$path" 2>/dev/null || echo 0)"
  if [ "$size" -gt "$limit" ]; then
    printf 'error: staged file is larger than 1 MiB (%s bytes): %s\n' "$size" "$path" >&2
    bad=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

if [ "$bad" -ne 0 ]; then
  echo "Unstage the file(s) (git restore --staged <path>), rename ASCII-only, or - for a reviewed large file - set AEDST_ALLOW_LARGE_FILES=1." >&2
fi
exit "$bad"

#!/usr/bin/env bash
# Usage: scripts/ci/check-file-size.sh [max_lines]
# Exits 1 when a source file has more lines than max_lines (default 300).
set -euo pipefail

limit="${1:-300}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

status=0
while IFS= read -r file; do
  [ -f "$file" ] || continue
  lines="$(wc -l < "$file")"
  if [ "$lines" -gt "$limit" ]; then
    printf '%6d %s\n' "$lines" "$file"
    status=1
  fi
done < <(git ls-files -co --exclude-standard -- \
  '*.go' '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.css' \
  ':!:frontend/bindings/**')

if [ "$status" -ne 0 ]; then
  echo "Files above $limit lines found. Split them to keep the UI responsive." >&2
else
  echo "All source files are within $limit lines."
fi
exit "$status"

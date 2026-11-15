#!/usr/bin/env bash
set -euo pipefail

export GOTOOLCHAIN=go1.26.11

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Stop the Pinger app previously started from this repo's bin directory.
if /usr/bin/pgrep -f "$REPO_ROOT/bin/pinger" >/dev/null; then
  /usr/bin/pkill -f "$REPO_ROOT/bin/pinger" || true
  for _ in $(seq 1 50); do
    /usr/bin/pgrep -f "$REPO_ROOT/bin/pinger" >/dev/null || break
    /bin/sleep 0.1
  done
  if /usr/bin/pgrep -f "$REPO_ROOT/bin/pinger" >/dev/null; then
    printf 'Old Pinger process is still running. Stop it and try again.\n' >&2
    exit 1
  fi
  printf 'Stopped the old Pinger process.\n'
fi

npm --prefix frontend run build
exec go run -tags=sqlite_fts5,goolm .

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT="${WAILS_VITE_PORT:-9245}"

if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
  MINGW_BIN="$REPO_ROOT/toolchain/mingw64/bin"
  if [[ -x "$MINGW_BIN/gcc.exe" ]]; then
    export PATH="$MINGW_BIN:$PATH"
    export CC=gcc
  fi
fi

cd "$REPO_ROOT"
exec wails3 dev -config ./build/config.yml -port "$PORT"

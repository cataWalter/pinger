#!/usr/bin/env bash
set -euo pipefail

export GOTOOLCHAIN=go1.26.10

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT="${WAILS_VITE_PORT:-9245}"
PLATFORM="$(uname -s)"
CONFIG="./build/config.yml"

if [[ "$PLATFORM" == "Darwin" ]]; then
  CONFIG="./build/darwin/dev-config.yml"
elif [[ "$PLATFORM" == MINGW* || "$PLATFORM" == MSYS* || "$PLATFORM" == CYGWIN* ]]; then
  MINGW_BIN="$REPO_ROOT/tools/msys64/ucrt64/bin"
  if [[ -x "$MINGW_BIN/gcc.exe" ]]; then
    export PATH="$MINGW_BIN:$PATH"
    export CC=gcc
  fi
fi

WAILS_COMMAND="$(command -v wails3 || true)"
if [[ -z "$WAILS_COMMAND" && "$PLATFORM" == "Darwin" ]]; then
  WAILS_BIN="$(go env GOBIN)"
  if [[ -z "$WAILS_BIN" ]]; then
    WAILS_BIN="$(go env GOPATH)/bin"
  fi
  if [[ -x "$WAILS_BIN/wails3" ]]; then
    WAILS_COMMAND="$WAILS_BIN/wails3"
  fi
fi

if [[ -z "$WAILS_COMMAND" || ! -x "$WAILS_COMMAND" ]]; then
  printf 'Wails CLI not found. Install the project-pinned version with:\n  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30\n' >&2
  exit 1
fi

if [[ "$WAILS_COMMAND" == */* ]]; then
  export PATH="$(dirname -- "$WAILS_COMMAND"):$PATH"
fi
export WAILS_VITE_PORT="$PORT"

cd "$REPO_ROOT"
exec "$WAILS_COMMAND" dev -config "$CONFIG" -port "$PORT"

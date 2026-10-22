#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT="${WAILS_VITE_PORT:-9245}"
PLATFORM="$(uname -s)"
CONFIG="./build/config.dev.unix.yml"

if [[ "$PLATFORM" == "Darwin" ]]; then
  CONFIG="./build/darwin/dev-config.yml"
elif [[ "$PLATFORM" == MINGW* || "$PLATFORM" == MSYS* || "$PLATFORM" == CYGWIN* ]]; then
  CONFIG="./build/windows/dev-config.yml"
  MINGW_CANDIDATES=(
    "$REPO_ROOT/toolchain/mingw64/bin"
    "$REPO_ROOT/tools/msys64/ucrt64/bin"
    "/c/msys64/ucrt64/bin"
  )
  if [[ -n "${MSYSTEM_PREFIX:-}" ]]; then
    MINGW_CANDIDATES+=("$MSYSTEM_PREFIX/bin")
  fi

  MINGW_BIN=""
  for candidate in "${MINGW_CANDIDATES[@]}"; do
    compiler="$candidate/gcc.exe"
    if [[ -x "$compiler" ]] &&
      crt2="$("$compiler" -print-file-name=crt2.o 2>/dev/null)" &&
      libm="$("$compiler" -print-file-name=libm.a 2>/dev/null)" &&
      [[ -f "$crt2" && -f "$libm" ]]; then
      MINGW_BIN="$candidate"
      break
    fi
  done

  if [[ -z "$MINGW_BIN" ]] && command -v gcc >/dev/null 2>&1; then
    compiler="$(command -v gcc)"
    if crt2="$("$compiler" -print-file-name=crt2.o 2>/dev/null)" &&
      libm="$("$compiler" -print-file-name=libm.a 2>/dev/null)" &&
      [[ -f "$crt2" && -f "$libm" ]]; then
      MINGW_BIN="$(dirname "$compiler")"
    fi
  fi

  if [[ -z "$MINGW_BIN" ]]; then
    echo "A working MinGW-w64 GCC was not found (crt2.o and libm.a are required)." >&2
    echo "Install MSYS2 UCRT64 GCC and run this script from its terminal, or add it to PATH:" >&2
    echo "  pacman -S --needed mingw-w64-ucrt-x86_64-gcc" >&2
    exit 1
  fi
  export PATH="$MINGW_BIN:$REPO_ROOT/toolchain/mingw64/x86_64-w64-mingw32/bin:$REPO_ROOT/toolchain/msys64/usr/bin:$PATH"
  export CC=gcc
  if [[ -z "${GOFLAGS:-}" ]]; then
    export GOFLAGS=-p=2
  fi
elif [[ "$PLATFORM" != "Darwin" && "$PLATFORM" != "Linux" ]]; then
  echo "Unsupported development platform: $PLATFORM" >&2
  exit 1
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

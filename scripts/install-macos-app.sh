#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BIN_DIR=${BIN_DIR:-"$ROOT_DIR/bin"}
APP_NAME=${APP_NAME:-Pinger}
INSTALL_DIR=${INSTALL_DIR:-"$HOME/Applications"}
APP_SOURCE="$BIN_DIR/$APP_NAME.app"
APP_DESTINATION="$INSTALL_DIR/$APP_NAME.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

sh "$SCRIPT_DIR/build-macos-app.sh"
mkdir -p "$INSTALL_DIR"
rm -rf "$APP_DESTINATION"
ditto "$APP_SOURCE" "$APP_DESTINATION"
open -a "$APP_DESTINATION"
printf 'Installed %s\n' "$APP_DESTINATION"
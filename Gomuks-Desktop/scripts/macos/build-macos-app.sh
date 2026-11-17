#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BIN_DIR=${BIN_DIR:-"$ROOT_DIR/bin"}
APP_NAME=${APP_NAME:-Pinger}
BINARY_NAME=${BINARY_NAME:-pinger}
GUI_NAME=${GUI_NAME:-pinger-qt}
VERSION=${VERSION:-0.1.0}
COMMIT=${COMMIT:-unknown}
BUILD_DATE=${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
GO_TAGS=${GO_TAGS:-sqlite_fts5,goolm}
QT_BUILD_DIR=${QT_BUILD_DIR:-"$ROOT_DIR/qt6/build"}
APP_DIR="$BIN_DIR/$APP_NAME.app"
BINARY_PATH="$BIN_DIR/$BINARY_NAME"
GUI_PATH="$QT_BUILD_DIR/$GUI_NAME"
ICON_PATH="$ROOT_DIR/build/darwin/icons.icns"
export CGO_ENABLED="${CGO_ENABLED:-1}"
export CGO_CFLAGS="${CGO_CFLAGS:--mmacosx-version-min=13.0}"
export CGO_LDFLAGS="${CGO_LDFLAGS:--mmacosx-version-min=13.0}"
export GOTOOLCHAIN=go1.26.11

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

# Qt is keg-only under Homebrew, so look it up when QT_PREFIX is not set.
if [ -z "${QT_PREFIX:-}" ] && command -v brew >/dev/null 2>&1; then
  QT_PREFIX=$(brew --prefix qt 2>/dev/null || true)
fi

CMAKE_ARGS="-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=${QT_MACOS_DEPLOYMENT_TARGET:-}"
if [ -n "${QT_PREFIX:-}" ]; then
  CMAKE_ARGS="$CMAKE_ARGS -DCMAKE_PREFIX_PATH=$QT_PREFIX"
fi
if command -v ninja >/dev/null 2>&1; then
  CMAKE_ARGS="$CMAKE_ARGS -G Ninja"
fi

# CMAKE_ARGS is intentionally split into separate words.
# shellcheck disable=SC2086
cmake -S "$ROOT_DIR/qt6" -B "$QT_BUILD_DIR" $CMAKE_ARGS
cmake --build "$QT_BUILD_DIR" --config Release --target pinger-qt

mkdir -p "$BIN_DIR"
go build \
  -tags "$GO_TAGS" \
  -trimpath \
  -buildvcs=false \
  -ldflags "-s -w -X main.Version=$VERSION -X main.Commit=$COMMIT -X main.BuildDate=$BUILD_DATE" \
  -o "$BINARY_PATH" \
  "$ROOT_DIR"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$GUI_PATH" "$APP_DIR/Contents/MacOS/$GUI_NAME"
cp "$BINARY_PATH" "$APP_DIR/Contents/MacOS/$BINARY_NAME"
cp "$ICON_PATH" "$APP_DIR/Contents/Resources/icons.icns"
cp "$ROOT_DIR/build/darwin/Info.plist" "$APP_DIR/Contents/Info.plist"

bundle_version=${VERSION#v}
if [ "$bundle_version" = "dev" ] || [ -z "$bundle_version" ]; then
  bundle_version=0.1.0
fi
/usr/bin/plutil -replace CFBundleDisplayName -string "$APP_NAME" "$APP_DIR/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleName -string "$APP_NAME" "$APP_DIR/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "$bundle_version" "$APP_DIR/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "$bundle_version" "$APP_DIR/Contents/Info.plist"

# Optional: bundle Qt frameworks and plugins. Set SKIP_MACDEPLOYQT=1 to skip.
MACDEPLOYQT_BIN=""
if [ "${SKIP_MACDEPLOYQT:-0}" != "1" ]; then
  if [ -n "${QT_PREFIX:-}" ] && [ -x "$QT_PREFIX/bin/macdeployqt" ]; then
    MACDEPLOYQT_BIN="$QT_PREFIX/bin/macdeployqt"
  elif command -v macdeployqt >/dev/null 2>&1; then
    MACDEPLOYQT_BIN=$(command -v macdeployqt)
  fi
fi
if [ -n "$MACDEPLOYQT_BIN" ]; then
  "$MACDEPLOYQT_BIN" "$APP_DIR"
else
  echo "macdeployqt not found; the app will rely on the local Qt installation." >&2
fi

xattr -cr "$APP_DIR"
codesign --force --deep --sign - "$APP_DIR" >/dev/null
codesign --verify --deep --strict "$APP_DIR"
printf 'Built %s\n' "$APP_DIR"

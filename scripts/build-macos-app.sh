#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BIN_DIR=${BIN_DIR:-"$ROOT_DIR/bin"}
APP_NAME=${APP_NAME:-Pinger}
BINARY_NAME=${BINARY_NAME:-pinger}
VERSION=${VERSION:-0.1.0}
COMMIT=${COMMIT:-unknown}
BUILD_DATE=${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
GO_TAGS=${GO_TAGS:-sqlite_fts5,goolm}
APP_DIR="$BIN_DIR/$APP_NAME.app"
BINARY_PATH="$BIN_DIR/$BINARY_NAME"
ICON_PATH="$ROOT_DIR/build/darwin/icons.icns"
export CGO_ENABLED="${CGO_ENABLED:-1}"
export CGO_CFLAGS="${CGO_CFLAGS:--mmacosx-version-min=12.0}"
export CGO_LDFLAGS="${CGO_LDFLAGS:--mmacosx-version-min=12.0}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"
export GOTOOLCHAIN=go1.26.10

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

npm --prefix "$ROOT_DIR/frontend" run icons

mkdir -p "$BIN_DIR"
npm --prefix "$ROOT_DIR/frontend" run build
go build \
  -tags "$GO_TAGS" \
  -trimpath \
  -buildvcs=false \
  -ldflags "-s -w -X main.Version=$VERSION -X main.Commit=$COMMIT -X main.BuildDate=$BUILD_DATE" \
  -o "$BINARY_PATH" \
  "$ROOT_DIR"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
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

xattr -cr "$APP_DIR"
codesign --force --deep --sign - "$APP_DIR" >/dev/null
codesign --verify --deep --strict "$APP_DIR"
printf 'Built %s\n' "$APP_DIR"

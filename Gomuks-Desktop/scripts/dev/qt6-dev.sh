#!/bin/sh
# Dev loop for the Qt client. Polls the Qt and Go sources, rebuilds on change,
# and restarts pinger-qt. A failed build keeps the running app and waits for the next save.
# Run through `task dev:qt6`. Set QT6_DEV_INTERVAL to change the polling interval (seconds).
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

BUILD_DIR=qt6/build
if [ "$(uname -s)" = Darwin ]; then
    DEV_APP="$ROOT/$BUILD_DIR/PingerQtDev.app"
    APP="$DEV_APP/Contents/MacOS/pinger-qt"
else
    APP="$ROOT/$BUILD_DIR/pinger-qt"
fi
BACKEND_OUT="$BUILD_DIR/pinger"
TAGS="sqlite_fts5,goolm"
INTERVAL=${QT6_DEV_INTERVAL:-1}
STAMP="$BUILD_DIR/.dev-stamp"
APP_PID=""

log() {
    echo "[qt6-dev] $*"
}

configure() {
    if command -v brew >/dev/null 2>&1 && QT_PREFIX=$(brew --prefix qt 2>/dev/null) && [ -n "$QT_PREFIX" ]; then
        cmake -S qt6 -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$QT_PREFIX"
    else
        cmake -S qt6 -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
    fi
}

build() {
    log "building Qt client"
    cmake --build "$BUILD_DIR" --config Release --target pinger-qt || return
    log "building Go backend"
    go build -tags "$TAGS" -trimpath -buildvcs=false -o "$BACKEND_OUT" .
}

stage_dev_app() {
    if [ "$(uname -s)" != Darwin ]; then
        return
    fi

    mkdir -p "$DEV_APP/Contents/MacOS" "$DEV_APP/Contents/Resources"
    cp "$ROOT/$BUILD_DIR/pinger-qt" "$APP"
    cp "$ROOT/$BACKEND_OUT" "$DEV_APP/Contents/MacOS/pinger"
    cp "$ROOT/build/darwin/Info.plist" "$DEV_APP/Contents/Info.plist"
    cp "$ROOT/build/darwin/icons.icns" "$DEV_APP/Contents/Resources/icons.icns"
    plutil -replace CFBundleIdentifier -string fi.mau.pinger.qt-dev "$DEV_APP/Contents/Info.plist"
    plutil -replace CFBundleName -string "Pinger Qt Dev" "$DEV_APP/Contents/Info.plist"
    plutil -replace CFBundleDisplayName -string "Pinger Qt Dev" "$DEV_APP/Contents/Info.plist"
    codesign --force --deep --sign - "$DEV_APP" >/dev/null
}

# Lists sources newer than the stamp. Go tests, scripts, and frontend are skipped because they are not in the app.
changed_files() {
    find qt6/src qt6/resources qt6/CMakeLists.txt build/appicon.png -type f -newer "$STAMP" 2>/dev/null
    find . \( -path ./frontend -o -path ./qt6 -o -path ./.git -o -path ./bin -o -path ./.task \
        -o -path ./build -o -path ./scripts -o -path ./node_modules \) -prune -o \
        -type f \( -name '*.go' -o -name go.mod -o -name go.sum \) ! -name '*_test.go' \
        -newer "$STAMP" -print 2>/dev/null
}

start_app() {
    "$APP" &
    APP_PID=$!
}

stop_app() {
    if [ -z "$APP_PID" ]; then
        return
    fi
    kill "$APP_PID" 2>/dev/null || true
    i=0
    while kill -0 "$APP_PID" 2>/dev/null && [ "$i" -lt 50 ]; do
        sleep 0.1
        i=$((i + 1))
    done
    kill -9 "$APP_PID" 2>/dev/null || true
    # Reap the child so it is not left as a zombie.
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
}

if pgrep -f "Pinger.app/Contents/MacOS" >/dev/null 2>&1; then
    log "error: Pinger.app is running; close it before starting Qt because both use the same data directory"
    exit 1
fi

# Stop instances left over from earlier runs so two GUIs never share the data directory.
for pid in $(pgrep -x pinger-qt 2>/dev/null || true); do
    log "stopping stale pinger-qt (pid $pid)"
    kill "$pid" 2>/dev/null || true
done

trap 'exit 130' INT
trap 'exit 143' TERM
trap stop_app EXIT

log "configuring"
configure
touch "$STAMP"
log "building"
if build; then
    stage_dev_app
    log "starting Qt client"
    start_app
    log "running. Save a Qt or Go source file to reload. Ctrl-C to quit."
else
    log "build failed. Fix the error and save to retry."
fi

while true; do
    sleep "$INTERVAL"
    if [ -z "$(changed_files | head -n 1)" ]; then
        continue
    fi
    # Stamp before building so saves made during the build trigger another round.
    touch "$STAMP"
    log "change detected, rebuilding"
    if build; then
        stop_app
        stage_dev_app
        log "restarting Qt client"
        start_app
        log "reloaded"
    else
        log "build failed. Fix the error and save to retry."
    fi
done

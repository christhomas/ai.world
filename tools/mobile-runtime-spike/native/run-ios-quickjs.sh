#!/usr/bin/env bash
set -euo pipefail
# GitHub only. Same QuickJS C host and archive as Android, compiled for iOS simulator.
archive=quickjs-2026-06-04.tar.xz
curl --fail --location --silent --show-error "https://bellard.org/quickjs/$archive" -o "$RUNNER_TEMP/$archive"
printf '%s  %s\n' b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a "$RUNNER_TEMP/$archive" | shasum -a 256 --check
mkdir -p "$RUNNER_TEMP/quickjs"
tar -xJf "$RUNNER_TEMP/$archive" -C "$RUNNER_TEMP/quickjs" --strip-components=1
qsrc="$RUNNER_TEMP/quickjs"
device=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(v["udid"] for a in d["devices"].values() for v in a if "iPhone" in v["name"]))')
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator clang -O2 -target "$(uname -m)-apple-ios15.0-simulator" -isysroot "$sdk" -D_GNU_SOURCE -DCONFIG_VERSION='"2026-06-04"' -I "$qsrc" tools/mobile-runtime-spike/native/quickjs-host.c "$qsrc/quickjs.c" "$qsrc/dtoa.c" "$qsrc/libregexp.c" "$qsrc/libunicode.c" "$qsrc/cutils.c" -lm -o runtime-spike-out/ios-quickjs-host
codesign --force --sign - runtime-spike-out/ios-quickjs-host
xcrun simctl spawn "$device" "$(pwd)/runtime-spike-out/ios-quickjs-host" "$(pwd)/runtime-spike-out/workload.js" > runtime-spike-out/ios-quickjs.json 2> runtime-spike-out/ios-quickjs-metrics.log
cp "$qsrc/LICENSE" runtime-spike-out/quickjs-LICENSE.txt
xcrun simctl list devices -j > runtime-spike-out/ios-quickjs-devices.json

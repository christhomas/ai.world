#!/usr/bin/env bash
set -euo pipefail
# GitHub only. Simulator process using its bundled JSC; no desktop JSC substitution.
device=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(v["udid"] for a in d["devices"].values() for v in a if "iPhone" in v["name"]))')
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator clang -O2 -fobjc-arc -target "$(uname -m)-apple-ios15.0-simulator" -isysroot "$sdk" -framework Foundation -framework JavaScriptCore tools/mobile-runtime-spike/native/jsc-host.m -o runtime-spike-out/jsc-host
codesign --force --sign - runtime-spike-out/jsc-host
bundle=$(pwd)/runtime-spike-out/workload.js
xcrun simctl spawn "$device" "$(pwd)/runtime-spike-out/jsc-host" "$bundle" > runtime-spike-out/ios.json 2> runtime-spike-out/ios-metrics.log
xcrun simctl list devices -j > runtime-spike-out/ios-devices.json

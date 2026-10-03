#!/usr/bin/env bash
set -euo pipefail
# GitHub only: standalone console process, not Flutter or renderer evidence.
archive=quickjs-2026-06-04.tar.xz
curl --fail --location --silent --show-error "https://bellard.org/quickjs/$archive" -o "$RUNNER_TEMP/$archive"
echo "b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a  $RUNNER_TEMP/$archive" | sha256sum --check
mkdir -p "$RUNNER_TEMP/quickjs"
tar -xJf "$RUNNER_TEMP/$archive" -C "$RUNNER_TEMP/quickjs" --strip-components=1
qsrc="$RUNNER_TEMP/quickjs"
ndk="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android29-clang"
"$ndk" -O2 -D_GNU_SOURCE -DCONFIG_VERSION='"2026-06-04"' -I "$qsrc" tools/mobile-runtime-spike/native/quickjs-host.c "$qsrc/quickjs.c" "$qsrc/dtoa.c" "$qsrc/libregexp.c" "$qsrc/libunicode.c" "$qsrc/cutils.c" -lm -ldl -lpthread -o runtime-spike-out/quickjs-host
adb push runtime-spike-out/quickjs-host runtime-spike-out/workload.js /data/local/tmp/
adb shell chmod 755 /data/local/tmp/quickjs-host
adb shell /data/local/tmp/quickjs-host /data/local/tmp/workload.js > runtime-spike-out/android.json 2> runtime-spike-out/android-metrics.log
cp "$qsrc/LICENSE" runtime-spike-out/quickjs-LICENSE.txt

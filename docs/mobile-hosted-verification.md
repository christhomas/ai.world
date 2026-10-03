# Hosted mobile renderer evidence

Dispatch `mobile-playtests.yml` on a pushed feature branch through GitHub Actions:

```sh
gh workflow run mobile-playtests.yml --ref <branch> -f gate=renderer
```

Applicable pull requests also run both native jobs. All dependency installation, Flutter tests,
builds and device execution happen on GitHub-hosted runners. The runner refuses local execution.
Existing web and mobile build checks remain unchanged. This workflow is new groundwork rather
than a declaration that repository required-check or release acceptance configuration is complete.

Android uses Ubuntu 24.04, API 35 google_apis x86_64, Pixel 6, Java 17 and GLES3 through SwiftShader.
iOS uses macOS 15, Xcode 16.4, iOS 18.5 and a newly created iPhone 16 simulator with Metal.
Flutter is pinned to 3.47.1. Each job records the installed tools/device properties; missing pinned
runtime or backend initialization fails provisioning instead of substituting a different device.
Android refuses an ambiguous device list; the emulator action owns teardown. iOS shuts down and
deletes only its newly created simulator, including after failures.

`tools/mobile/native_replay.dart` uses the production `NativeWorldView`, default native method
channel and `FlutterFramePipeline`. It replays the existing `interior_frame.json` recorded from
the actual game in hosted Checks run 36657253479, seed 3. The hosted runner generates temporary
Dart fixture/entrypoint files in the disposable checkout and builds that replay target. It does
not replace the production entrypoint in source control or substitute a mock renderer. Flutter
tests run in full; the iOS capture additionally runs `RunnerTests` against its dedicated simulator.

The runner waits at most 90 seconds for explicit native creation and frame submission, captures
twice using `adb screencap` or `simctl io screenshot`, decodes both PNGs, and checks the central
scene's colour variety and deviation. A flat/blank texture cannot pass this smoke heuristic.
Thresholds (standard deviation 8, at least 32 colours in a 128-pixel sample) only reject flat
output; they do not claim a calibrated lighting tolerance or established repeatability noise floor.
The native log retains GLES/Metal initialization diagnostics and frame readiness. Method-channel
readiness alone is not visual success; image assertions must also pass. There are no retries.

The artifact contains `manifest.json`, `commands.log`, native/application logs, two original OS
PNGs, iOS XCTest results and a self-contained `report.html` with embedded images and logs.
Manifest fields include source SHA, app checksum/version, fixture checksum, configuration,
scenario names and observed assertions. Reports are generated even after setup/build/device
failure. A missing report fails artifact upload. `prepare` and `capture` expose failure stages.
Future #569 fixtures should consume this same output directory and manifest/report interface.

## Pending acceptance

`gate=gameplay` deliberately fails its separately named installed-gameplay job. A successful
renderer job cannot satisfy #584. The current app follows an external scene feed and has no
independent offline player session, visible touch controls or persisted gameplay journey.
Required production dependencies are #558 (shared contract), #563 (bundled session), #564
(offline host), #571 (touch controls) and #572 (entry flows). Once available, add actual installed
production-app scenarios: fresh install, new offline world, world/HUD, touch movement and
collision, open/close book, save, process termination, relaunch and persisted continuation.
These must run without a scene feed, direct action injection or fake session; touches must cause
observable state changes. Network disabling, journey recordings, save-loss/control-disconnect
regressions, production artifact checksum, zero-scenario rejection and required merge/release
gate integration remain acceptance work. Do not change this pending gate to success until those
scenarios actually execute on both platforms.

#569 also remains open: interior-only smoke is not multi-scene web/GLES/Metal parity. Frozen
animation/water clocks, autumn/coast/dungeon/multi-light fixtures, numerical repeat noise,
regional diff thresholds and failing light/foam regressions still need implementation.

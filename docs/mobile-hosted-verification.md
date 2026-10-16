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
The disposable hosted runner enables the emulator action's documented KVM permissions and checks
KVM access before boot. VM acceleration is required; unsupported acceleration fails provisioning
instead of falling back to software CPU emulation and waiting for a boot timeout. SwiftShader
remains the graphics backend, independently of KVM's CPU acceleration.
iOS uses macOS 15, Xcode 16.4, iOS 18.5 and a newly created iPhone 16 simulator with Metal.
Flutter is pinned to 3.47.1. Each job records the installed tools/device properties; missing pinned
runtime or backend initialization fails provisioning instead of substituting a different device.
Android refuses an ambiguous device list; the emulator action owns teardown. iOS shuts down and
deletes only its newly created simulator, including after failures.

`tools/mobile/native_replay.dart` uses the production `NativeWorldView`, default native method
channel and `FlutterFramePipeline`.

**What it replays.** First comes the checked-in `interior_frame.json`, recorded from the actual game
in hosted Checks run 36657253479 (seed 3). Then come the scenes the `frames` job photographs on the
same commit with `tools/shots.cjs` in `PARITY` mode:
- `town`: the square at noon;
- `night`: the same square after dark;
- `autumn`: day 17 at noon, with the warm linear sun (#499);
- `interior`: the general store, lit by point lights;
- `dungeon`: a shrine's floor;
- `sea`: your own boat at noon;
- `night-sea`: the same boat at night (phones only; it has no README picture).

`shots.cjs` sets each one up exactly as it does the README pictures, on the frozen screenshot
clock. The page also mounts the recorder (`?record-scene`). The last frame is stepped with the
recorder armed, so the description the phones draw and the web picture are the same frame at the
same render time. The web picture is the WebGL canvas read back (`preserveDrawingBuffer`), with no
HUD over it, at 1200×540 (a phone's 20:9). `tools/mobile/parity-packets.ts` turns each kept frame
into the exact packet the Flutter feed sends. `web/<scene>.png` and `web/manifest.json` sit beside
the packets, and `SHA256SUMS` covers all of them.

**Preparing the build.** `hosted.py prepare` verifies every recorded packet against its checksum and
writes `assets/hosted/scenes.json` with each scene's node count per kind. It ships the packets as
assets of the disposable hosted build. Nothing in source control changes; it does not replace the
production entrypoint or substitute a mock renderer.

**Replaying.** One pipeline draws the scenes in order, each at the render time the web drew it at
(the checked-in fixture predates the field and uses 1000 ms). Each must decode to exactly its
recorded counts, with real geometry and at least one light, before it is drawn; the checked-in
interior keeps its exact mesh and instance counts. The app then reads its own render target back
twice (`NativeWorldRenderer.snapshot`): `glReadPixels` before the swap on GLES, a blit in the
frame's own command buffer on Metal. It writes both reads as RGBA into its app-private storage,
logs `HOSTED_SCENE_READY` with the target's size, and holds the scene until the host writes
`parity-advance-<n>` beside them. Android writes it through `run-as`, iOS into the simulator's data container.
So every scene is photographed whole, however slow the emulator is. Flutter tests run in full; the
iOS capture also runs `RunnerTests` against its dedicated simulator.

The runner waits at most 90 seconds for the installed-engine proofs, then up to four minutes for
each scene. It captures each scene twice using `adb screencap` or `simctl io screenshot`, decodes
both PNGs, and checks the central scene's colour variety and deviation. A flat/blank texture cannot pass this smoke heuristic.
Thresholds (standard deviation 8, at least 32 colours in a 128-pixel sample) only reject flat
output; they do not claim a calibrated lighting tolerance or established repeatability noise floor.
The native log retains GLES/Metal initialization diagnostics and frame readiness. Method-channel
readiness alone is not visual success; image assertions must also pass. There are no retries.

**Comparing** (`hosted.py compare`, measurements in `tools/mobile/parity.py`). The host pulls both
reads (`run-as cat` on Android, the simulator's data container on iOS). It compares each scene with
the web picture of the same frame, resampled to the web canvas's size. Both renderers drew the same
recorded camera, so the same normalised device coordinates land on the same pixel whatever the
target's shape. Each scene is held to `tools/mobile/parity-thresholds.json`:
- **blank:** the native frame must have spread and colours, and must not be mostly the clear colour;
- **noise:** the two reads of one frame must agree (the repeat-noise floor);
- **web:** the mean difference, the worst of an 8×4 grid of regions (the largest difference between
  the two pictures' mean channel values), and the best alignment shift found within 16 pixels.

The device screenshot is evidence that the app was on screen, not what is compared. The iPhone
simulator photographs its portrait frame, so the comparison finds the quarter turn that makes the
screenshot match the drawn frame, and records it.

The artifact contains `manifest.json`, `parity.json`, `commands.log`, native/application logs, the
OS screenshots, the read-back targets, the web pictures and difference images, iOS XCTest results,
and a self-contained `report.html`. The report embeds a thumbnail of each picture as a data URI,
so it opens with no file beside it.
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

#569: the thresholds in `parity-thresholds.json` are provisional until a measured run sets them, and
the regressions they must catch (no Metal depth conversion: blank; a native light or foam change: a
failing region) are to be demonstrated by runs with those changes reverted.

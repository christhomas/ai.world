# Which JavaScript engine runs the game on a phone (#559)

The installed apps run the whole shared TypeScript game in the phone's own JavaScript engine:
`src/mobile/game-engine.ts`, bundled by `tools/mobile/build-engine.mjs` from the same commit as the web
game, with no browser, no network and no other process (`docs/mobile/game-engine.md`). This records
what was measured and what was decided.

## Decision

- **iOS: JavaScriptCore**, the system framework, one context per game on a serial queue.
- **Android: QuickJS 2026-06-04**, pinned by archive and SHA256 (`client/flutter/android/app/src/main/cpp/
  CMakeLists.txt`), compiled `-O2` with `NDEBUG` in every build type.

Both run the whole game unchanged: the world, its jobs, the frame graph, saves and continuing, all from
one bundle. The steady game is fast enough on both. Opening a world, and the first ground arriving, are
not yet fast enough on Android, and the V8 row says why: even with a JIT, opening takes 14 seconds
and the first ground 20 more. The cost is the work itself, the private world, the country and the
ground, which the page runs in Web Workers beside the game and an engine runs in the game's own
thread. So the slow start is not QuickJS's fault, and changing engines would not cure it. The fix is to move the game's ground and country jobs into a second
engine context on their own thread, as the page moves them into Web Workers; the engine is already
built for that split (`chunksInProcess`, `countryInProcess`). Changing engines is held in reserve, and
would only follow if that split does not bring opening under ten seconds on a mid-range phone.

## What was measured

The same bundle, opening seed 3's road country, streaming its ground into the native renderer until 40
meshes had arrived, walking the hero with the stick, reading the drawn frame back and checking the save:

| | V8 (Node, CI runner) | JavaScriptCore (iPhone 16 simulator) | QuickJS `-O2` (Android 35 x86_64 emulator) |
|---|---|---|---|
| bundle evaluated | 140 ms | — | — |
| opening a world (`start`) | 14.4 s | 6.8 s | 39.6 s |
| first 40 meshes of ground | 20.1 s | — | — |
| step, median | 5.9 ms | 22.8 ms | 28.0 ms |
| step, 95th percentile | 347 ms | 289 ms | 738 ms |
| slowest step (the first ground) | — | 5.2 s | 46.6 s |
| meshes drawn / walked | 137 / 7.99 tiles | 439 / 7.93 tiles | 439 / 7.93 tiles |
| frame read back | — | not blank (stddev 35.5) | not blank (stddev 37.2) |

The runs:
- V8: `Portable mobile frame` (`tools/mobile-frame-proof/game.mjs`), runs 38981712344 and 38985973009
  (opening and ground timings).
- JavaScriptCore: `Hosted mobile evidence` run 38978148828.
- QuickJS: run 38982424563.

The installed-game proof (`tools/mobile/native_replay.dart`) logs `HOSTED_GAME_PROGRESS` and
`HOSTED_GAME_READY`, and `hosted.py` keeps them, with the app's memory once the game is loaded, in the
evidence's `installed_game`.

**Debug builds.** Before `-O2`, the hosted debug APK compiled QuickJS at `-O0`. Opening a world then
ran past a one-minute request limit and was interrupted, with nothing measured. A release build would
have been optimised, so the proofs now build the engine as a release ships it.

**The simulator flatters JavaScriptCore.** A simulator app is a macOS process, which may JIT; an
iPhone app's JavaScriptCore may not. The iOS numbers are the best case until #582 measures a phone.

**The Android emulator is an x86_64 CPU under KVM.** A phone's ARM core may be slower or faster;
#582 measures one.

## What the contract needs and whether it holds

| requirement | held by |
|---|---|
| the real game from one bundle, offline | the installed-game proof on both platforms, and the bare-host proof under Node |
| typed arrays, promises and microtasks, timers, JSON numbers, UTF-8, exceptions | `src/mobile/host-globals.ts` installs only what an engine lacks; QuickJS's pending jobs are drained after every call (`state_engine.c`), JavaScriptCore drains its own |
| a job that runs away surfaces as an error, not a hung app | QuickJS: an interrupt handler with a per-request limit (300 s for the game, four times that to create it); the request fails with `InternalError: interrupted` and the Dart side reports it |
| buffers across the bridge | one owned UTF-8 JSON string each way; geometry once per buffer, bounded per packet, released when the scene lets it go (`ScenePackets`) |
| state matches the web | the same source: the bare-host proof plays the bundle the apps play; the renderer parity captures (#569) match the web picture of the same frame |

## Still open

- **Memory.** Read from the next hosted run's `installed_game.memoryKb`, and recorded here.
- **The job split.** Ground and country jobs in a second context on their own thread, so that opening
  and the first ground stop blocking the game's own steps.
- **A physical phone.** #582 measures each platform on one.

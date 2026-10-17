# Installed journeys

The installed game, played by touch on a hosted Android emulator and iPhone simulator (#584). The
renderer replay (`docs/mobile-hosted-verification.md`) proves the native renderers; this proves the
game a player installs.

## The first journey

`client/flutter/integration_test/` drives the production app (`lib/main.dart`, the real `AppShell`).
Every move is a touch on the screen; the tests read the game only to check that a touch did something.

| part | what it proves |
|---|---|
| `journey_test.dart` | a fresh install opens a new offline world; the native renderer's own target is not blank; a thumb on the walk field walks the hero more than a tile, where the game's collision lets it; the pack opens as a book and closes; Options saves and returns to the title |
| `continue_test.dart` | a new launch of the app, after the first was stopped, continues the same hero within half a tile of where he was left |

Each part prints `JOURNEY_STEP {…}` as it passes a step and `JOURNEY_SHOT <name>` where a picture
should be taken, then waits while it is.

## The runner

```sh
python3 tools/mobile/journey.py android    # on a running emulator
python3 tools/mobile/journey.py ios        # makes, boots and removes its own simulator
```

It bundles the game (`tools/mobile/build-engine.mjs`), then runs each part with `flutter test <part>
-d <device>`. Flutter installs the app over itself, so part two is a new process on the same app storage,
and a save that did not survive fails it. Each picture is taken with the OS's own capture (`adb exec-out
screencap`, `xcrun simctl io screenshot`), so the native world is in it.

It writes `journey.json` and a self-contained `journey.html` (pictures embedded, steps, commands and
exit codes) to `$RUNNER_TEMP/mobile-journey`. It exits 0 only when both parts passed **and** said every
step. A part that passed without saying a step fails, because a journey that skipped something has not
proved it. It exits 1 when the game failed, and 2 when the device was not ready, which is not a pass either.

In CI the journeys run in `Hosted mobile evidence` after the renderer frames: on Android on the same
emulator, on iOS on a simulator of their own. They are kept as `mobile-<platform>-journey`.

## Adding a journey

Add a `*_test.dart` under `integration_test/` that uses `journey.dart`'s helpers (`press`, `until`,
`passed`, `shot`), add it to `PARTS` in `tools/mobile/journey.py`, and add its steps to the runner's
expected set. Combat, shops, quests, travel and shared worlds (#584's follow-ups) go here.

## What it does not cover

Physical devices, release signing and store distribution are #580, #581, #582 and #583.

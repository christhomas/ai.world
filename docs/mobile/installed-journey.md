# Installed journeys

The installed game, played by touch on a hosted Android emulator and iPhone simulator (#584). The
renderer replay (`docs/mobile-hosted-verification.md`) proves the native renderers; this proves the
game a player installs.

## The first journey

`client/flutter/integration_test/` drives the production app (`lib/main.dart`, the real `AppShell`).
Every move is a touch on the screen; the tests read the game only to check that a touch did something.

| part | what it proves |
|---|---|
| `journey_test.dart` | a fresh install opens a new offline world; the native renderer's own target is not blank; a thumb on the walk field walks the hero more than a tile, where the game's collision lets it; the pack opens as a book and closes; Options saves and returns to the title; the app is taken down and started again, and Continue brings back the same hero within half a tile of where he was left |

| `crossplay_test.dart` | the app follows an invite into a shared world on a real world server, where a web player is standing, sees their name over their head, and stays until the web player has seen the phone |

Each part prints `JOURNEY_STEP {…}` as it passes a step and `JOURNEY_SHOT <name>` where a picture
should be taken, then waits while it is.

## Meeting a web player (#583)

`tools/mobile/crossplay-web.cjs` builds and starts a world server of its own on port 8787, with
worlds it throws away, and serves the page. It opens a web player in the shared world `seed=7` road
country and says `CROSSPLAY_READY` once that player is in. The runner then runs `crossplay_test.dart`
with the invite as `--dart-define=CROSSPLAY_INVITE=…`: `10.0.2.2` from the Android emulator, which is
how it reaches the machine it runs on, and `127.0.0.1` from the simulator. A debug build may reach a
`ws` world on such an address; a release build may not. The web side records whether it saw the
phone, and takes a picture when it does; the journey passes only when each saw the other.

## The runner

```sh
python3 tools/mobile/journey.py android                 # on a running emulator: the journeys
python3 tools/mobile/journey.py ios                     # makes, boots and removes its own simulator
python3 tools/mobile/journey.py android combat doors    # only the parts named, in that order
python3 tools/mobile/journey.py ios all                 # every part
```

It bundles the game (`tools/mobile/build-engine.mjs`), then runs each part with `flutter test <part>
-d <device>`. Flutter uninstalls the app after each part, storage and all, so a save cannot be carried
from one part to the next: the journey continues its own game, after starting the app again in the
same part. Each picture is taken with the OS's own
capture (`adb exec-out screencap`, `xcrun simctl io screenshot`), so the native world is in it.

Every part is played and reported, so one that fails does not hide what the others found.

It writes `journey.json` and a self-contained `journey.html` to `$RUNNER_TEMP/mobile-journey`. The
HTML has the pictures embedded, the steps, the commands and the exit codes. Exit codes:
- 0 only when every part passed **and** said every step it owes (`PARTS` in the runner). A part that
  passed without saying a step fails, because it has not shown it did anything.
- 1 when the game failed.
- 2 when the device was not ready or a part was named that does not exist. Neither is a pass.

## Where it runs

- **`Hosted mobile evidence`** runs the journeys after the renderer frames. On Android they run on
  the same emulator; on iOS on a simulator of their own. The reports are kept as
  `mobile-<platform>-journey`.
- **`Device playtest`** (`.github/workflows/device-playtest.yml`, #682) is the suite on its own: every
  part, or the parts asked for, on an emulator and a simulator, each job with two and a half hours.
  It runs on demand and every night on main. The reports are kept as `device-playtest-<platform>`.
  It joins the release pull request's checks once every part passes on both phones (#681).

From this machine, which can run neither phone:

```sh
chore device-playtest                    # every part, on this branch's pushed commit
chore device-playtest -- combat doors    # only those
```

That dispatches the workflow, waits for it, and downloads both reports into
`docs/reports/device-playtest/<run>/`.

The runner's own tests (`tools/mobile/test_*.py`) run in `Mobile tools` on any pull request that
touches `tools/mobile/`.

## Adding a part

1. Write a `*_test.dart` under `integration_test/`, using `journey.dart`'s helpers (`press`, `until`,
   `passed`, `shot`).
2. Drive it by touch. Get it where it needs to be through the game's own console, typed by touch, not
   through anything only a test can reach.
3. Add it to `PARTS` in `tools/mobile/journey.py`, with the steps it must say.

The parts the suite is working towards are listed in #681.

## What it does not cover

Physical devices, release signing and store distribution are #580, #581, #582 and #583.

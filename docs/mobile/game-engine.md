# The game in an app's JavaScript engine

Refs #563, #566.

`src/mobile/game-engine.ts` is the bundle an installed app runs: the whole game, on the headless
host (`docs/mobile/game-platform.md`), driven by requests in the shared host contract
(`shared/mobile/host-contract.ts`). `create(session, options)` takes:
- the seed and kind of world;
- the save slot, and what it held when continuing;
- the hero's name;
- the viewport.

The app then sends:

| request | does |
|---|---|
| `start` `local` | opens the game in that slot, against the world in this engine |
| `start` `remote` | opens it against the shared world the `server` option names (#565) |
| `parcel` | what the app's socket to that world did: `open`, a `message` (text, or binary as base64), or `close` with why |
| `step` | moves time on by `dtSeconds`, with the stick (`move` right/forward), the camera turning (`look[0]`: −1 left, 1 right), held guard and run, and one-shot actions |
| `action` | a player action by name (`interact`, `attack`, `inventory`, `close`…), `choose` a conversation row by index, `volume` (`args.level`, nought to one), `zoom` the camera by a pinch's wheel distance (`args.by`, positive is out), `nudge` a row's number (`row:1`, `row:-1`), `read` the roster or the travellers while a page shows them (`roster:village`, `name`, `age`, `purse` or `hunger`, or `company`; no target stops it), `say` a line typed into the console (`args.text`), `take` a carried thing by id, or `stow` a worn slot |
| `lifecycle` | parks the game in the background and resumes it |
| `resync` `scene` | the next step's reply carries the frame |
| `resync` `renderer` | the app's renderer has forgotten what it was sent |
| `resync` `save` | the game saves; the save comes back with this reply, or with a later one if the write finishes after it |
| `dispose` | lets everything go |

The stick becomes the walking keys in the page stick's eight sectors, with its dead zone. Actions
go through `PLAYER_ACTION_KEYS`, so they meet the same bindings and screen guards a key does.

**Each reply** carries what the game has said:
- the HUD presentation;
- the conversation (speaker, words shown, choices, the lit row, an expiring menu's count, and the
  keys of the speaker's and the hero's faces);
- any faces the app has not been sent (`portraits`), each once;
- the journal (`journal`: the hero in a line, errands with where they lead, places found, ferries),
  only when it has changed since the last reply;
- underground, the floor (`floor`, `dungeon/floor-picture.ts`: the seen cells as runs of colour
  with the entrance and the seen chests), when what has been seen of it changes, and `null` once
  the hero is back above ground;
- the sounds the game made since the last reply (`sounds`), each as the voices `game/sound-recipes.ts`
  makes it of, for the app to synthesise and play at the HUD's volume;
- where the engine's time went (`perf`): real milliseconds spent on the private world, the ground
  and the country, each as runs, total and longest, at most every two seconds;
- the roster (`roster`), only while the app has asked to read it and only when it has changed;
- everybody else in this world (`company`), nearest first, read by `src/game/company-view.ts` as the page's travellers list is, only while the app has asked to read it and only when it has changed;
- the map (`map`): its markers, title and whether it is fogged, and the chunks walked and provinces
  charted since the last one sent. New ground goes every time; markers and title go when they
  change, at most once a second, because a ferry's marker moves every step. The map's picture
  (`mapPicture`, `world/map-ground.ts`: the page map's own ground colours and roads at a cell to
  two tiles, sent as runs of colour) goes once, with the first step;
- where the hero is and which way he faces (`yaw`);
- the owner (WORLD or BOOK) and busy mode;
- for a shared world, `link` (`connect` an address, with the connection's generation, or `close`
  it) and `outbox`, the parcels the game sent since the last reply;
- any save written since the last reply, for the app to keep. Every reply can carry one, so an app
  reads it from all of them, `resync` and `action` replies included.

**Time.** An embedded engine has no event loop, so time moves only when a step says so:
`StepClock` runs the world's ticks, the jobs' replies and any page-shaped timers as the step passes
them. `host-globals.ts` installs `performance.now`, timers, `queueMicrotask`, `structuredClone` and
a silent console only where the engine lacks them.

**Shared worlds.** An engine has no WebSocket, so the game's `Online` reaches a shared world
through `ParcelLink`: the app's socket (`NativeWorldSocketLink`) carries the same text and binary
parcels a page's socket does, and the engine and the app hand them across in replies and `parcel`
requests. Every connection has a generation; a socket the game has replaced or closed is fenced on
both sides, so its late news never reaches the connection after it. The app follows the page's
invite links (`?seed=…&server=wss://…`); a release build reaches only `wss` addresses. Named-world
invites, which also carry authored terrain, are refused with a message until the engine takes that
terrain.

**Faces.** `portraits.ts` paints a face with the page's own `paint`, so a portrait in the app is
the same rectangles the dialogue box's canvas is filled with: five numbers a rectangle (x, y,
width, height, colour index), once with the mouth shut and once open. A face is sent the first time
somebody wears it and named by key after that, so the app keeps them for the session.

**Scene.** `ScenePackets` sends a frame with only the geometry the app has not been sent, named by
the graph's own buffers rather than by hashing them. Each packet has a budget of numbers, so
opening a world takes a few steps of arriving ground. A node waits for its geometry rather than
being drawn without it. A geometry no packet has named for four packets in a row has left the
scene, and the packet's `released` list says so; the app's `SceneGeometryCache` lets it go after
resolving that frame, and it is sent again if it ever comes back (#566). The app holds what the
scene holds, however far the hero walks; the bare-host proof keeps geometry the same way and
reports how much it was sent, holds and let go.

**Proof.** `tools/mobile-frame-proof/game.mjs` bundles the engine exactly as the apps do and
plays it in a bare JavaScript context: no window, timers, performance clock, structuredClone,
require or worker. It opens a world, waits for the ground to arrive, walks the hero with the stick,
opens and closes the pack as a book, saves, and records bundle size, load time and step timings.
It runs in the "Portable mobile frame" workflow.

## In the installed apps

`tools/mobile/build-engine.mjs` builds `game.js` and `game-manifest.json` (scope `game`) beside the
hero engine, from the same commit, into the app's assets; nothing is fetched at run time.
`StateEngine.openGame` loads it through the same checked channel as the hero engine, naming the
global `AiWorldGameEngine` and handing it the options.

The native hosts give the whole game more than the hero:

| | hero | game |
|---|---|---|
| memory (QuickJS) | 64 MB | 768 MB |
| a request may take (Android) | 5 s | 300 s; creating, four times that |
| a reply may be | 1 MB | 32 MB |
| a bundle may be | 32 MB | 32 MB |

QuickJS runs every pending promise job after each call, because nothing else will. JavaScriptCore
drains its own when a call returns.

The QuickJS library is compiled with `-O2` and `NDEBUG` in every build type. The hosted proofs
install a debug APK, and a debug build's `-O0` interpreter is several times slower than the one a
release ships, so without this the proofs would measure something no player runs.

The game's time limit is a guard against a runaway request, not a target. QuickJS interprets the
whole game with no JIT; on the hosted emulator, opening a world took longer than the first limit of
60 s. The limit was raised so the proof reports how long things take rather than an interrupt (#559).

**Hosted proof.** After the renderer scenes, the hosted replay (`tools/mobile/native_replay.dart`)
opens the game from the bundled engine on both phones. It streams the ground into the same native
renderer, a packet at a time, until 40 meshes have arrived. It walks the hero with the stick, reads
the drawn frame back, and checks the save the game hands back is the hero's. It logs
`HOSTED_GAME_PROGRESS` after every round of ground, then `HOSTED_GAME_READY` with the opening time,
step median, p95 and slowest step, meshes, packets and distance walked. A game whose ground has not
arrived after ten minutes fails with those measurements, and `hosted.py` keeps the last of them in
the evidence as `installed_game_progress`.
`hosted.py` pulls the frame, refuses a blank one, takes the screenshot beside it, and records all
of it as `installed-<platform>-shared-game-session`.

## Kept on the phone

The private world saves itself through a vault of named strings, as it does in a browser worker.
In the engine that vault is `KeptWorld`: it starts from the records the app kept last time (the
`world` option), and every record the world writes comes back in the next reply's `world` model for
the app to keep. The hero's save comes back the same way.

`GameSession` (`client/flutter/lib/src/game_session.dart`) is the app's side of it:
- It opens the slot's game, continuing it if a save was kept.
- It steps the engine on a ticker with whatever the controls hold, sending a one-shot action once.
- It draws a frame every `sceneEvery` steps.
- It keeps the save (`player` namespace) and the world's records (`world` namespace, at most every
  two seconds) through `CheckpointStore`, in app-private storage. Writes are atomic and the last good
  checkpoint is recovered.
- `save()` waits until both are on disk, and `close()` saves before letting the engine go.

Each slot is its own pair of namespaces, so nothing of one game reaches another. The bare-host
proof reopens the engine from the save and the records it handed back, and finds the same hero
where he was left.

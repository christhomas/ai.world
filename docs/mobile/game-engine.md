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
| `step` | moves time on by `dtSeconds`, with the stick (`move` right/forward), held guard and run, and one-shot actions |
| `action` | a player action by name (`interact`, `attack`, `inventory`, `close`…), `choose` a conversation row by index, `nudge` a row's number (`row:1`, `row:-1`), `take` a carried thing by id, or `stow` a worn slot |
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
- where the hero is;
- the owner (WORLD or BOOK) and busy mode;
- any save written since the last reply, for the app to keep. Every reply can carry one, so an app
  reads it from all of them, `resync` and `action` replies included.

**Time.** An embedded engine has no event loop, so time moves only when a step says so:
`StepClock` runs the world's ticks, the jobs' replies and any page-shaped timers as the step passes
them. `host-globals.ts` installs `performance.now`, timers, `queueMicrotask`, `structuredClone` and
a silent console only where the engine lacks them.

**Faces.** `portraits.ts` paints a face with the page's own `paint`, so a portrait in the app is
the same rectangles the dialogue box's canvas is filled with: five numbers a rectangle (x, y,
width, height, colour index), once with the mouth shut and once open. A face is sent the first time
somebody wears it and named by key after that, so the app keeps them for the session.

**Scene.** `ScenePackets` sends a frame with only the geometry the app has not been sent, named by
the graph's own buffers rather than by hashing them. Each packet has a budget of numbers, so
opening a world takes a few steps of arriving ground. A node waits for its geometry rather than
being drawn without it.

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
| a request may take | 5 s | 60 s; opening, four times that |
| a reply may be | 1 MB | 32 MB |
| a bundle may be | 32 MB | 32 MB |

QuickJS runs every pending promise job after each call, because nothing else will. JavaScriptCore
drains its own when a call returns.

**Hosted proof.** After the renderer scenes, the hosted replay (`tools/mobile/native_replay.dart`)
opens the game from the bundled engine on both phones. It streams the ground into the same native
renderer, a packet at a time, until 40 meshes have arrived. It walks the hero with the stick, reads
the drawn frame back, and checks the save the game hands back is the hero's. It logs
`HOSTED_GAME_READY` with the opening time, step median and p95, meshes, packets and distance walked.
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

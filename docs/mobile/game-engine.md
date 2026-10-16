# The game in an app's JavaScript engine

Refs #563, #566. This is the engine side; the native hosts come next.

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
| `action` | a player action by name (`interact`, `attack`, `inventory`, `close`…), or `choose` a conversation row by index |
| `lifecycle` | parks the game in the background and resumes it |
| `resync` `scene` | the next step's reply carries the frame |
| `resync` `renderer` | the app's renderer has forgotten what it was sent |
| `resync` `save` | the game saves |
| `dispose` | lets everything go |

The stick becomes the walking keys in the page stick's eight sectors, with its dead zone. Actions
go through `PLAYER_ACTION_KEYS`, so they meet the same bindings and screen guards a key does.

**Each reply** carries what the game has said:
- the HUD presentation;
- the conversation (speaker, words shown, choices, the lit row, an expiring menu's count);
- where the hero is;
- the owner (WORLD or BOOK) and busy mode;
- any save written since the last reply, for the app to keep.

**Time.** An embedded engine has no event loop, so time moves only when a step says so:
`StepClock` runs the world's ticks, the jobs' replies and any page-shaped timers as the step passes
them. `host-globals.ts` installs `performance.now`, timers, `queueMicrotask`, `structuredClone` and
a silent console only where the engine lacks them.

**Scene.** `ScenePackets` sends a frame with only the geometry the app has not been sent, named by
the graph's own buffers rather than by hashing them. Each packet has a budget of numbers, so
opening a world takes a few steps of arriving ground. A node waits for its geometry rather than
being drawn without it.

**Proof.** `tools/mobile-frame-proof/game.mjs` bundles the engine exactly as the apps do and
plays it in a bare JavaScript context: no window, timers, performance clock, structuredClone,
require or worker. It opens a world, waits for the ground to arrive, walks the hero with the stick,
opens and closes the pack as a book, saves, and records bundle size, load time and step timings.
It runs in the "Portable mobile frame" workflow.

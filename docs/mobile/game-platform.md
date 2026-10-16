# One game, two hosts

Refs #560, #562, #563.

`game/compose.ts` assembles the whole game: the world, the hero, the rules and the save. It was
`startGame` in `main.ts`. Every surface it used to build out of a browser is now asked of a
`GamePlatform` (`platform/game-platform.ts`):
- the rig the frames go to;
- the panels, as surface types naming only the members the game calls (`HudSurface`,
  `DialogueSurface`, `ChatSurface`, `SoundSurface` and the rest);
- the frame clock;
- the chunk and country jobs, the chunk store and the world link;
- other players;
- joining, visibility and leaving.

**The page** (`platform/browser-game.ts`) answers with the widgets in `index.html`, a WebGL canvas
(`platform/browser-rig.ts`), its workers, IndexedDB and animation frames, exactly as `main.ts` did.

**A host with no page** (`platform/headless-game.ts`) answers with:
- a rig that only records (`RigHost` with no container), so every frame is a `FrameDescription`
  for the host's own renderer;
- a `Presentation` that keeps what the HUD, chat, sound and screen were told;
- the `Conversation` (`ui/conversation.ts`), the same state machine the page's dialogue box now
  draws, so a shop answers the same on both;
- chunks meshed by the same `ChunkMesher` and country grown by the same `answerCountry` the page's
  workers run, each on the host's own turn;
- the private world in the same thread: the same `LocalWorldHost` the page's worker runs;
- a display clock that runs a frame when the host says time has passed.

`platform/headless-game.test.ts` runs `composeGame` on it under Node, with no `window`,
`document`, worker or WebGL. It opens a world, streams and meshes the ground, draws a lit frame,
walks the hero with a held key and saves. `game/portable-frame-imports.test.ts` holds the
composition and the headless host free of browser, Node, worker and GPU-adapter runtime imports.

Still to do:
- the installed app running this inside its JavaScript engine (#563), with the timers and clock
  the engine has to supply;
- durable saves on the phone (#577);
- a shared world over a socket, including other players' bodies and names (#565);
- the native interface reading the presentation (#570 onwards).

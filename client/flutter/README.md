# AI World on the phone

`flutter run` builds the installed game. It opens on a title that starts a new local game,
continues the last one, or lists every game kept on the phone to play or delete (`KeptGames`). The game itself is the shared TypeScript game, bundled into the app as
`assets/engine/game.js` by `node tools/mobile/build-engine.mjs` from the repository root. It runs
in the phone's own JavaScript engine (QuickJS on Android, JavaScriptCore on iOS), behind the Ledger
II shell (`docs/flutter-ledger-shell.md`), and is drawn by the native GLES and Metal renderers.
Saves and the private world's records are kept in app-private storage, so nothing is fetched and
no other computer is involved. See `docs/mobile/game-engine.md`.

Everything somebody says is a conversation in the shared game (`src/game/interact`): talking,
shops, quests, hiring, gifts, shrines, the jail. The app shows them all on the glass with
`ConversationBand`: the speaker's own portrait, painted by the game and sent once, the words, and
the answers as a list of 44px rows of their own, with − and + on a row that carries a number.
While somebody talks the world's controls are parked, as they are on the page.

## The development scene feed

For renderer work only, the app can follow a game running in a desktop browser instead:

Flutter displays the engine's live `FrameDescription`. Its native GLES and Metal renderers receive camera matrices, lights, meshes, instance geometry, coast samples, shadow flags, cutaway state, fog and material intent through `FlutterFramePipeline`. The app opens a WebSocket to a local scene feed. It no longer creates a separate smoke world.

From the repository root, start the game page and the recording feed:

```sh
pnpm vite --port 5173 --strictPort
pnpm exec tsx server/flutter-scene-feed.ts
```

The feed opens a headless browser with `?record-only`, so the complete game loop submits each frame to the recording pipeline without issuing a WebGL draw. The render-layer adapter expands plain prop parts and placements into the same neutral mesh and instance primitives already present in `FrameDescription`. It sends gzip-compressed JSON over `ws://0.0.0.0:8788`. Set `SCENE_SOURCE`, `SCENE_FEED_PORT` or `CHANNEL` on the feed command to change its source, port or browser.

Run Flutter with a reachable feed address. Without `SCENE_FEED_URL` the app never looks for a feed:

```sh
cd client/flutter
flutter run --dart-define=SCENE_FEED_URL=ws://10.0.2.2:8788
```

`10.0.2.2` reaches the host from the Android emulator. Use `localhost` in the iOS simulator, or the host's LAN address on a physical device. The debug Android manifest allows the local cleartext WebSocket; a release build should use `wss://`.

The feed is currently a development and renderer-contract path. It transfers a whole scene about once a second, so Flutter follows the game running in the headless browser and does not yet send player input back. Dense country frames remain large even with compression. Interactive mobile play needs incremental scene transport and a Flutter input/client session.

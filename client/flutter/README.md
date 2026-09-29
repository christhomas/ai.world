# Flutter scene feed

Flutter displays the engine's live `FrameDescription`. Its native GLES and Metal renderers receive camera matrices, lights, meshes, instance geometry, coast samples, shadow flags, cutaway state, fog and material intent through `FlutterFramePipeline`. The app opens a WebSocket to a local scene feed. It no longer creates a separate smoke world.

From the repository root, start the game page and the recording feed:

```sh
pnpm vite --port 5173 --strictPort
pnpm exec tsx server/flutter-scene-feed.ts
```

The feed opens a headless browser with `?record-only`, so the complete game loop submits each frame to the recording pipeline without issuing a WebGL draw. The render-layer adapter expands plain prop parts and placements into the same neutral mesh and instance primitives already present in `FrameDescription`. It sends gzip-compressed JSON over `ws://0.0.0.0:8788`. Set `SCENE_SOURCE`, `SCENE_FEED_PORT` or `CHANNEL` on the feed command to change its source, port or browser.

Run Flutter with a reachable feed address:

```sh
cd client/flutter
flutter run --dart-define=SCENE_FEED_URL=ws://10.0.2.2:8788
```

`10.0.2.2` reaches the host from the Android emulator. Use `localhost` in the iOS simulator, or the host's LAN address on a physical device. The debug Android manifest allows the local cleartext WebSocket; a release build should use `wss://`.

The feed is currently a development and renderer-contract path. It transfers a whole scene about once a second, so Flutter follows the game running in the headless browser and does not yet send player input back. Dense country frames remain large even with compression. Interactive mobile play needs incremental scene transport and a Flutter input/client session.

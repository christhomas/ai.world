# Portable frame and controls (#560)

`src/game/portable-frame.ts` exports the production `createFrame`, camera, input and session lifetime
for embedded hosts. This is the same outdoor, room and dungeon frame called by the browser game;
the gameplay rules have not been replaced with a mobile demonstration loop.

`GameInput` owns held controls, one-shot handlers and per-frame deltas without event listeners.
The browser `Input` extends it and translates keyboard, pointer and touch events. Installed hosts
can supply their controls to the same camera and player. `IsoCamera` requires a logical viewport
provider and uses it for initial zoom, resize, scroll bounds and projection. A surface with no
usable area preserves the last valid camera dimensions; before the first layout the existing
desktop dimensions provide a finite projection.

The frame consumes a `FrameHost` for viewport bounds, automatic-quality notification and fishing
phase presentation. Browser storage and CSS live in `src/platform/browser-frame.ts`. Pointer
coordinates are logical pixels, translated relative to the host surface including its origin;
invalid or outside taps do not pick anything. The browser supplies the canvas bounds. Rendering,
HUD, maps and audio accept their used methods rather than requiring browser canvas or private
widget state on those ports.

The required source suite checks transitive runtime imports from the portable entry. Type-only
declarations are erased; CPU Three.js maths and geometry remain allowed. Browser globals, Node
dependencies, workers, sockets, audio contexts and dynamic imports must be supplied through host
ports rather than added to this runtime graph.

The `Portable mobile frame` GitHub workflow tests real player movement, state time, automatic
saves, fishing, map pause, room/dungeon frame branches, viewport picking and disposal under a
headless host. It also bundles the portable entry and executes its camera, controls and lifetime
in an isolated JavaScript context with no browser or Node host globals. Its artifact retains the
bundle, dependency manifest and observed proof values. These checks do not exercise an installed
app; they cannot stand in for touch-driven Android/iPhone gameplay acceptance.

This is further extraction toward #560. Complete session composition, local scene construction,
UI actions/presentation, world jobs, networking, storage integration and start/load cancellation
still need production host wiring. #563 must embed that session in Flutter. No APK, TestFlight,
offline installed-world or complete mobile feature claim follows from this change. All tests,
bundles and playtests run on GitHub; none run locally.

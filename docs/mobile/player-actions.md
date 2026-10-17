# Shared player action bindings (#560, #562)

`src/game/portable-actions.ts` exposes the existing player bindings and a semantic action catalogue.
Attack, interact, spells, books, dialogue navigation, map actions and the other listed taps run
through the same binding guards used by the browser keyboard. A native caller does not have to
simulate DOM key events or reimplement what a command does. The dispatcher returns whether a
known command was accepted by a live session; the current screen may still suppress its effect.
Unknown IDs and retired sessions are rejected. This catalogue is not the complete targeted item,
shop, quest or multiplayer action/model ABI required by #562.

The browser's minimap tap now uses the semantic map command and therefore follows the same
conversation/text ownership rules as the map key. Held movement/camera controls remain the input
state's responsibility, separate from one-shot commands.

`bindKeys` no longer installs browser lifecycle listeners or schedules photo messages. Its host
supplies liveness and a post-photo notification port. `src/platform/browser-game-events.ts` owns
resize, hide-to-save and deferred photo notices. `src/main.ts` attaches that owner to the existing
session lifetime. Quitting removes the listeners, cancels pending timers and fences callbacks
before renderer/input release. Previously resize and visibility handlers survived quitting, and
a photo timer could announce a save after its session had been discarded.

Regression coverage retains the existing keyboard ownership assertions and adds semantic commands
without browser globals, unknown/retired commands, post-photo behavior, actual browser event
unsubscribe and cancellation/late-delivery fencing. The portable frame entry also exports these
bindings; its import guard and GitHub bundle proof exercise keyboard and semantic attack commands
through the same callback, including retirement fencing. Validation runs on GitHub only. Complete
session composition, installed runtime, native widgets and touch-driven installed acceptance
remain unfinished; these ports do not prove an installable playable app.

## Photographs in the installed app (#578)

More → Photo puts away the HUD and parks held input while the same game and native renderer keep
running. Take and share photo reads `session.pipeline.renderer.snapshot()`, the GLES/Metal target
already used by the installed journeys, and encodes its top-first RGBA pixels as PNG in Dart.
Exit photo, system Back or Escape restores the controls without changing the camera or reopening the game.
Exiting during readback or encoding prevents a late share sheet.

The PNG goes to iOS's `UIActivityViewController` or Android's `ACTION_SEND` chooser. Android grants
read access to one FileProvider URI under `cache/shared-photos/`; files older than a day are removed
on the next share so a receiver can finish reading. iOS removes its temporary file when the activity
finishes and excludes Save to Camera Roll. The app never requests photo-library or storage access.
Cancellation, a denied share, an unavailable renderer or a write failure produces a short message
and leaves the game and shutter available. Android says “Share sheet closed”, because its activity
result cannot prove delivery or distinguish every cancellation; iOS reports the activity's result.

`photo_capture_test.dart` checks the PNG's dimensions, pixel order and colours through mocked native
channels, plus cancellation, denial/failure, retry and retired captures. `photo_controls_test.dart`
and `ledger_shell_test.dart` cover feedback, duplicate taps, exit and persistent-world/input
ownership. RunnerTests covers the iOS file, popover anchor, completion/error cleanup and missing
presenter. These checks run in CI; real sharing targets and physical interruptions still need
device evidence (#582).

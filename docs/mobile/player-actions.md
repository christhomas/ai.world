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
unsubscribe and cancellation/late-delivery fencing. Validation runs on GitHub only. Complete
session composition, installed runtime, native widgets and touch-driven installed acceptance
remain unfinished; these ports do not prove an installable playable app.

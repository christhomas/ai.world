# Owned session lifetime (#560)

`src/game/lifecycle.ts` now owns activation, frame delivery, subscriptions and disposal without
browser or Node imports. A host supplies frame, pause, resume and release callbacks. The world
starts ticking only after the first active notification; an initially hidden host pauses instead.
Repeated activity notifications do not repeat transitions. Disposal fences frame and lifecycle
callbacks before removing subscriptions and releasing the engine. A late subscription is released
immediately. Cleanup attempts every control, link and resource even if an earlier release throws,
and reports collected failures.

The real browser game in `src/main.ts` uses that owner for its existing frame function and loop,
chunk workers, audio, local world link and renderer resources. Visibility observation and title
navigation live in `src/platform/browser-lifecycle.ts`. The visibility listener is attached only
after every callback target exists and is removed with the session. Previously the listener was
never removed and could restart a disposed world's loop and workers during the delay before title
navigation. The browser adapter also observes initial visibility rather than unconditionally
starting a hidden game.

This is a partial implementation of #560, not the production `GameHostSession` ABI or a complete
portable bootstrap. Browser UI/scene composition, viewport picking, worker and asset ports,
prayer reload/randomness, cancellable start/load and installed runtime wiring remain to be
extracted. No installed gameplay or phone performance claim follows from this lifetime owner.

Regressions exercise headless frame fencing, initial inactivity, repeated transitions, callbacks
delivered during disposal, late subscriptions, cleanup failures and the browser listener's actual
removal. All tests, builds and playtests run on GitHub; none were executed locally.

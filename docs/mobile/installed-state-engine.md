# Installed iOS state engine

The Flutter app now owns JavaScriptCore contexts through `StateEngine.open`, `request` and
`dispose`. `tools/mobile/build-engine.mjs` bundles the repository's actual `GameState` and shared
M01 request gate before Flutter packaging. Its manifest records the build's source commit,
contract version and SHA256 of the packaged JavaScript. The native bridge checks the digest
before evaluation. The app reads only its bundled assets; no relay provides executable code.

Every context uses its own virtual machine on one serial dispatch queue. Request arguments and
results cross as owned JSON strings, never `JSValue`. Native UUID generation supplies the game's
identity port. Contexts are limited to four, source to 8 MiB, requests/results to 1 MiB. Disposal
removes the context on its owner queue, and Flutter rejects responses arriving after retirement.
A transport failure retires the Dart owner because its sequence consumption is unknown; callers
must dispose it in `finally` rather than replaying a potentially applied action.

This entry implements hero-state start, inventory equip/unequip/use, idle clock step, lifecycle
parking, resync and dispose. It explicitly rejects world movement, remote start and durable load.
It is a production VM seam for #563, not the complete `GameHostSession`: world transport,
simulation composition, scenes, storage, asynchronous host jobs, Android VM integration and
the installed new-world/walk/interact/save/terminate/continue journey remain unfinished.
The normal Flutter screen still uses the existing scene-feed renderer.

The hosted iOS native replay must run three contexts through the packaged bridge, execute actual
starting-kit actions, verify parked time and reject retired calls before declaring native readiness.
Its existing Metal image assertions remain required. Android continues its renderer proof and
must not be counted as a VM or installed gameplay pass. Dart channel tests cover transport ownership;
TypeScript tests cover the actual game rules. Neither substitutes for the hosted iOS execution.

Build on the hosted runner with `pnpm install --frozen-lockfile`,
`node tools/mobile/build-engine.mjs`, then the normal Flutter packaging command.
Generated assets are ignored and must be rebuilt for each source revision.

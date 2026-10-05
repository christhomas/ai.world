# Installed iOS and Android state engines

The Flutter app now owns native VM contexts through `StateEngine.open`, `request` and
`dispose`. `tools/mobile/build-engine.mjs` bundles the repository's actual `GameState` and shared
M01 request gate before Flutter packaging. Its manifest records the build's source commit,
contract version and SHA256 of the packaged JavaScript. The native bridge checks the digest
before evaluation. The app reads only its bundled assets; no relay provides executable code.

Every iOS context uses its own JavaScriptCore VM on one serial dispatch queue. Request arguments and
results cross as owned JSON strings, never `JSValue`. Native UUID generation supplies the game's
identity port. Contexts are limited to four, source to 8 MiB, requests/results to 1 MiB. Disposal
removes the context on its owner queue, and Flutter rejects responses arriving after retirement.
A transport failure retires the Dart owner because its sequence consumption is unknown; callers
must dispose it in `finally` rather than replaying a potentially applied action.

Android owns a separate QuickJS runtime/context per token on one executor. JNI copies UTF-8 byte
arrays rather than modified UTF-8 Java strings; exception messages use the same byte transport.
The runtime has a 64 MiB memory limit, 1 MiB stack limit and a five-second execution deadline per
evaluation/request. Native UUIDs use the OS entropy source. Activity engine cleanup retires all
owners on their executor before shutdown. CMake builds the same pinned QuickJS 2026-06-04 archive
and SHA256 as the hosted runtime spike. Its license is packaged in Android assets and checked
against the archive at configuration time. This dependency is fetched during hosted compilation,
not by an installed app.

This entry implements hero-state start, inventory equip/unequip/use, idle clock step, lifecycle
parking, resync and dispose. It explicitly rejects world movement, remote start and durable load.
It is a production VM seam for #563, not the complete `GameHostSession`: world transport,
simulation composition, scenes, storage, asynchronous host jobs and
the installed new-world/walk/interact/save/terminate/continue journey remain unfinished.
The normal Flutter screen still uses the existing scene-feed renderer.

The hosted iOS and Android native replays must each run three contexts through the packaged bridge, execute actual
starting-kit actions, verify parked time and reject retired calls before declaring native readiness.
Their existing Metal/GLES image assertions remain required. These narrow VM passes must not be
counted as the complete installed gameplay journey. Dart channel tests cover transport ownership;
TypeScript tests cover the actual game rules. Neither substitutes for the hosted iOS execution.

Build on the hosted runner with `pnpm install --frozen-lockfile`,
`node tools/mobile/build-engine.mjs`, then the normal Flutter packaging command.
Generated assets are ignored and must be rebuilt for each source revision.

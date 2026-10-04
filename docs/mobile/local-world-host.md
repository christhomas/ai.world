# Host-owned offline authority

Refs #560, #563, #564, #577, #579.

`LocalWorldHost` owns one connection to the production `Simulation`. The browser's existing
`sim.worker.ts` now composes it with the worker port, `BrowserVault`, and standard JavaScript
timers. `portable-world.ts` exports the same implementation without importing a browser worker,
socket, storage adapter, or Node filesystem/database implementation.

An installed runtime must supply a `Vault`, a `HostClock`, outgoing parcel delivery, and a close
notification. Timer registration must return cancellation immediately; callbacks run on a later
turn. The clock owns ordinary ticks, clock broadcasts, preparation waits and yields, and world
save debouncing. Capture mode instead accepts the existing explicit `shots-step` messages.

Pause stops ticking and flushes the world. Resume resets its elapsed-time origin. Disposal fences
outgoing and incoming messages before stopping tasks, flushing the world, and detaching its player.
Explicit saves cancel pending debounce writes; cancelled simulation ticks and saves carry a
generation fence so a retained callback cannot modify a reopened world. A failed strict shutdown
flush is reported while the remaining cleanup is attempted.

GitHub exercises real world clock/action persistence through a fresh authority, background/resume,
late callbacks, failed storage, and the production ground authority's movement response. The runtime
spike additionally runs the real shared-world restart in iOS JSC, iOS QuickJS and Android QuickJS,
comparing the restored clock and actions with the reference bundle. That bounded native fixture uses
an in-memory vault and disables ground growth; it is engine evidence, not installed gameplay or
durable device storage evidence.

The installed Flutter session does not yet compose this service. Its durable checkpoint adapter,
world vault transaction/recovery rules, full native timer bridge, and terrain worker ownership remain
to be connected and accepted. Browser workers do not provide `localStorage`; the existing
`BrowserVault` therefore also needs a durable worker storage bridge before a browser worker restart
can be claimed to preserve its world. This extraction does not claim to repair that adapter, preserve
player saves or SQLite-only villager memories, or complete the installed offline acceptance loop.

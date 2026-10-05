# Durable storage for the private world worker

Refs #560, #564, #577, #579. This is partial offline world persistence.

The old BrowserVault attempted localStorage inside a Worker, where that API is unavailable,
and swallowed the resulting absence/failures. It kept the authority only for the tab lifetime.
The browser worker now opens its own IndexedDB database, preloads room/province records before
creating the actual simulation, and queues incoming startup messages in order with a 128-message
limit. Capture workers deliberately retain isolated, forgetful storage and the capture clock.

WorldVault preserves the simulation's synchronous read/write contract through a preloaded map.
Its host storage port supplies asynchronous load/write operations, suitable for browser or native
adapters. Durable writes run in acceptance order. Flush acknowledges only accepted operations and
retains a failed key until a later write to that key succeeds. Load/schema failures refuse to open
a new empty authority. Observed browser write failures close the local link with a storage message.

GitHub regressions cover preload, ordered delayed writes, failure/retry and flush boundaries,
bounded startup queues and retired authorities. A hosted Chromium proof opens the actual simulation
in a Worker, keeps a cleared-mine delta and clock, waits for IndexedDB durability, terminates that
Worker, then restores both in another Worker on the same origin. It verifies localStorage is absent.

This does not complete installed gameplay or native disk storage. The browser's return-to-title path
now awaits an explicit durable acknowledgement before Link.close terminates its worker; see
[session-world-checkpoint.md](session-world-checkpoint.md). A forced browser/process kill can interrupt
a pending transaction. World/player snapshots are not yet one atomic checkpoint. Full iOS/Android fresh-install,
walk/interact/save/terminate/continue acceptance, signing and device evidence remain open.

# Host-owned player saves and exit

Refs #560, #563, #572, #577, #579. This is a partial delivery.

`GameState` accepts identity and wall-time services. Fresh equipment, saved identity, saved-at time
and elapsed offline days use the same production state implementation with those ports. The
browser keeps its existing clock and UUID defaults; embedded hosts inject their own services.

`openTheSave` retains the complete production save assembly and owns ordered writes through
`SaveOwner`. Each request captures independent JSON before a later frame can mutate its objects.
Acknowledged writes use `saveStrict` when the store supplies it. Storage adapters must reject failed
writes; a swallowed adapter failure cannot establish durability. `flush` drains accepted writes and
reports the last request's failure. Disposal fences new writes without canceling already accepted
disk operations; installed hosts await `close` before reopening that slot.

The browser's return-to-title flow now parks the owned session, waits for the strict save and queued
writes, releases it and then navigates. A failed save resumes the game and reports storage failure.
Duplicate exit gestures share one operation. Successful exit disposes the save owner with the rest
of the session.

GitHub regressions cover immutable snapshots, slow ordering, rejection/retry, strict quota errors,
retired writes and delayed exit. A bare-host proof and JSC/QuickJS workloads pack and continue the
real production inventory, equipment, identity, position and clock. This memory-store workload does
not prove physical disk durability or a full game. Existing Flutter checkpoint tests exercise its
separate file adapter.

World-authority persistence, native adapter composition, interruption handling and full installed
offline save/terminate/continue acceptance on both OSes remain open. The browser exit does not yet
await a durable acknowledgement from its world worker.

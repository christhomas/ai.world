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

The browser's return-to-title flow parks the owned session, waits for the strict player save and
queued writes, then awaits a durable checkpoint acknowledgement from its local world worker before
releasing resources and navigating. A failed player save or world checkpoint resumes the game and
reports storage failure so the player can explicitly retry. Duplicate exit gestures share one
operation. Successful exit disposes the save owner with the rest of the session.

GitHub regressions cover immutable snapshots, slow ordering, rejection/retry, strict quota errors,
retired writes and delayed exit. A bare-host proof and JSC/QuickJS workloads pack and continue the
real production inventory, equipment, identity and clock. They separately verify that player
coordinates are saved; they do not exercise position restoration before `Player` construction.
This memory-store workload does not prove physical disk durability or a full game. Existing Flutter checkpoint tests exercise its
separate file adapter.

The browser's local authority now persists through ordered IndexedDB writes and acknowledges its
checkpoint before normal exit. See [the world vault](world-vault.md) and
[session checkpoint proof](session-world-checkpoint.md) for the actual worker terminate/continue
evidence. Player and authority saves remain separate transactions; abrupt termination before the
acknowledgement is outside this guarantee. Native adapter composition, interruption recovery and
full installed offline save/terminate/continue acceptance on both OSes remain open.

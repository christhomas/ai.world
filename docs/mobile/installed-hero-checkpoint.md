# Installed hero checkpoints

Refs #560, #563, #577, #579, #583 and #584. This is a partial delivery.

`InstalledHeroSession` composes the packaged production `GameState` VM with the existing file-backed
`CheckpointStore`. Native hosts supply Android application files or iOS application-support storage.
Scope metadata separates world, seed and local player slots; future checkpoint formats fail without
overwriting the file. The shared production reader restores identity, inventory, equipment and clock.
Starting kit is only applied when the slot is empty.

The owner serializes actions and detached snapshots. Close fences new requests, parks the hero,
awaits the strict file commit and flush, then releases the native VM. A failed commit preserves the
prior checkpoint and restores the app's prior lifecycle state for an explicit retry. Closing twice
shares one operation. A transport or invalid-reply failure retires the engine, so close instead
disposes that owner, releases the slot and rethrows the failure. Reopening restores the last
acknowledged file; an uncertain VM request is never replayed or reported as saved.

Hosted installed Android and iOS proofs exercise the actual packaged VM and app-private file adapter:
unequip, save, mutate, interrupt a later commit, verify the live state and previous slot survive,
retry, release the VM, open a new VM and restore identity and changed equipment. They also exceed
the native request limit, verify retirement and failing close, and reopen the same slot from its
prior file. Existing renderer
and VM-isolation assertions remain required. TypeScript regressions exercise the production reader
with changed health, inventory, day and time, and reject malformed initial snapshots.

This is hero-state persistence, not `SessionSave` or world-authority composition. Player position,
world deltas, scenes, interaction surfaces, app process termination/relaunch, interruption recovery
and the full installed offline new-world/walk/interact/save/terminate/continue journey remain open.
The normal Flutter entry point still uses its scene feed; this owner is used by the hosted installed
acceptance entry point and is available for subsequent production session composition.

# Saving before terminating the local authority

The production browser's return-to-title path parks the session, awaits its owned strict player
save, and then asks the local world link for a durable checkpoint. Only a matching acknowledgement
permits resource release, worker termination and departure. Duplicate exit gestures share one save.
An unavailable authority, storage failure, timeout or replaced connection keeps the session open
and reports the save failure, so the player can explicitly retry.

`WorldCheckpoint` bounds outstanding work to one request and owns its timeout. Correlation ids
increase across retries; old replies and cancelled timeout callbacks cannot settle a newer save.
Closing or failing the browser worker rejects pending saves and fences its queued open callback.
These local control words are separate from the JSON game protocol and never reach shared servers.

The production `sim.worker` handles the request after queued startup messages, calls
`LocalWorldHost.persist()` to strictly stop/save the actual simulation, and awaits `WorldVault`'s
ordered IndexedDB writes before replying. A memory update alone cannot acknowledge persistence.
The portable host accepts an explicit asynchronous storage port; the browser supplies IndexedDB.

GitHub runs the original world-vault proof and an additional proof through the actual `workerLink`
and compiled `sim.worker`: join, change a world delta, await acknowledgement, terminate the worker,
then create a fresh worker and continue the saved world. Its artifact records the tested source
SHA, restored clock and delta. Regressions also delay/fail the actual authority's durable storage,
exercise owned player saves, and verify that resource release waits or the failure remains open.

This composes the partial player-save and worker-world-storage foundations from #612 and #617.
It is not an atomic transaction across player and authority databases, and abrupt OS termination
before acknowledgement remains outside the guarantee. The installed Flutter runtime still needs
real storage ports, session composition and the full new-world/walk/interact/save/terminate/continue
acceptance on both OSes. This does not complete #560, #563, #577, #583 or #584.

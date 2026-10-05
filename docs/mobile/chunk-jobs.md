# Host-driven terrain jobs

Refs #560, #561, #563, #566, #579. This is a partial delivery.

The production browser chunk worker now delegates to `ChunkMesher`. That class owns one bounded
sampler and at most `PATCHES_PER_WORKER` endless patch samplers. It accepts the existing ordered
init/patch/gen/mesh messages and returns the existing geometry, nine-scalar prop stream, collision
tiles and transferable buffers. Disposal clears sampler ownership and rejects later requests.
Initializing another world clears the previous patch cache.

`ChunkManager` accepts a `ChunkJobHost` for worker creation, bounded concurrency and monotonic time.
The default browser adapter preserves the current worker behavior. Both the manager and adapter
reject callbacks after disposal; the manager releases queued jobs and buffered terrain parcels.
An embedded host must preserve init/patch/gen ordering and deliver callbacks after creation returns.
The manager still mounts Three.js geometry: this extraction does not provide a full native scene rig.

GitHub runs real terrain/prop/collision parity, authoritative parcel edits, bounded patch ownership,
and disposal regressions. A bundle proof records the original worker's failure without `self`, then
compares its populated generated and authoritative terrain replies byte-for-byte with the portable
mesher in a bare VM. Native runtime workloads run the same CPU mesher in JSC and QuickJS.

Native thread scheduling, full scene construction, interiors and effects, installed Flutter engine
composition, and cross-platform offline save/terminate/continue acceptance remain open. The native
CPU workload uses a bounded terrain fixture; it is not installed gameplay or a performance claim.

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

## Installed engines

`StateEngine.openGame` now opens `jobs.js` (`AiWorldJobEngine`) beside `game.js`, from manifests naming
the same source commit. Android owns a separate QuickJS runtime and executor for it; iOS owns a
separate JavaScriptCore VM and serial queue. The ground and country share this second context,
with one ground mesher and at most four cached patch samplers. The private world's simulation
still runs in the game context.

`EngineJobs` implements `ChunkJobHost`. It queues the existing `WorkerRequest` messages, each in an
envelope with an owner and sequence, and hands their wire strings to Dart with the game reply.
Dart sends them in order to the jobs context without awaiting them on the game's request queue.
A game step, action or save can therefore finish while a mesh is running. Completed replies are
delivered before a later game request through `deliverJobs`, keeping every game callback on the
game's own thread. The production `ChunkMesher` answers the unchanged `WorkerResponse` protocol.

The bridge carries UTF-8 JSON. Array buffers and typed views travel as base64 bytes with their
element types, so collision parcels retain NaNs and geometry retains Float32 and Uint32 arrays.
Only a view's own bytes cross. A job request or batch of replies is bounded at 16 MiB and a jobs
reply at 32 MiB on both platforms. QuickJS's jobs runtime has a 384 MiB memory ceiling and the
same ten-minute runaway guard as the game; these are ceilings, not measured memory or latency.

Terminating an owner drops its unsent work and fences replies already in flight. Disposing the
game fences Dart's queue immediately and releases both native contexts on their own threads after
their current calls finish. It does not synchronously interrupt an executing job. A failed ground
job or transport is reported on the next game request rather than silently leaving a chunk busy.
Country failure retains the fallback described in `country-jobs.md`. Job CPU timings come back
from the jobs context in the existing `perf.jobs` model.

GitHub runs real terrain/prop/collision parity, authoritative parcel edits, bounded patch ownership,
and disposal regressions. A bundle proof records the original worker's failure without `self`, then
compares its populated generated and authoritative terrain replies byte-for-byte with the portable
mesher in a bare VM. Native runtime workloads run the same CPU mesher in JSC and QuickJS.

The split has protocol, byte parity, ordering, disposal and Flutter transport regressions. Native
delivery is covered in `RunnerTests`. Installed latency and memory after the split still need a
hosted run and the physical-phone measurements in #582; this change makes no performance claim.

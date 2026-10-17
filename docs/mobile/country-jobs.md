# Owned country growth jobs

Refs #560, #563, #579.

The production endless-world Grower now owns a platform country-growth job. Browser construction
uses the same owner through a Worker adapter, and session shutdown disposes the Grower along with
the chunk renderer. Disposal fences replies and requests before detaching listeners and terminating
the job; duplicate or out-of-order replies cannot advance its single active request.

A failed transport retires background growth. Patchwork retains its existing synchronous fallback
for the square underfoot, so a failed optimization does not remove ground. Cleanup attempts both
listener removal and job termination even when either throws.
Optional-background failure callbacks report cleanup errors without throwing into the frame's
underfoot fallback. Explicit session disposal still reports aggregate cleanup failures.

GitHub exercises real generated patch parts, ownership failure paths, and a bundled bare-host
rebuild. These checks prove the shared job boundary and browser cleanup. They do not prove an
installed performance target.

## Installed background growth

An installed game's `EngineJobs.country()` supplies the same `CountryGrowthJob` seam. Its `grow`
requests and `grown` parts cross the native bridge unchanged inside an owned, sequenced envelope.
`AiWorldJobEngine` runs `answerCountry` in the second native engine, on its own executor on Android
and queue and VM on iOS. Ground meshing shares that context, so it holds one CPU job at a time;
neither kind runs on the game thread's step clock. Dart delivers completed replies before a later
game request and never waits for growth as part of that game's request.

Growth exceptions retire this optional background owner through the existing failure callback.
Stopping it fences late replies, drops work not yet handed over, and queues its release. A native
transport failure whose delivery is uncertain surfaces on the next game request. Session disposal
fences all remaining work and releases the jobs context beside the game context. The byte encoding,
limits and disposal behavior are described in `chunk-jobs.md`.

The web's synchronous `Patchwork` fallback still grows a missing square underfoot, and private-world
simulation and initial country construction remain in the game context. Moving background jobs
does not establish an opening-time target. Hosted and physical-phone latency and memory remain to
be measured for #559 and #582.

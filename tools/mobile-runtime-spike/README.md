# Bundled embedded-runtime spike (M02 / #559)

Started 2026-10-03 18:50:06 UTC. Baseline #588 / 186ed805. This is an isolated candidate workload;
no runtime selection or production Flutter hosting is claimed. All commands below run on GitHub
only. No local tests, builds, formatter, simulator, emulator or dependency installation was run.

`workload.ts` imports real GameState, Entity/tryMove/Solids collision, buildChunkMesh, MODELS and
cycleTurn. It equips a sword with actual inventory/equipment rules, steps real calendar and entity
movement 2,000 times, asserts both movement and blocking, meshes a terraced chunk, animates the
actual villager rig, and round trips the actual save. Ten game-state create/dispose cycles must
produce identical state hashes. Rig turns are explicitly quantized to 1e-6 for cross-engine
transcendental variation; terrain Float32 buffers and game state are compared exactly. FNV-1a hashes
are deterministic regression fingerprints, not security digests. SHA-256 identifies the bundle.

The bundle contains source dependencies and checked-in model/property JSON. Vite builds one IIFE
without application bootstrap. Node executes that same IIFE in an isolated vm reference consumer
with no window/document/canvas/Node globals. Native targets execute the downloaded build artifact
(the game's source is bundled offline at execution), not a phone-to-desktop game relay.
`host.uuid`, `now`, `echo` and `report` are native ports; deterministic UUIDs are fixture identities,
not production randomness. `echo` copies canonical Float64 ArrayBuffers native-to-JS. Promise
microtasks, multilingual exception strings, equipment/save/collision/geometry outcomes are asserted.

QuickJS is pinned to the official 2026-06-04 MIT source archive, SHA-256
`b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a`. Official release and
capability documentation: https://bellard.org/quickjs/ and https://bellard.org/quickjs/quickjs.html.
The source archive was fetched only to calculate its digest, never built or executed locally.
Android API 35 x86_64 emulator runs an NDK API 29 release-optimized standalone process. QuickJS
owns one runtime/context on one process thread, 128 MiB heap ceiling, 1 MiB stack and 30-second
interrupt budget. Native copy and step p95 timings, heap and peak RSS are emitted. A real infinite
loop is interrupted, its exception consumed and the same engine executes a recovery expression
and then the complete real-game workload. Ten fresh native runtimes each execute initial and
recovered workloads. Reports include per-cycle source/state/geometry hashes, create/dispose timing,
heap bytes, before/after-dispose RSS and zero pending jobs at disposal. RSS is measured, not gated
as physical-device retained memory evidence. Peak RSS units are platform native (Apple bytes,
Linux KiB). A new iOS simulator QuickJS target compiles and runs the identical C host and archive.
It provides the public interrupt-handler alternative without private JavaScriptCore APIs.

The Apple host uses public JSContext and ArrayBuffer C APIs from the simulator's JavaScriptCore.
Official API: https://developer.apple.com/documentation/javascriptcore/jscontext. JSC is supplied by
the selected Xcode simulator SDK/OS, not a redistributable runtime pinned by this repo; workflow
artifacts record OS/device and the runner image pins the toolchain family. The native process
compiles for the simulator architecture and executes through simctl spawn. It emits resident
memory and native copy/step timings across ten newly created contexts and clears host callbacks
on each completion. It reports its lack of recoverable interruption explicitly. Apple SDK licensing
applies; no JavaScriptCore source is redistributed.

## Hosted commands and evidence

Workflow `.github/workflows/mobile-runtime-spike.yml` builds the bundle and Node reference once,
then executes that exact artifact in each native target and compares deterministic fields:

- `node --test tools/mobile-runtime-spike/compare.test.mjs`
- `node tools/mobile-runtime-spike/build.mjs`
- `node tools/mobile-runtime-spike/reference.mjs`
- `bash tools/mobile-runtime-spike/native/run-ios.sh`
- `bash tools/mobile-runtime-spike/native/run-android.sh`
- `bash tools/mobile-runtime-spike/native/run-ios-quickjs.sh`
- `node tools/mobile-runtime-spike/compare.mjs <reference.json> <native.json>`

Published artifacts retain bundle/digest, reference report, native reports/metrics, iOS devices
and QuickJS license. Hosted success is still pending; authored targets are not executable proof.
This standalone console process is engine evidence, not a Flutter integration or renderer test.

## Pending criteria and decision limits

Do not close #559 or choose a runtime yet. Public JSC recoverable stuck-job cancellation is not
implemented; process/job timeout is only containment, not a recoverable Flutter error. Physical
retained-growth profiling, timers/lifecycle, native-to-Dart
buffer transfer, renderer integration, engine-thread scheduling/CPU profiles, cold engine-start
measurement, supported physical release/profile results and bundled asset API remain pending.
Ten game-state cycles occur within each workload; native cycles now create ten fresh runtimes.
Follow-up started 2026-10-03 19:01:34 UTC against #588 / 36428188. Native byte-copy preconditions
reject invalid buffers; a fixed endian golden parcel must copy independently of mutated source
bytes. Source fingerprints match Node's exact bundle bytes in every native cycle. Emulated console
measurements must not be reported as physical phone or installed gameplay results.

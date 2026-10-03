# Portable installed-game host contract

Status: architecture and executable contract examples for #558 (M01). No production session,
embedded runtime, installed app, or renderer parity is claimed. Baseline: 8086c294 / 0.103.8.

Canonical definitions: `shared/mobile/host-contract.ts` and `binary.ts`. Both language examples
consume `shared/mobile/fixtures/session-v1.json`; Dart mirrors request validation and the gate in
`client/flutter/lib/src/host_contract.dart`. The fixture is data, not generated gameplay.
GitHub must run TypeScript and Flutter suites before describing these examples as validated.

## Scope and dependency boundary

The app bundles the shared TypeScript decisions and simulation. Flutter owns native widgets;
Metal/GLES own drawing. No WebView, companion relay, downloaded script or Dart rewrite of rules.
M02/#559 selects the runtime from measurements. #560 extracts browser services, #561 scene
construction, #562 typed models/actions, #563 app hosting, #564 local authority, #565 direct
remote protocol. ABI version 1 is independent of server PROTOCOL_VERSION 25.
Unsupported ABI is an explicit version error before allocating game resources.

## Requests, results and cancellation

A host creates a unique generation string on every start/load; it never reuses a generation.
Requests carry version, session generation, contiguous sequence beginning at zero, request
ID, discriminant and exact payload. Reject unknown fields/types, nonfinite numbers and unsafe
integers. IDs for actions/entities/items/worlds are stable strings; never encode uint64 IDs in JSON
numbers. `action` args are bounded-depth JSON; #562 defines domain-specific argument validation.
Results carry the same session and request ID; result sequence is a separate contiguous outbound
stream. Exactly one result/error terminates each accepted request. Observed presentation revisions
are monotonically increasing; consumers ignore obsolete revisions and request resync on a gap.
The provided request gate enforces envelope/ordering only, not game execution.

Dispatch accepted requests serially. Cancellation interrupts a pending port operation through the
adapter's cancellation token; it never undoes a committed authoritative action. The cancel request
gets its own result; a cancelled target receives exactly one `cancelled` terminal error. A completed
target cancels as a no-op. Disposal fences the generation immediately, releases subscriptions,
awaits outstanding buffer owners, closes links/audio, and rejects further requests. Late results
from a replaced generation cannot mutate storage, UI or scene. Adapters must bound pending queue
and completed-ID retention. The gate retains at most 4,096 recent request IDs. IDs must not be reused
while pending or within that window; the session sequence rejects all older replayed messages without
retaining them. The executing adapter separately tracks a bounded pending/result-correlation table
and rejects a full queue before accepting a request. Completed ID reuse after the window cannot
make an old message valid, because its sequence is still obsolete.

## Input and presentation

Move/look axes are finite [-1,1] pairs; axes are semantic, not pixels or key codes. Held guard/run
are states; actions are ordered unique edge IDs consumed once per tick. Simulation normalizes the
move vector to avoid diagonal speed gain. Input is parked immediately on focus transition,
lifecycle inactivity, pointer cancellation and session replacement. WORLD accepts gameplay;
BOOK owns page interactions while the world stays live; TYPING owns text. Busy retains reading,
talking and framing separately: dialogue selection/quantity/advance remain presentation actions,
photo shutter stays a framing action, Escape closes the current surface. `parkedInput` clears world
movement, look, held and action edges whenever any surface owns focus. It does not reinterpret
existing gameplay decisions. Native actions must distinguish UI actions from world actions.

Presentation models include HUD, contextual verb/subject IDs, dialogue choices/quantities, pack
and equipment, map records, journal, roster/kin, party/company/chat/trade/mail/stall, options,
photo and loading/error state. #562 owns concrete discriminated domain model payloads. The JSON
model map here is a transport seam, not a claim these player features exist in Flutter.

## Time, buffers and recovery

Simulation ticks begin at zero and advance exactly once; dt seconds is (0,0.1]. Catch-up is bounded
and uses multiple ticks, never a long delta. Render/animation time is one shared monotonic double
in milliseconds supplied by the host clock, independent of simulation tick and wall-clock/date.
Inactive local simulation pauses; remote time resumes from authoritative full state rather than
inventing offline progress. Resume keeps clock epoch monotonic.

Scalar binary parcel: 16-byte header, little-endian uint32 magic 0x4149574d at 0, uint16 ABI 1 at
4, uint16 stride 8 at 6, uint32 count at 8, uint32 reserved zero at 12. Payload is count Float64
scalars, preserving precision; exact byte length required, count <=1,048,576, no NaN/Infinity.
Scene mesh layouts remain the existing native scene ABI; #561/#566 version them explicitly rather
than treating scalar parcels as a geometry format. All byte offsets/strides must be validated.
The sender owns buffers until submission, then cannot mutate/reuse until the submit Promise settles.
Receivers copy when keeping data beyond acknowledgement; no pointer survives runtime disposal.
At most two scene submissions may be outstanding; coalesce only whole presentation snapshots,
never authoritative actions. Binary round trip tests exercise the same high precision fixture.

Full scene uses baseRevision null and atomically replaces geometry, entities and presentation.
Deltas apply only to matching baseRevision. A missing base, dropped scene, renderer reset, link
reconnect or session resume requests resync; reject deltas until a full snapshot completes.
Removal IDs explicitly retire entities/buffers. Storage commits are atomic and errors visible,
never silent success; saves include versioned migrations and whole local authoritative world.
Bundled asset reads never fetch executable code. Remote links use TLS and preserve protocol checks;
the existing player identity/join protocol remains authoritative without a new mandatory login.
Local and remote links both carry JSON strings and binary terrain buffers, deliver replies/events
through subscriptions, and never assume every send has exactly one synchronous reply.
Any future authentication extension belongs to the existing protocol and native secure storage.
Audio respects mute/interruption, capture binds to an
acknowledged scene revision. Port failures produce a typed error and recovery state.

## Proposed support and measurement gates

These are proposed targets, pending #559 and #582 measurements, not verified release promises.
Android: Android 10/API 29+, arm64, GLES 3.0, 4 GiB RAM; reference physical Pixel 4a or equivalent.
iOS: iOS 15+, arm64 Metal, 3 GiB RAM; reference physical iPhone SE 2 or equivalent.
CI touch targets: Android API 35 x86_64 emulator with GLES emulation; iPhone 16 / iOS 18 simulator
with Metal support. Hosted graphics availability must be recorded per run; a missing target is
pending coverage. Landscape 844x390 logical reference; safe areas and minimum 44px targets.
Initial budgets: 30 FPS sustained at supported quality, p95 steady frame <=33.3 ms, resident app
memory <=512 MiB, runtime heap <=128 MiB, <=10% retained growth after ten start/load/dispose cycles,
maximum two scene frames outstanding, bounded queues. Local input should reach the next simulation
tick and visual frame; #582 must measure latency/thermal limits before setting a numeric gate.
Startup shows responsive progress and cancellable error recovery; no unmeasured time guarantee.
Hardware-only: touch latency, thermal endurance, interruption/audio, signing/distribution and real
GPU parity. #580/#581 signing evidence cannot be replaced by simulator captures.

## Hosted verification and outstanding work

User requires all validation on GitHub: no local tests/builds/playtests/dependency installs.
The new tests are not locally executed. Git hooks are suppressed for commit/push to honor that
constraint; required hosted checks remain intact. Headless consumer tests use only ECMAScript
primitives; Flutter fake-session widget uses identical fixture, with no game app wiring.
Executable installed touch scenarios and physical evidence remain #584/#583/#582; renderer replay
#569 does not prove installed gameplay. Domain schemas, runtime cancellation integration,
outbound validation, scene resync execution and full gameplay assertions remain child work.

# Android water formula parity

Refs #568. GLES now uses the production calculations from `src/render/water.ts`:

- `shoreAt` bounds-checks the coast field before choosing distance or open sea.
- `rippleAt` keeps river/lake ripples independent of the coast mask.
- `waveAt` uses two directional trains, square-root shore packing, refraction,
  slow phase wander and depth-dependent shoaling.
- Three samples spaced 1.1 world units apart form the slope normal, with amplitude
  0.045. World-space lighting uses that normal for standing water and the geometry
  normal for waterfalls, with the double-sided face direction applied to both.
- Depth supplies the same shallow/deep tint and alpha as the web. Breaker, wash and
  glint whiten albedo before lighting; sea masks limit foam, and flow masks choose
  waterfall streaks and alpha. The glint threshold remains the web's 1.0..1.7,
  rather than whitening ordinary open-sea ripples.

The existing material blend, depth-write, emissive, Lambert light sums, shadow
ordering, sRGB encoding and fog path continue to consume the resulting albedo,
normal and opacity. No brightness multiplier is introduced.

The shader's coast area is now four channels: origin x/z, inverse span and distance
range. The bridge accepts a `range` field and defaults to the production web
`COAST.RANGE` of 64. Before a valid coast texture arrives, zero inverse span selects
the same open-sea distance without sampling an incomplete texture.

## Hosted verification and remaining contract work

`src/render/android-water.test.ts` invokes the actual web WaterMaterial shader
patch and compares every helper and colour-stage formula with the native code,
allowing only identifier/API changes, declaration placement and numeric formatting.
It also checks normal/opacity linkage, lighting order and four-channel coast upload.
These are formula and wiring regressions, not native pixel acceptance tests.

No local test, build, playtest, simulator/emulator or dependency installation was
run. GitHub must execute TypeScript/Flutter checks and compile/link/runtime-test
the extracted production GLES shader. Fixed-time native/web captures remain needed
for daylight, dusk and night; open sea/shore, river/lake and waterfall; hero point
light present/absent; transparency and double-sided surfaces; and non-water
interior/autumn regression checks.

Two contract gaps remain outside this shader patch. `NativeWorldRenderer.sceneFrame`
currently omits `coast.range` when constructing the method-channel payload, and no
shared render time reaches the bridge. Android instead computes float seconds from
`System.nanoTime()`, whereas web water uses the caller's `WaterMaterial.update(time)`.
The shared frame must carry the actual range and fixed render time before a
controlled capture can establish visual parity. Swift water integration and Metal
runtime verification are separate work. Neither #568 nor #512 is complete here.

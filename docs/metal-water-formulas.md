# Metal water formula parity

Refs #568. This change is stacked on #585's imported-camera/depth/shadow correction.
The camera conversion, winding and shadow-coordinate calculations are unchanged.

The production `waterSurface` helper ports the complete web water calculation:
bounded coast sampling, standing-water ripples, two refracted swell trains,
square-root shore packing, shoaling, finite-difference slope normals, depth tint
and opacity, breaker/wash/glint foam, and waterfall streaks/opacity. Coast sampling
uses linear level-zero lookup; its no-field guard returns the supplied distance
range without sampling. `worldFragment` consumes the resulting albedo, normal and
opacity before the existing Lambert light sums, shadows, sRGB encoding and fog.

The normal is calculated in the native lighting space, world coordinates. Applying
the same camera rotation to both light and normal in the web preserves their dot
product. The Metal front-facing attribute supplies the double-sided face direction;
waterfall faces retain their geometry normal. Material blend/depth-write handling
remains outside this water calculation.

## Native fields for frame transport

The optional method-channel `sceneFrame.renderTimeMs` is a number in milliseconds.
The bridge converts it once to shader seconds; zero is a valid frozen clock. An
absent/nonfinite value preserves the existing native monotonic fallback. Captured
time remains fixed until another scene frame updates it.

The optional `sceneFrame.coast.range` supplies the fourth coast-area channel in
world units, defaulting to the current web range of 64. Dart frame transport still
needs to send both fields. Android's shared clock transport is also pending.

## Hosted verification boundary

Two additional RunnerTests cover the production clock conversion and GPU water
calculation. The water test compiles the complete production Metal library and
dispatches the actual production `waterSurface` with six workloads: zero-depth
shore, its back face, a river, a waterfall, an off-field sea point and missing coast
data with a custom range. It compares known albedo/normal/foam/alpha values, exact
river slope samples, unit/non-flat open-sea normals, and off-field distance range.
Three TypeScript regressions compare full helper/body formulas with the generated
production web shader and check the fragment/time/range wiring.

These tests were authored for GitHub execution. No local tests, builds, playtests,
dependency installations or simulators were run. They are not visual parity proof.
Still required from #569: controlled fixed-time native/web daylight/dusk/night
captures for sea/shore, river/lake and waterfall, with/without the hero point light;
transparency and double-sided capture coverage; and interior/autumn regression
captures. Runtime Metal compilation and numerical results must be recorded from
the hosted runner. #568 and #512 remain open.

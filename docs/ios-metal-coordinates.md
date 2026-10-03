# iOS camera and shadow coordinates

Refs #567. The imported camera projection comes from the web's OpenGL camera. Metal's
clip volume requires `0 <= z <= w`, so the imported projection becomes `D * P`, where
`D` leaves x, y and w unchanged and sets z to `(z + w) / 2`. The scene-frame boundary
performs this once; frame drawing does not mutate or reconvert the stored projection.
Near, middle and far OpenGL depths -1, 0 and 1 consequently become 0, 0.5 and 1.
The recorded hero depth -0.79994 becomes 0.10003. Homogeneous conversion also works
for perspective projections, whose clip w varies with distance.

The native fallback and light projections already use `z = (distance - near) /
(far - near)` and must bypass D. Shadow sampling divides by w, keeps that z, and
uses texture coordinates `(x / 2 + 0.5, 0.5 - y / 2)`. Metal's NDC top is y=+1
and its viewport and texture origins are at the top left. Thus a light-space top
corner samples texture y=0; applying the old `xyz * 0.5 + 0.5` both reflected
that lookup vertically and compared depth 0.5 at the native near plane.

Both draw passes explicitly select counterclockwise front faces to match the mesh
index convention. For the untransformed XY triangle `(0,0), (1,0), (0,1)`, the
cross product is +Z and its signed NDC area is positive. The depth conversion
preserves that area because it changes no x, y or w. Front, back and double-sided
materials retain back, front and no culling respectively. This is a convention
fix, not proof that it explains the missing interior floor and counter.

Negative-determinant world/instance transforms reverse triangle area. The Dart
scene-frame packer currently bakes such transforms into vertices while retaining
raw indices; correcting that requires transform-aware index handling before the
Swift bridge, which receives no model matrices. Mirrored instances remain a
separate pending criterion; changing one global winding cannot correct a mesh
containing both mirrored and ordinary instances.

Apple's [Metal coordinate and culling documentation](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Render-Ctx/Render-Ctx.html)
defines the depth, viewport origin and explicit winding state used here.

## Verification boundary

RunnerTests exercises the production Swift projection functions and compiles the
complete production Metal library. Its compute test executes the production
shadow-coordinate function for both corners, the centre, and out-of-range depth.
The TypeScript contract suite checks that these functions remain wired at their
intended boundaries. These tests were authored without running local tests,
builds, dependency installation or simulators; execution belongs on GitHub.

Still required: production-feed native before/after interior captures with
controlled culling A/B; front/back/double-sided and mirrored geometry captures;
autumn daylight shadows and cutaway; night water; landscape framebuffer/Flutter
Texture resize and orientation captures. No native visual result is claimed,
and #567 remains open. Physical-device evidence remains part of M25.

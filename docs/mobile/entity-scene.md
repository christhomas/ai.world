# Production creature scene buffers

Refs #560, #561, #563, #566.

`createEntityScene(graph, view)` runs the existing creature renderer's geometry grouping,
animation, tinting, culling, disassembly and health-bar production without constructing a browser
rig or GPU context. It publishes the same bounded instance arrays into SceneGraph. Browser surface
and interior assembly keep mounting that same producer through `entities-mount.ts`.

The producer still uses Three's CPU scene, geometry, matrix and material records internally. This
change removes the browser assembly dependency; it does not replace those CPU records or provide
an installed native draw loop. Disposal fences late add/update calls and removes owned graph nodes.

GitHub checks existing renderer tests, compares all used buffers with the original production
algorithm in a bare host, and runs a bounded creature-buffer workload on all embedded runtime
targets. Cross-runtime hash channels are quantized to four decimal places to tolerate math-library
differences; the same-host original/portable comparison is exact. Native rendering and full
installed offline new-world/walk/interact/save/terminate/continue acceptance remain incomplete.

# Portable scene state and daylight

Refs #560, #561, #563, #566, #579. This is a partial delivery.

`SceneState` constructs the production surface's neutral lights, fog, sea and deep-water geometry
without creating a canvas, renderer or GPU context. The browser scene rig uses those same nodes;
its Three.js bridge mounts retained nodes without replacing their IDs or adding duplicate entries.
Water transforms and render time remain properties of the owned graph.

`Daylight` is the production daylight calculation with an injected monotonic clock and neutral
light/graph ports. It retains seasonal sky and sun color, rain dimming, moonlight, carried fire,
window glow and shadow refresh decisions. `DayCycle` mounts its exact linear window color on the
browser's existing glow material. Disposal fences later portable daylight updates and releases the
browser material once through session shutdown.

GitHub compares the original daylight at `5983e649bcafef870f43dc98107b0e5cfd969a89` across
48 season/weather/time fixtures with the portable module,
records its previous missing-browser-clock failure, and checks bare-host execution. Source
regressions cover populated sea geometry, retained node IDs, unclamped autumn light, shadow timing,
material color equality and disposal. JSC/QuickJS workloads evaluate deterministic production graph
and light records. Required browser captures/playtest verify the mounted game remains equivalent.

This does not yet compose the full native terrain/prop/entity scene or the installed Flutter game.
Native coast sampling, place transitions, complete effects, scheduling and save/terminate/continue
acceptance remain open. The native CPU graph workload is not a device renderer or full playtest.

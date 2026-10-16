# Shared production Player opening

Refs #560, #563, #572, #577. This is partial session composition.

`openPlayer` now owns the browser's existing hero/camera initialization and is
available to installed hosts. A saved hero position takes precedence over a fresh
world's nearest village; a host start request takes precedence over both. Saved
camera rotation and zoom are restored separately, so saved camera targets cannot
replace the hero's coordinates. Countries without villages retain the origin
fallback. The browser parses its query parameters before calling the same factory.

The real `Player` requires only the renderer's entity-attachment port during
construction. Its movement, grounding, camera follow and collision logic remain
the production implementations. The browser continues to supply its entity
renderer; an installed session must supply its own owned attachment adapter.

GitHub regressions cover actual generated road/endless openings, saved and
overridden coordinates, camera settings, empty countries and saves without a
player. Bare-host and JSC/QuickJS proofs construct the actual Player and camera,
walk under real shared input, capture coordinates, and reopen another Player at
those coordinates. Their terrain/render ports are CPU fixtures. They do not
establish disk persistence, renderer output, offline world composition, signing
or the full installed new-world/save/terminate/continue journey.

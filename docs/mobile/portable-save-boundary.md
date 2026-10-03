# Portable save boundary (#560 prerequisite)

`src/save/store.ts` now declares the existing SaveStore/SessionSave/WorldKind data boundary and
world-kind interpretation without importing a browser backing store. Embedded hosts import it
without loading IndexedDB, game-state implementations, renderer code or Node packages.
All game-state/manifest/nemesis/roaming dependencies remain type-only. Existing nested mount,
boat, equipment, world-manifest, sky, calendar and legacy fields retain their original types.

`src/save/indexeddb.ts` is the browser adapter. `boot.ts` and `main.ts` import IndexedDbStore from
there, while portable interfaces and data keep their established store.ts path. No compatibility
re-export remains to pull browser code into the portable boundary. The class implementation is
relocated unchanged: load failures return undefined, save/remove remain best effort, saveStrict
propagates its error. Slot keys, save payloads and legacy interpretation are unchanged: missing or
unknown world means endless; road and historical mesh map to road.

New regressions traverse actual production import/re-export/dynamic-import AST edges and reject
transitive external or host-global access. A negative nested import proves the graph guard catches
browser backing stores; a headless dynamic import executes kindOf with browser globals removed.
Typed save fixtures cover current/legacy records, including mounted/boat state and sky restoration.
Adapter mocks verify exact library calls and failure policy. These are authored tests, pending
GitHub execution. Per explicit user instruction, no local tests/builds/formatters/installations,
emulators or playtests ran; commit/push hooks are disabled to preserve hosted-only validation.

This is a partial Refs #560 change, stacked on #588. Session/bootstrap composition, job/link/audio/
asset/lifecycle services, loading cancellation, disposal and web gameplay through the extracted
session remain open; this change does not claim a portable game session exists.

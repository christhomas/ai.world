# Human Code report — 2026-09-03

**Scope:** `src/` (whole engine).
**Found:** 17 items. **Fixed:** 13. **Skipped:** 4.

A generation fingerprint test (`src/world/golden.test.ts`) was added before refactoring. It hashes the
road graph, rivers, structures, four chunks' tiles/meshes and the quest list for two seeds. Every
change below kept those hashes identical, so no refactor altered any generated world.

## Changes made

### 1. Seed salts scattered as hex literals (High)
- **Files:** `src/core/salts.ts` (new); `graph.ts`, `terrain.ts`, `rivers.ts`, `structures.ts`, `quests.ts`, `manager.ts`, `minimap.ts`, `main.ts`, `mesher.ts`, `chunkgen.worker.ts`
- **What changed:**
  ```ts
  // before (three different files)
  new Simplex2D((graph.seed ^ 0x7e7e) >>> 0)
  // after
  new Simplex2D(derive(graph.seed, SALT.BIOME))
  ```
- **Why it's better:** eleven random streams were identified by magic hex numbers; the same one (`0x7e7e`) appeared in three files with no hint it had to match. Names say what each stream feeds and the shared one is now shared on purpose. Per-tile hash salts (`3`, `7`, `8`, `11`, `21`–`24`) got the same treatment in `TILE_SALT`.

### 2. Cell/chunk key arithmetic duplicated (Medium)
- **Files:** `src/world/spatial.ts`, `graph.ts`, `chunkManager.ts`, `manager.ts`, `minimap.ts`, `state.ts`
- **What changed:**
  ```ts
  // before, in two grids
  (cx + 32768) * 65536 + (cz + 32768)
  // and `${cx},${cz}` / key.split(',').map(Number) in four places
  // after
  cellKey(cx, cz)   chunkKey(cx, cz)   parseChunkKey(key)
  ```
- **Why it's better:** one definition of what a chunk key looks like; the 16-bit offset trick is explained once.

### 3. `$` DOM helper defined three times (Low)
- **Files:** `src/ui/dom.ts` (new); `hud.ts`, `title.ts`, `main.ts`
- **Why it's better:** one typed, throwing helper instead of two throwing and one non-null-asserting variant.

### 4. Dead exports (Low)
- **Files:** `save/store.ts` (`SESSION_KEY`), `biomes.ts` (`pickProp`), `terrain.ts` (`Probe.water`)
- **Why it's better:** readers no longer wonder who uses them.

### 5. Gameplay magic numbers in `main.ts` (Medium)
- **Files:** `src/core/config.ts` (`GAMEPLAY`), `main.ts`
- **What changed:** `2.8`, `4.5`, `7`, `3`, `10` became `TALK_RANGE`, `CLICK_TALK_RANGE`, `POI_DISCOVER_RADIUS`, `AUTOSAVE_SECONDS`, `KO_GOLD_LOSS`.

### 6. Creature behaviour numbers (Medium)
- **Files:** `src/entities/entity.ts` (`BEHAVIOUR`), `manager.ts` (`SPAWN`)
- **What changed:** flee radius (which appeared as `3.5 * 3.5`), stalk radius, bite range/cooldown, arrive distance, herd drift, turn rate; spawn chances, minimum tile counts, leashes and scatter radii.
- **Why it's better:** tuning the world's life is now one table per file instead of a hunt through a state machine.

### 7. `DayCycle.apply` took seven positional numbers (Medium)
- **Files:** `src/render/daycycle.ts`, `main.ts`
- **What changed:** `apply(time, x, z, hx, hy, hz, lantern)` → `apply({ time, focusX, focusZ, heroX, heroY, heroZ, lanternOn })`.

### 8. `generateRoadGraph` was one 215-line function (High)
- **Files:** `src/world/graph.ts`
- **What changed:** split into `scatterAttractors`, `seedHub`, `grow`, `sprout`, `pickTowns`, `growTownWebs`, `accumulateSubtreeSizes`, `assignLevels`, `buildEdges`, `addLoops`; ~25 literals named in `GROWTH`.
- **Why it's better:** the algorithm reads as its steps. The RNG call order is unchanged (fingerprint identical).

### 9. Mesher: four copy-pasted wall calls with a 10-parameter lambda, four copy-pasted waterfall calls (High)
- **Files:** `src/world/mesher.ts`
- **What changed:**
  ```ts
  // before
  wall(me[1], me[2], nb[0], nb[3], wx + 1, wz, wx + 1, wz + 1, 1, 0);
  wall(me[0], me[3], nb[1], nb[2], wx, wz, wx, wz + 1, -1, 0);
  ... (×4, then ×4 again for falls)
  // after
  for (const side of SIDES) { ... side.mine, side.theirs, side.a, side.b, side.nx, side.nz ... }
  ```
  A `SIDES` table documents corner numbering once; `ChunkView` hides apron index arithmetic; `topColor` and `slopeNormal` are named. Colours travel as `RGB` tuples instead of three parameters.

### 10. `TerrainSampler.generateChunk` 116 lines + `stampStructures` 74 lines (High)
- **Files:** `src/world/terrain.ts`
- **What changed:** `sampleGrid` / `despeckle` / `rollProp`; `stampPlaza` / `stampFootprint` / `stampPath` / `stampCentreProp` / `stampSingleProp` with `localIndex`/`interiorIndex`. The bridge deck lift `0.14`, which was computed in two places, is `BRIDGE_DECK_LIFT` computed once (height now carried in the grid).

### 11. `buildVillage` 90 lines mixing church, houses, stalls, shops (Medium)
- **Files:** `src/world/structures.ts`
- **What changed:** `placeChurch`, `placeStalls`, `assignShops`, `shopCount`, `facing`; layout literals in `LAYOUT` (attempt counts, offsets, spacings, per-settlement size presets).

### 12. `EntityManager.spawnChunk` 98 lines (Medium)
- **Files:** `src/entities/manager.ts`
- **What changed:** `sortTiles`, `tileCentre`, `spawnHerd`, `spawnVillageFolk`, `place` as a method with a `SpawnCtx`.

### 13. `EntityRenderer.update` switch inside a matrix loop; `updateEntity` idle/flee blocks (Medium)
- **Files:** `src/entities/pool.ts`, `src/entities/entity.ts`
- **What changed:** `partRotation(role, e, swing)` returns the Euler triple; `startFlee`, `chooseIdleAction`, `WANDER_RADIUS` table replace the nested ternary `prowl ? 8 : travel ? 7 : hopper ? 2.5 : 4`.

## Items skipped

| Item | Reason |
|---|---|
| `MeshBuilder.quad` takes 8 positional arguments | Acceptable pattern — hot path called per face; a params object would allocate per call |
| `startGame` in `main.ts` is ~200 lines | Acceptable pattern — linear wiring with named callbacks; splitting adds indirection without a second reader |
| `animals.ts` is 490 lines of rig data | False positive — it is a data table, not logic |
| Perpendicular-offset math repeated in `rivers.ts` and `structures.ts` (`-uz, ux`) | Below threshold — two sites, three lines each |

## Test results

| | Before | After |
|---|---|---|
| Tests passing | 15 | 22 |
| Tests failing | 0 | 0 |
| New tests | — | `spatial.test.ts`, `entity.test.ts`, `golden.test.ts` (generation fingerprint), quest flow in `talk.test.ts` |
| Typecheck (`tsc --noEmit`) | clean | clean |
| Generation fingerprint (2 seeds × 5 hashes) | recorded | identical |

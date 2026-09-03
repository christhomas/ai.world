# Human Code report — 2026-09-03 (second pass)

**Scope:** `src/` (whole engine, after islands, ferries, dungeons, combat, seasons, equipment,
the full-screen map and building interiors landed).
**Found:** 11 items. **Fixed:** 8. **Skipped:** 3.

The generation fingerprint (`src/world/golden.test.ts`) guarded every change again: it still
matches, so no refactor altered a single tile of a generated world.

## Changes made

### 1. Instanced prop drawing written three times (High)
- **Files:** `src/render/instancing.ts` (new); `world/chunkManager.ts`, `dungeon/scene.ts`, `interior/scene.ts`
- **What changed:**
  ```ts
  // before, in three files, each with its own matrix/quaternion scratch and glow twin
  const inst = new THREE.InstancedMesh(geo, this.props.material, list.length);
  list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot); m.compose(...); inst.setMatrixAt(i, m); });
  const glowGeo = this.props.glows.get(kind);
  if (glowGeo) { const glow = new THREE.InstancedMesh(...); glow.instanceMatrix.copy(...); }
  // after
  addPropInstances(group, props, instances, glowMaterial);
  ```
- **Why it's better:** chunks, dungeons and interiors all draw the same prop library; now they
  draw it the same way, and the glow pairing cannot drift between them. `disposeInstances` gives
  them one way to clean up too.

### 2. Buffer geometry assembled by hand in four places (Medium)
- **Files:** `src/render/instancing.ts`, `world/chunkManager.ts`, `dungeon/scene.ts`
- **What changed:** the five `setAttribute` calls plus index and bounding sphere became `meshFromData(data, material)`.

### 3. `main.ts` carried the dungeon and interior lifecycles inline (High)
- **Files:** `src/game/places.ts` (new), `src/main.ts`
- **What changed:** 220 lines of closures (enter/exit dungeon, chest opening, enter/leave building,
  keeper placement, interaction reach) became a `Places` class holding "where the hero is": outdoors,
  underground or indoors. `main.ts` fell from 825 to 689 lines and now reads as wiring.
- **Why it's better:** the three-way switch between worlds — swapping the tile world under the
  hero, moving them between entity renderers, saving and restoring camera zoom — is one thing in
  one file, instead of two sets of near-identical closures a screen apart.

### 4. Shape-building machinery mixed into the prop catalogue (Medium)
- **Files:** `src/render/geometry.ts` (new), `src/render/props.ts`
- **What changed:** `part`, `merge`, `prism`, `house`, `church` and the window specs moved out.
  `props.ts` is now purely "what things look like" (500 → 379 lines).

### 5. `generateInterior` was a 99-line switch (Medium)
- **Files:** `src/interior/generate.ts`
- **What changed:** one furnisher per trade in a `FURNISH` table, each taking a small `Furnishing`
  toolkit (`put`, `layCounter`, `floor`). Adding a bakery is now adding one entry.

### 6. The keeper's spot was hand-computed beside every counter (Medium)
- **Files:** `src/interior/generate.ts`
- **What changed:** `layCounter` returns the tile behind the counter's middle, so the counter and
  the person behind it can never disagree. Previously four `keeper = [Math.floor(w / 2), 2]` lines
  quietly assumed the counter's position.

### 7. The HUD block was repeated in all three loop branches (Medium)
- **Files:** `src/main.ts`
- **What changed:** hearts, clock, errands, area and toasts became `updateHud(dt, area, weather?)`.

### 8. Combat constants outlived their use (Low)
- **Files:** `src/game/combat.ts`
- **What changed:** `COMBAT.FIST`/`COMBAT.SWORD` went away when damage started coming from the
  equipped weapon; the stale constants went with them.

## Items skipped

| Item | Reason |
|---|---|
| `props.ts` catalogue is still a 359-line constructor | Acceptable pattern — it is a declarative catalogue, three to ten lines per entry; the logic is now next door in `geometry.ts` |
| `animals.ts` (555 lines) | False positive — a data table of rigs, same as above |
| `structures.ts generateStructures` is still long | Below threshold this pass — it is already split into named closures (`placeHouse`, `buildVillage`, `placeChurch`, `placeStalls`, `assignShops`); another split would only move parameters around |

## Test results

| | Before | After |
|---|---|---|
| Tests passing | 51 | 51 |
| Tests failing | 0 | 0 |
| Typecheck | clean | clean |
| Generation fingerprint | matches | matches |
| `main.ts` | 825 lines | 689 lines |
| Largest render file | `props.ts` 500 | `props.ts` 379 |

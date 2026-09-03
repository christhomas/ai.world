# AI World

![Screenshot](ai.world.jpeg)

**[Play Now](https://christhomas.github.io/ai.world)**

A procedurally generated low-poly isometric world that runs in the browser. Every world is derived from a single seed: roads grow outward from a central hub as an organic tree, towns grow their own local road webs, walkable land only exists near those roads, and the rest is open sea. Six biomes radiate from the hub, each with its own ground palette, cliffs, foliage, animals and building style. Rivers carve terraces into waterfalls, villages have squares with a well, market stalls, a church and shops, and you walk it all as a small hero who can talk to everyone.

## Controls

| Key/Action | Description |
|------------|-------------|
| **W A S D / Arrows** | Walk |
| **Enter / Space** | Talk to the nearest creature or villager (click also works) |
| **Up / Down, Enter** | Move through and pick dialogue choices |
| **Q / E** | Rotate camera |
| **Scroll Wheel** | Zoom in/out |
| **M** | Toggle minimap between local zoom and whole world |
| **F** | Free camera (WASD / drag pans the camera instead of walking) |
| **N** | New world (new seed) |
| **O** | Options panel |
| **Escape** | Close dialogue/options |

URL parameters: `?seed=123` loads a specific world, `&x=100&z=-50` starts the hero at a world position, `&cam=free` starts in free-camera mode.

## What's in the world

- **Six biomes** in warped sectors around the hub: meadows, woods, dunes, marsh, highlands, snow. Each has its own palette, terrace roughness, foliage table (oaks, pines, cacti, palms, reeds, flowers, mushrooms, lilies…) and house style.
- **Rivers and lakes.** Rivers start beside highland roads, follow the corridor downstream, and only ever step down, so every terrace they cross is a waterfall. Roads cross them on bridges. Rivers that run out of land end in lakes.
- **Animals in groups.** Cows, sheep, horses and chickens in the meadows; deer, rabbits, foxes and bears in the woods; camels, lizards and vultures in the dunes; frogs, ducks and herons in the marsh; goats, eagles and wolves in the highlands; hares, wolves and elk in the snow. Prey flee from you, fliers circle, ducks stay on water.
- **Towns and villages.** Nine towns act as secondary hubs with their own road webs; smaller villages sit on wide branches. Every settlement has a square with a well and market stalls, a church with a congregation, houses with door paths, and two to four shops (general store, blacksmith, inn, apothecary) with a keeper at the door.
- **Talking and trading.** An RPG-style dialogue box with typewriter text and choices. Shopkeepers sell items for gold (you start with 50); gold and inventory persist with the save.
- **Points of interest.** Shrines, ruins, watchtowers, campsites and giant trees off the road. Walking up to one names it, flashes a discovery banner, and marks it on the minimap.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest: rng, noise, road graph, terrain, mesher
pnpm build      # typecheck + production build into dist/
```

Deployment is a GitHub Action (`.github/workflows/deploy.yml`) that builds `dist/` on every push to `main` and publishes it to GitHub Pages. The repository's Pages source must be set to **GitHub Actions**.

The original single-file prototype is kept at `legacy/index.html` for reference.

## How the world is built

**Seeded everything.** `src/core/rng.ts` provides a seeded PRNG and a coordinate hash. `Math.random` is only used to pick a brand-new seed. A seed reproduces the whole world, so nothing about the terrain is stored; only the session (seed, camera) is persisted in IndexedDB through the `SaveStore` interface in `src/save/store.ts`.

**Road graph** (`src/world/graph.ts`). A space-colonisation tree grown in continuous 2D: attractor points are scattered over a disc and thinned by noise so some regions stay empty; each attractor pulls its nearest road node, nodes grow toward the pull, and attractors die once reached. Nearby nodes on different branches are joined into loops. Subtree size sets the road's width and the width of land around it.

**Terrain** (`src/world/terrain.ts`). For every tile the sampler finds the nearest road segment. Distance to the road decides sea vs. land, road vs. ground, and how many terraces rise away from the road (scaled by the biome's roughness). Biomes are noise-warped angular sectors around the hub; the hub itself is always plains.

**Mesh** (`src/world/mesher.ts`). Each 16×16 chunk becomes one flat-shaded, vertex-coloured mesh: a top quad per tile and cliff walls wherever a neighbour is lower. Road tiles carry per-corner heights so slopes are true ramps. No textures anywhere. Props (trees, rocks, cacti…) are primitive-built geometries drawn with `InstancedMesh`, one draw call per kind per chunk.

**Hydrology and structures** (`src/world/rivers.ts`, `src/world/structures.ts`). Both are generated once from the road graph inside the terrain sampler, so every worker and the main thread agree. Structures are stamped onto chunks after raw sampling: yards flattened, door paths laid, the building placed as an instanced prop with a fixed rotation.

**Creatures** (`src/entities/`). Every animal and character is a handful of primitive parts. Each (kind, part) pair is one `InstancedMesh`; animation rewrites instance matrices, so forty sheep cost the same draw calls as one. Herds spawn per chunk from the seed and despawn when you leave. The hero is just another entity driven by the keyboard.

**Streaming** (`src/world/chunkManager.ts`). Chunks within a radius of the camera are generated in a Web Worker pool (`src/workers/chunkgen.worker.ts`) and uploaded as ready; chunks far from the camera are disposed. Chunks with no land are skipped before any mesh work, so cost tracks the walkable area rather than the map's bounding box.

### Layout

```
src/
  core/        config, seeded rng, game loop, input
  world/       noise, biomes, road graph, rivers, structures, terrain sampler, mesher, chunk manager
  workers/     chunk generation worker
  render/      scene rig (lights, shadows), water material, isometric camera, prop + building geometry
  entities/    animal/character rigs, instanced renderer, behaviours, spawning, player
  game/        shops, inventory, dialogue trees
  ui/          hud, dialogue box, minimap, styles
  save/        persistence interface + IndexedDB implementation
  main.ts      bootstrap
```

### Tunables

`src/core/config.ts` holds the knobs: chunk size, terrace step, water level, view radius, road-graph density (`ATTRACTOR_SPACING`, `INFLUENCE`, `KILL`, `STEP`), world radius, town count and spacing, river and lake counts, and camera speeds. Biome palettes and prop tables live in `src/world/biomes.ts`; animal rigs and spawn tables in `src/entities/animals.ts`; shop stock in `src/game/shops.ts`.

## Roadmap

1. ~~Foundation: modules, seeded generation, road graph, streaming, terraced mesh, ramps, water.~~
2. ~~Rivers, lakes, waterfalls, animated water, richer foliage.~~
3. ~~Animals in herds, player avatar with follow camera.~~
4. ~~Towns, villages, churches, shops, dialogue, points of interest, discovery.~~
5. Next: smoother biome borders, quests and items that do something, day/night, sound.

## Technology

- **Three.js** — rendering (orthographic isometric camera, PCF shadows, vertex-coloured Lambert materials)
- **TypeScript + Vite** — modules, workers, build
- **Vitest** — unit tests for the pure generation code
- **idb-keyval** — IndexedDB session persistence

## License

MIT

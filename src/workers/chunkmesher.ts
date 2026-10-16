import { WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { rebuildPatch } from '../world/endless';
import { TerrainSampler } from '../world/terrain';
import { buildChunkMesh } from '../world/mesher';
import { tilesOf } from '../world/tiles';
import { PropKind } from '../world/biomes';
import { unpackChunk } from '../world/chunkparcel';
import { PATCHES_PER_WORKER, type WorkerRequest, type WorkerResponse } from '../world/messages';

/** Production chunk CPU jobs, owned by one session and independent of worker globals. */
export class ChunkMesher {
  private whole: TerrainSampler | null = null;
  private readonly patches = new Map<string, TerrainSampler>();
  private disposed = false;

  constructor(private readonly post: (reply: WorkerResponse, transfer: Transferable[]) => void) {}

  dispose(): void { this.disposed = true; this.whole = null; this.patches.clear(); }

  receive(msg: WorkerRequest): void {
    if (this.disposed) return;
    if (msg.type === 'init') {
      this.patches.clear();
      this.whole = new TerrainSampler(msg.graph, { hydro: msg.hydro, structures: msg.structures });
      this.post({ type: 'ready' }, []);
      return;
    }
    if (msg.type === 'patch') {
      /*
       * Put back together through the same function the main thread uses, and not by hand.
       *
       * It was by hand for one release and it was wrong: a patch of the endless country is painted
       * against the land under it and the rock standing on it, and neither of those crosses a worker
       * boundary — the land is a pair of functions over noise and the rock is expensive to cut. So a
       * sampler rebuilt from roads, water and buildings alone paints a different country from the one
       * it was grown as, which is the exact failure `twohalves.test.ts` exists to catch between the
       * page and the world, happening quietly inside the page instead.
       */
      this.patches.set(msg.patch, rebuildPatch(msg.seed, msg.within, {
        graph: msg.graph, hydro: msg.hydro, structures: msg.structures, ranges: msg.ranges,
        layers: msg.layers, terrain: msg.terrain,
      }));
      // oldest first, which for a Map is insertion order and is near enough: a hero walks, so the
      // patch told about longest ago is the one furthest behind him
      while (this.patches.size > PATCHES_PER_WORKER) this.patches.delete(this.patches.keys().next().value as string);
      // deliberately no `ready`: the main thread does not wait for this. Messages arrive in order, so
      // the `gen` that follows a `patch` is painted by it, and an ack would only put a worker that is
      // already about to be busy back on the idle pile
      return;
    }
    const sampler = msg.patch !== undefined ? this.patches.get(msg.patch) ?? null : this.whole;
    if (!sampler) return;
    const { cx, cz, id } = msg;
    /*
     * The ground either came from the world or is grown here.
     *
     * Grown here is the older way and stays as the answer for when there is nothing to ask — a page
     * whose world has not answered yet should draw the country rather than stand in the dark. What
     * arrives from the world is preferred wherever it exists, because a country both halves grew
     * separately is two countries.
     */
    const sent = msg.type === 'mesh' ? unpackChunk(msg.chunk) : null;
    const chunk = sent ?? sampler.generateChunk(cx, cz);
    const grown = sent === null;
    const meshes = buildChunkMesh(chunk, sampler.seed);
    if (!meshes.land) {
      this.post({ type: 'chunk', id, cx, cz, empty: true, grown }, []);
      return;
    }

    const CS = WORLD.CHUNK_SIZE;
    const size = chunk.size;
    // what anything walking on this chunk needs, packed the one way both halves of the game agree on
    const { heights, types, waters, biomes } = tilesOf(chunk);
    const props: number[] = [];
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const i = (lz + 1) * size + (lx + 1);
        const kind = chunk.prop[i];
        if (kind === 0) continue;
        const wx = cx * CS + lx, wz = cz * CS + lz;
        const y = kind === PropKind.Lily ? chunk.water[i] : chunk.height[i];
        const fixedRot = chunk.propRot[i];
        if (Number.isNaN(fixedRot)) {
          props.push(
            kind,
            wx + 0.25 + rand2(sampler.seed, wx, wz, TILE_SALT.PROP_X) * 0.5,
            y,
            wz + 0.25 + rand2(sampler.seed, wx, wz, TILE_SALT.PROP_Z) * 0.5,
            rand2(sampler.seed, wx, wz, TILE_SALT.PROP_ROT) * Math.PI * 2,
            0.8 + rand2(sampler.seed, wx, wz, TILE_SALT.PROP_SCALE) * 0.45,
            // no two of anything are quite the same height, upright, or shade
            0.82 + rand2(sampler.seed, wx, wz, TILE_SALT.PROP_STRETCH) * 0.42,
            rand2(sampler.seed, wx, wz, TILE_SALT.PROP_LEAN),
            rand2(sampler.seed, wx, wz, TILE_SALT.PROP_TINT),
          );
        } else {
          // structures sit exactly on their tile centre: unscaled, upright, untinted, facing their door
          props.push(kind, wx + 0.5, y, wz + 0.5, -fixedRot, 1, 1, 0.5, 0.5);
        }
      }
    }
    const propArr = Float32Array.from(props);
    const { land, water } = meshes;
    const transfer: Transferable[] = [
      land.positions.buffer, land.normals.buffer, land.colors.buffer, land.indices.buffer,
      propArr.buffer, heights.buffer, types.buffer, waters.buffer, biomes.buffer,
    ];
    if (water) {
      transfer.push(water.positions.buffer, water.normals.buffer, water.colors.buffer, water.indices.buffer);
      if (water.flow) transfer.push(water.flow.buffer);
    }
    this.post({ type: 'chunk', id, cx, cz, empty: false, grown, mesh: land, water, props: propArr, heights, types, waters, biomes }, transfer);
  }
}

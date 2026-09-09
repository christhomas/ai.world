import { WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { TerrainSampler } from '../world/terrain';
import { buildChunkMesh } from '../world/mesher';
import { tilesOf } from '../world/tiles';
import { PropKind } from '../world/biomes';
import { unpackChunk } from '../world/chunkparcel';
import type { WorkerRequest, WorkerResponse } from '../world/messages';

let sampler: TerrainSampler | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    sampler = new TerrainSampler(msg.graph, { hydro: msg.hydro, structures: msg.structures });
    post({ type: 'ready' });
    return;
  }
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
    post({ type: 'chunk', id, cx, cz, empty: true, grown });
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
  post({ type: 'chunk', id, cx, cz, empty: false, grown, mesh: land, water, props: propArr, heights, types, waters, biomes }, transfer);
};

import { WORLD } from '../core/config';
import { PropKind } from './biomes';
import { StructureKind, type Structure } from './structures';
import { TileType, type ChunkData } from './terrain';

/**
 * Putting what was built onto the ground that was grown.
 *
 * The sampler answers "what is this tile made of" from the world seed alone; these take the
 * answer and stamp the things people put there on top of it — a floor under a house, cobbles in
 * a square, a path to a door, a deck over the water. Split out of terrain.ts because it is a
 * different job done at a different time: the ground is a function of where you are, and this is
 * a list of buildings being pressed into it.
 */

/** Tiles a structure may sit on or flatten (never water, sea or bridges). */
function isStampable(t: number): boolean {
  return t !== TileType.Skip && t !== TileType.Seabed && t !== TileType.Water && t !== TileType.Bridge;
}

/** Local index of a world tile inside the chunk arrays, or -1 when outside. */
function localIndex(chunk: ChunkData, ox: number, oz: number, tx: number, tz: number): number {
  const lx = tx - ox, lz = tz - oz;
  if (lx < 0 || lz < 0 || lx >= chunk.size || lz >= chunk.size) return -1;
  return lz * chunk.size + lx;
}

/** Town square: a flattened disc of cobbles, trees cleared. */
export function stampPlaza(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const r = s.radius ?? 4;
  const h = s.level * WORLD.STEP;
  for (let dz = -s.hd; dz <= s.hd; dz++) {
    for (let dx = -s.hw; dx <= s.hw; dx++) {
      if (Math.hypot(dx, dz) > r) continue;
      const idx = localIndex(chunk, ox, oz, s.tx + dx, s.tz + dz);
      if (idx < 0 || !isStampable(chunk.type[idx])) continue;
      chunk.type[idx] = TileType.Plaza;
      chunk.height[idx] = h;
      chunk.prop[idx] = PropKind.None;
    }
  }
}

/** Yard ring flattened to the building's level; the footprint itself becomes Floor for houses and churches. */
export function stampFootprint(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  const building = s.kind === StructureKind.House || s.kind === StructureKind.Church;
  for (let dz = -s.hd - 1; dz <= s.hd + 1; dz++) {
    for (let dx = -s.hw - 1; dx <= s.hw + 1; dx++) {
      const idx = localIndex(chunk, ox, oz, s.tx + dx, s.tz + dz);
      if (idx < 0) continue;
      const t = chunk.type[idx];
      if (!isStampable(t) || t === TileType.Road) continue;
      const inner = Math.abs(dx) <= s.hw && Math.abs(dz) <= s.hd;
      chunk.height[idx] = h;
      chunk.prop[idx] = PropKind.None;
      if (inner && building) chunk.type[idx] = TileType.Floor;
      else if (t === TileType.High) chunk.type[idx] = TileType.Ground;
    }
  }
}

/** Door path tiles become flat road at the building's level; squares and floors are left alone. */
export function stampPath(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  for (const [x, z] of s.path) {
    const idx = localIndex(chunk, ox, oz, x, z);
    if (idx < 0) continue;
    const t = chunk.type[idx];
    if (!isStampable(t) || t === TileType.Plaza || t === TileType.Floor) continue;
    chunk.type[idx] = TileType.Road;
    chunk.height[idx] = h;
    chunk.corners.fill(h, idx * 4, idx * 4 + 4);
    chunk.prop[idx] = PropKind.None;
  }
}

/** The building prop goes on the centre tile, but only when that tile is in the chunk interior (props are emitted once). */
export function stampCentreProp(chunk: ChunkData, ox: number, oz: number, s: Structure, storeys = 1): void {
  const idx = interiorIndex(chunk, ox, oz, s.tx, s.tz);
  if (idx < 0) return;
  chunk.prop[idx] = structureProp(s, storeys);
  chunk.propRot[idx] = s.rot;
}

/** Signs and stalls: no yard, just the prop on its tile if the ground allows. */
export function stampSingleProp(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const idx = interiorIndex(chunk, ox, oz, s.tx, s.tz);
  if (idx < 0) return;
  if (!isStampable(chunk.type[idx]) || chunk.type[idx] === TileType.Floor) return;
  chunk.prop[idx] = structureProp(s);
  chunk.propRot[idx] = s.rot;
}

/** Jetty planks: flat wooden deck at the shore's level, laid over sea, sand or shallow water. */
export function stampPier(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  for (const [x, z] of s.path) {
    const idx = localIndex(chunk, ox, oz, x, z);
    if (idx < 0) continue;
    const t = chunk.type[idx];
    if (t === TileType.Bridge || t === TileType.Road || t === TileType.Floor) continue;
    chunk.type[idx] = TileType.Pier;
    chunk.height[idx] = h;
    chunk.water[idx] = 0;
    chunk.prop[idx] = PropKind.None;
  }
}

/** Like localIndex but excludes the apron ring. */
function interiorIndex(chunk: ChunkData, ox: number, oz: number, tx: number, tz: number): number {
  const lx = tx - ox, lz = tz - oz;
  const CS = WORLD.CHUNK_SIZE;
  if (lx < 1 || lz < 1 || lx > CS || lz > CS) return -1;
  return lz * chunk.size + lx;
}

/**
 * What a structure is drawn as.
 *
 * `storeys` is how the village's prosperity reaches the eye: a house whose owner has done well
 * has another floor in it. It is asked for at the moment a chunk is built rather than baked into
 * the structure, so a village that grows richer while you are away is taller when you come back —
 * chunks are rebuilt whenever they reload, so nothing has to be told to change.
 */
export function structureProp(s: Structure, storeys = 1): PropKind {
  switch (s.kind) {
    case StructureKind.House:
      return storeys > 1
        ? (PropKind.TallHousePlains + s.biome) as PropKind
        : (PropKind.HousePlains + s.biome) as PropKind;
    case StructureKind.Church: return (PropKind.ChurchPlains + s.biome) as PropKind;
    case StructureKind.Well: return PropKind.Well;
    case StructureKind.Shrine: return PropKind.Shrine;
    case StructureKind.Ruins: return PropKind.Ruins;
    case StructureKind.Tower: return PropKind.Tower;
    case StructureKind.Campfire: return PropKind.Campfire;
    case StructureKind.GiantTree: return PropKind.GiantTree;
    case StructureKind.Stall: return PropKind.Stall;
    case StructureKind.Sign: return PropKind.Sign;
    case StructureKind.Plaza: return PropKind.None;
    case StructureKind.Pier: return PropKind.None;
    case StructureKind.Signpost: return PropKind.Signpost;
    case StructureKind.NoticeBoard: return PropKind.NoticeBoard;
    case StructureKind.CaveMouth: return PropKind.CaveMouth;
    case StructureKind.Shipwreck: return PropKind.Shipwreck;
  }
}

/**
 * Put one structure into a chunk, whatever kind it is.
 *
 * The one place that knows which of the stamps above a kind of building wants — a square is poured,
 * a sign is a prop on a tile, a pier is a deck over water, and a house is a footprint with a path
 * to the road and a roof whose height is the village's own doing.
 */
export function stampStructure(
  chunk: ChunkData, ox: number, oz: number, s: Structure, storeys = 1,
): void {
  switch (s.kind) {
    case StructureKind.Plaza: stampPlaza(chunk, ox, oz, s); break;
    case StructureKind.Sign:
    case StructureKind.Stall:
    case StructureKind.Signpost:
    case StructureKind.NoticeBoard: stampSingleProp(chunk, ox, oz, s); break;
    case StructureKind.CaveMouth:
    case StructureKind.Shipwreck:
      stampFootprint(chunk, ox, oz, s);
      stampCentreProp(chunk, ox, oz, s);
      break;
    case StructureKind.Pier: stampPier(chunk, ox, oz, s); break;
    default:
      stampFootprint(chunk, ox, oz, s);
      stampPath(chunk, ox, oz, s);
      stampCentreProp(chunk, ox, oz, s, storeys);
  }
}

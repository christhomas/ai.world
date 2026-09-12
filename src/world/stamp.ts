import { WORLD } from '../core/config';
import { PropKind } from './biomes';
import { CASTLE } from './castles';
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

/** Yard ring flattened to the building's level; the footprint itself becomes Floor for anything with a door in it. */
export function stampFootprint(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  const building = s.kind === StructureKind.House || s.kind === StructureKind.Church
    || s.kind === StructureKind.TownHall || s.kind === StructureKind.WatchHouse;
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

/**
 * The ground inside a paddock: levelled and cleared of what was growing on it, and still grass.
 *
 * Strictly inside the rails, never on them. The chunk stamper takes structures in whatever order
 * its index hands them over, so a clear that reached one tile further — as a building's footprint
 * does — would sometimes rub out the fence that was stamped before it and sometimes not, which is
 * the sort of fault that shows up as one gap in one paddock in one seed.
 */
export function stampYard(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  for (let dz = -s.hd + 1; dz <= s.hd - 1; dz++) {
    for (let dx = -s.hw + 1; dx <= s.hw - 1; dx++) {
      const idx = localIndex(chunk, ox, oz, s.tx + dx, s.tz + dz);
      if (idx < 0) continue;
      const t = chunk.type[idx];
      if (!isStampable(t) || t === TileType.Road) continue;
      chunk.height[idx] = h;
      chunk.corners.fill(h, idx * 4, idx * 4 + 4);
      chunk.prop[idx] = PropKind.None;
      if (t === TileType.High) chunk.type[idx] = TileType.Ground;
    }
  }
}

/**
 * Is this tile the last ring of the apron — the one that meets the country?
 *
 * Rings are counted out from the wall line: nought is the wall itself and everything inside it,
 * one is the apron the towers overhang, and `CASTLE.APRON` is the outer edge where the castle's
 * made ground stops and the world's begins.
 */
function onTheOutermostRing(s: Structure, dx: number, dz: number): boolean {
  return Math.max(Math.abs(dx) - s.hw, Math.abs(dz) - s.hd) === CASTLE.APRON;
}

/**
 * One terrace of the way from the platform to whatever the country was doing here, and no further.
 *
 * The castle's doorstep, and the reason a castle may now be seated on ground that rises two
 * terraces across it rather than one. The plot is stamped flat whatever it was, so the whole of
 * what it was comes out as a step round the edge: at a terrace that step is a stride, and at two
 * it is a wall you cannot climb from the uphill side — which is why `CASTLE.SLACK` was one, and
 * why one is rare enough in a country with hills in it that three worlds in ten held no castle at
 * all.
 *
 * So the step is halved by being taken twice. The outer ring of the apron sits one terrace towards
 * the country instead of flush with the ward, which turns a two-terrace wall into two one-terrace
 * strides with a tile of standing room between them. It is deliberately a terrace and not a ramp:
 * this world is built of terraces and reads as terraces, and a smooth slope here would be the one
 * piece of ground in the country that was not.
 *
 * `toward` never overshoots. Where the country was already level with the platform, or within a
 * terrace of it, the ring stays where the country is and there is no step at all.
 */
function oneTerraceToward(was: number, platform: number): number {
  const gap = was - platform;
  if (Math.abs(gap) <= WORLD.STEP) return was;
  return platform + Math.sign(gap) * WORLD.STEP;
}

/**
 * The ground a castle stands on: levelled end to end, cobbled inside the walls, cleared of what
 * was growing there.
 *
 * A castle does not look for flat ground, it makes some — see `castlePlot`, which explains why:
 * twenty-one tiles of one terrace does not occur in this country, so a plot is accepted within two
 * terraces of itself and stamped level. The apron outside the wall is levelled with it, because the
 * drum towers overhang it and the gate opens onto it — all but its outermost ring, which is the
 * castle's own doorstep and is dealt with below.
 *
 * What is *not* cleared is anything somebody put there, and that is the whole subtlety of this
 * function. The chunk stamper takes structures in whatever order its index hands them over, so
 * this can as easily run after the keep and the towers as before them — and a clear that took
 * everything would rub out half its own castle in some chunks and not others. A grown thing is
 * jittered onto its tile and carries no rotation; anything with a rotation was placed. `propRot`
 * says which, and it is NaN until somebody sets it.
 */
export function stampWard(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const h = s.level * WORLD.STEP;
  for (let dz = -s.hd - CASTLE.APRON; dz <= s.hd + CASTLE.APRON; dz++) {
    for (let dx = -s.hw - CASTLE.APRON; dx <= s.hw + CASTLE.APRON; dx++) {
      const idx = localIndex(chunk, ox, oz, s.tx + dx, s.tz + dz);
      if (idx < 0) continue;
      const t = chunk.type[idx];
      if (!isStampable(t) || t === TileType.Road) continue;
      const level = onTheOutermostRing(s, dx, dz) ? oneTerraceToward(chunk.height[idx], h) : h;
      chunk.height[idx] = level;
      chunk.corners.fill(level, idx * 4, idx * 4 + 4);
      if (Number.isNaN(chunk.propRot[idx])) chunk.prop[idx] = PropKind.None;
      // inside the walls it is a yard, and a yard that has been walked on for two hundred years
      if (Math.abs(dx) < s.hw && Math.abs(dz) < s.hd) chunk.type[idx] = TileType.Plaza;
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

/**
 * Jetty planks: flat wooden deck at the shore's level, laid over sea, sand or shallow water.
 *
 * The corners matter as much as the height, and for a long time only the height was set. A tile's
 * `height` is what anybody standing on it is standing on; its four `corners` are what is *drawn* —
 * that separation is what makes a terrace a terrace and a ramp a ramp. So a pier was three units
 * of walkable deck whose picture was still lying flat on the seabed at nought: you walked out over
 * the water on nothing at all, and the ferry you were boarding sat at the end of an invisible jetty.
 *
 * Reported as the pier simply not being drawn, which is exactly what it was.
 */
export function stampPier(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  /*
   * A jetty walks down to the water it ends in.
   *
   * It used to be laid flat at the height of the land it left, which on a headland is three or four
   * terraces up — so the ferry lay in the water a couple of units below the planks and read as a
   * sunken boat, and stepping aboard was a drop. Reported as the pier being under the water, which
   * is the same mismatch seen from the other end.
   *
   * So the shore end keeps the land's height, the seaward end comes down to a quay's height above
   * the *water* — `WORLD.PIER_FREEBOARD`, measured from the sea rather than from the seabed under
   * it — and the planks in between step down evenly. Each tile stays flat, because a plank is flat:
   * what slopes is the jetty, one board at a time.
   */
  const from = s.level * WORLD.STEP;
  const to = WORLD.WATER_Y + WORLD.PIER_FREEBOARD;
  for (let k = 0; k < s.path.length; k++) {
    const [x, z] = s.path[k];
    const idx = localIndex(chunk, ox, oz, x, z);
    if (idx < 0) continue;
    const t = chunk.type[idx];
    if (t === TileType.Bridge || t === TileType.Road || t === TileType.Floor) continue;
    /*
     * One terrace a board, in whichever direction the water is.
     *
     * A terrace is exactly what a hero can step up, so a jetty that changes this fast is one he can
     * walk both ways. Piers are laid off low shores now — `HARBOUR_LEVEL` in `piers.ts` — so the
     * usual case is a beach half a unit up and a deck a unit above the water, which is a single
     * step up onto the planks. The other direction is the old one: a bank a few terraces up walks
     * down to the water, and a jetty off a headland gets as far as six boards take it.
     */
    const h = from < to
      ? Math.min(to, from + k * WORLD.STEP)     // up off a beach onto the quay
      : Math.max(to, from - k * WORLD.STEP);    // down off a bank to it
    chunk.type[idx] = TileType.Pier;
    chunk.height[idx] = h;
    // and the deck itself: flat, all four corners at the same height, which is what a plank is
    chunk.corners[idx * 4] = h;
    chunk.corners[idx * 4 + 1] = h;
    chunk.corners[idx * 4 + 2] = h;
    chunk.corners[idx * 4 + 3] = h;
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
    case StructureKind.TownHall: return (PropKind.TownHallPlains + s.biome) as PropKind;
    case StructureKind.WatchHouse: return (PropKind.WatchHousePlains + s.biome) as PropKind;
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
    case StructureKind.Hulk: return PropKind.Hulk;
    case StructureKind.Fence: return PropKind.Fence;
    case StructureKind.Paddock: return PropKind.None;
    case StructureKind.CastleWard: return PropKind.None;
    case StructureKind.CastleWall: return PropKind.CastleWall;
    case StructureKind.CastleTower: return PropKind.CastleTower;
    case StructureKind.CastleGate: return PropKind.CastleGate;
    case StructureKind.CastleKeep: return PropKind.CastleKeep;
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
    case StructureKind.Paddock: stampYard(chunk, ox, oz, s); break;
    case StructureKind.CastleWard: stampWard(chunk, ox, oz, s); break;
    case StructureKind.Sign:
    case StructureKind.Stall:
    case StructureKind.Signpost:
    case StructureKind.NoticeBoard:
    // every piece of a castle stands on the flat the ward already made, and clears nothing of its
    // own: a wall that levelled a yard round itself would level the tower beside it out of the way
    case StructureKind.CastleWall:
    case StructureKind.CastleTower:
    case StructureKind.CastleGate:
    case StructureKind.CastleKeep:
    case StructureKind.Fence: stampSingleProp(chunk, ox, oz, s); break;
    case StructureKind.CaveMouth:
    case StructureKind.Shipwreck:
    case StructureKind.Hulk:
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

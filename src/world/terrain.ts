import { GRAPH, HYDRO, WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { SALT, TILE_SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';
import { biomeAt, segDist2, type RoadGraph } from './graph';
import { BIOMES, type Biome, PropKind, pickWeighted } from './biomes';
import { generateHydrology, type Hydrology, type LandProbe } from './rivers';
import { CellIndex } from './spatial';
import { generateStructures, structureBounds, StructureKind, type Structure, type Structures } from './structures';

/** What is drawn on top of a tile. Skip = nothing at all (open sea, no floor). */
export const enum TileType {
  Skip = 0,
  Seabed = 1,
  Ground = 2,
  GroundAlt = 3,
  Sand = 4,
  Road = 5,
  High = 6,
  Water = 7,   // river / lake bed; surface height lives in ChunkData.water
  Bridge = 8,  // road over water
  Floor = 9,   // under a building; blocked for walkers
  Plaza = 10,  // town square cobbles; walkable, flat
}

/**
 * One chunk of tiles including a one-tile apron on every side so the mesher can
 * look at neighbours without asking for adjacent chunks. Index = (z + 1) * size + (x + 1)
 * where x,z are 0..CHUNK_SIZE-1 local coords; the apron occupies index -1 and CHUNK_SIZE.
 */
export interface ChunkData {
  cx: number;
  cz: number;
  size: number;          // CHUNK_SIZE + 2
  height: Float32Array;  // top surface y in world units (for water tiles: the bed)
  type: Uint8Array;      // TileType
  biome: Uint8Array;     // Biome
  prop: Uint8Array;      // PropKind
  /** Fixed prop yaw for structures; NaN = random. */
  propRot: Float32Array;
  shore: Float32Array;   // for seabed tiles: tiles from the coast (0 = at the coast)
  /** Road/bridge tiles only: heights at the 4 corners (NW, NE, SE, SW) so ramps are true slopes, not stairs. */
  corners: Float32Array;
  /** Water surface height for Water/Bridge tiles, 0 elsewhere. */
  water: Float32Array;
  empty: boolean;
}

/** Raw terrain at one tile, before structures are stamped on. */
export interface TileSample {
  type: TileType;
  level: number;
  /** Terrace the road sits on here; High ground is measured from it. */
  base: number;
  height: number;
  water: number;
  shore: number;
  biome: Biome;
  bank: boolean;
  roadDist: number;
  roadWidth: number;
  corners: [number, number, number, number];
}

export interface Probe {
  land: boolean;
  biome: Biome;
  /** Distance to nearest road centreline, Infinity if no road is anywhere near. */
  roadDist: number;
  hub: boolean;
}

interface RiverSeg { ax: number; az: number; bx: number; bz: number; la: number; lb: number; wa: number; wb: number }

const CELL = 32;
const EDGE_MARGIN = GRAPH.MAX_WIDTH * 1.45 + WORLD.SEABED_RANGE + 2;
const RIVER_MARGIN = HYDRO.RIVER_MAX_WIDTH + HYDRO.BANK + 8;
const LAKE_MARGIN = HYDRO.BANK + 8;
const HUB_PLAZA = 5;
/** Share of ground tiles that use the alternate ground colour. */
const GROUND_ALT_CHANCE = 0.35;
/** Neighbours (of 8) that must agree before the de-speckle filter overrides a tile's level. */
const DESPECKLE_MAJORITY = 5;
/** Tiles beyond the road edge kept free of props. */
const ROAD_SHOULDER = 1.2;
const HIGH_ROCK_DENSITY = 0.06;
/** Coast sand gets this fraction of the bank prop density. */
const COAST_PROP_FACTOR = 0.25;
/** Bridge decks sit this far above the river surface. */
export const BRIDGE_DECK_LIFT = 0.14;

/** Samples the world at tile resolution. Pure function of (seed, graph, x, z): safe to run in any worker. */
export class TerrainSampler {
  private readonly edgeIndex: CellIndex;
  private readonly riverIndex: CellIndex;
  private readonly riverSegs: RiverSeg[] = [];
  private readonly noise: Simplex2D;
  private readonly biomeNoise: Simplex2D;
  private structIndex: CellIndex | null = null;
  readonly hydro: Hydrology;
  readonly structures: Structures;
  readonly seed: number;

  constructor(readonly graph: RoadGraph, prebuilt?: { hydro: Hydrology; structures: Structures }) {
    this.seed = graph.seed;
    this.noise = new Simplex2D(derive(graph.seed, SALT.TERRAIN));
    this.biomeNoise = new Simplex2D(derive(graph.seed, SALT.BIOME));

    this.edgeIndex = new CellIndex(CELL, graph.edges.length);
    graph.edges.forEach((e, i) => {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      this.edgeIndex.insert(i,
        Math.min(a.x, b.x) - EDGE_MARGIN, Math.min(a.z, b.z) - EDGE_MARGIN,
        Math.max(a.x, b.x) + EDGE_MARGIN, Math.max(a.z, b.z) + EDGE_MARGIN);
    });

    this.hydro = prebuilt ? prebuilt.hydro : generateHydrology(graph, (x, z) => this.landProbe(x, z));
    for (const river of this.hydro.rivers) {
      for (let i = 0; i + 1 < river.length; i++) {
        const a = river[i], b = river[i + 1];
        this.riverSegs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, la: a.level, lb: b.level, wa: a.width, wb: b.width });
      }
    }
    this.riverIndex = new CellIndex(CELL, this.riverSegs.length + this.hydro.lakes.length);
    this.riverSegs.forEach((s, i) => {
      this.riverIndex.insert(i,
        Math.min(s.ax, s.bx) - RIVER_MARGIN, Math.min(s.az, s.bz) - RIVER_MARGIN,
        Math.max(s.ax, s.bx) + RIVER_MARGIN, Math.max(s.az, s.bz) + RIVER_MARGIN);
    });
    // lakes share the index; ids past the river segments are lakes
    this.hydro.lakes.forEach((l, i) => {
      const m = l.r * 1.3 + LAKE_MARGIN;
      this.riverIndex.insert(this.riverSegs.length + i, l.x - m, l.z - m, l.x + m, l.z + m);
    });

    // structures sample raw terrain, so they come last
    this.structures = prebuilt ? prebuilt.structures : generateStructures(this);
    this.structIndex = new CellIndex(CELL, this.structures.all.length);
    this.structures.all.forEach((s, i) => {
      const b = structureBounds(s);
      this.structIndex!.insert(i, b.minX, b.minZ, b.maxX + 1, b.maxZ + 1);
    });
  }

  newSample(): TileSample {
    return { type: TileType.Skip, level: 0, base: 0, height: 0, water: 0, shore: 0, biome: 0 as Biome, bank: false, roadDist: Infinity, roadWidth: 0, corners: [0, 0, 0, 0] };
  }

  biomeOf(x: number, z: number): Biome {
    return biomeAt(this.graph, this.biomeNoise, x, z);
  }

  /** Road-relative facts about a point. Used by hydrology routing, structures and the HUD. */
  landProbe(x: number, z: number): LandProbe | null {
    const cands = this.edgeIndex.query(x - 1, z - 1, x + 1, z + 1);
    const hit = this.nearest(x, z, cands);
    if (!hit) return null;
    const e = this.graph.edges[hit.edge];
    const W = this.landWidth(hit.edge, x, z);
    const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b];
    const roadLevel = a.level + (b.level - a.level) * hit.t;
    let ux = b.x - a.x, uz = b.z - a.z;
    const len = Math.hypot(ux, uz) || 1;
    ux /= len; uz /= len;
    return {
      land: hit.d < W, roadDist: hit.d, roadWidth: e.roadWidth, landWidth: W,
      baseLevel: Math.max(1, Math.round(roadLevel)),
      cx: a.x + (b.x - a.x) * hit.t, cz: a.z + (b.z - a.z) * hit.t, ux, uz,
    };
  }

  /** Cheap query for HUD / entities: is this a land tile, and in which biome? */
  probe(x: number, z: number): Probe {
    const lp = this.landProbe(x, z);
    const biome = this.biomeOf(x, z);
    const hub = Math.hypot(x, z) < GRAPH.HUB_RADIUS * 1.15;
    if (!lp) return { land: false, biome, roadDist: Infinity, hub };
    return { land: lp.land, biome, roadDist: lp.roadDist, hub };
  }

  private nearest(px: number, pz: number, cands: number[]): { edge: number; d: number; t: number } | null {
    const { nodes, edges } = this.graph;
    let best = -1, bestD2 = Infinity, bestT = 0;
    for (const i of cands) {
      const e = edges[i];
      const a = nodes[e.a], b = nodes[e.b];
      const [d2, t] = segDist2(px, pz, a.x, a.z, b.x, b.z);
      if (d2 < bestD2) { bestD2 = d2; best = i; bestT = t; }
    }
    if (best < 0) return null;
    return { edge: best, d: Math.sqrt(bestD2), t: bestT };
  }

  private landWidth(edgeIdx: number, px: number, pz: number): number {
    const e = this.graph.edges[edgeIdx];
    const n = this.noise.fbm(px * 0.06, pz * 0.06, 2);
    return Math.max(e.roadWidth + 2.5, e.width * (1 + 0.42 * n));
  }

  /** Road surface height at an arbitrary point, used for ramp corners. Falls back to the tile's own level. */
  private roadHeightAt(x: number, z: number, cands: number[], fallback: number): number {
    const hit = this.nearest(x, z, cands);
    if (!hit) return fallback * WORLD.STEP;
    const e = this.graph.edges[hit.edge];
    const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b];
    return (a.level + (b.level - a.level) * hit.t) * WORLD.STEP;
  }

  /**
   * Nearest water body. `wd` is the signed distance outside its edge (negative = in the water),
   * `level` is the terrace the water surface belongs to (bed is one below).
   */
  private waterAt(px: number, pz: number, cands: number[]): { wd: number; level: number } | null {
    let best: { wd: number; level: number } | null = null;
    const nSeg = this.riverSegs.length;
    for (const i of cands) {
      if (i < nSeg) {
        const s = this.riverSegs[i];
        const [d2, t] = segDist2(px, pz, s.ax, s.az, s.bx, s.bz);
        const w = s.wa + (s.wb - s.wa) * t;
        const wd = Math.sqrt(d2) - w;
        // level switches halfway along a segment: that seam is where the waterfall forms
        if (!best || wd < best.wd) best = { wd, level: t < 0.5 ? s.la : s.lb };
      } else {
        const l = this.hydro.lakes[i - nSeg];
        const dx = px - l.x, dz = pz - l.z;
        const rr = l.r * (1 + 0.3 * this.noise.noise(px * 0.16, pz * 0.16));
        const wd = Math.sqrt(dx * dx + dz * dz) - rr;
        if (!best || wd < best.wd) best = { wd, level: l.level };
      }
    }
    return best;
  }

  /**
   * Raw terrain for one tile. `cands`/`riverCands` may be passed when sampling many tiles in a
   * region; otherwise they are looked up per call.
   */
  sampleTile(tx: number, tz: number, out: TileSample, cands?: number[], riverCands?: number[]): void {
    const px = tx + 0.5, pz = tz + 0.5;
    out.type = TileType.Skip;
    out.water = 0; out.shore = 0; out.bank = false; out.level = 0; out.height = 0; out.base = 0;
    out.roadDist = Infinity; out.roadWidth = 0;
    if (!cands) cands = this.edgeIndex.query(px - 1, pz - 1, px + 1, pz + 1);
    const hit = this.nearest(px, pz, cands);
    if (!hit) return;
    const { nodes, edges } = this.graph;
    const STEP = WORLD.STEP;
    const e = edges[hit.edge];
    const roadLevel = nodes[e.a].level + (nodes[e.b].level - nodes[e.a].level) * hit.t;
    const W = this.landWidth(hit.edge, px, pz);
    const biome = this.biomeOf(px, pz);
    const def = BIOMES[biome];
    out.biome = biome;
    out.roadDist = hit.d;
    out.roadWidth = e.roadWidth;
    const d = hit.d;

    if (d >= W) {
      if (d - W < WORLD.SEABED_RANGE) {
        out.type = TileType.Seabed;
        out.shore = d - W;
      }
      return;
    }

    if (!riverCands) riverCands = this.riverIndex.query(px - 1, pz - 1, px + 1, pz + 1);
    const water = riverCands.length > 0 ? this.waterAt(px, pz, riverCands) : null;
    const plaza = Math.hypot(px, pz) < HUB_PLAZA;

    if (d < e.roadWidth || plaza) {
      out.type = TileType.Road;
      out.level = roadLevel;
      out.height = roadLevel * STEP;
      // corners sample the road level field so consecutive tiles form a continuous ramp
      out.corners[0] = this.roadHeightAt(tx, tz, cands, roadLevel);
      out.corners[1] = this.roadHeightAt(tx + 1, tz, cands, roadLevel);
      out.corners[2] = this.roadHeightAt(tx + 1, tz + 1, cands, roadLevel);
      out.corners[3] = this.roadHeightAt(tx, tz + 1, cands, roadLevel);
      if (water && water.wd < 0) {
        // bridge: deck rides just above the river surface
        out.type = TileType.Bridge;
        const surface = (Math.max(1, water.level) - 1) * STEP + WORLD.WATER_Y;
        out.water = surface;
        const deck = surface + BRIDGE_DECK_LIFT;
        for (let k = 0; k < 4; k++) out.corners[k] = Math.max(out.corners[k], deck);
        out.height = Math.max(out.height, deck);
      }
      return;
    }

    const baseLevel = Math.max(1, Math.round(roadLevel));
    out.base = baseLevel;
    const td = (d - e.roadWidth) / (W - e.roadWidth);
    const hills = this.noise.fbm(px * 0.04, pz * 0.04, 2);
    let rise = Math.floor(td * (0.75 + hills) * def.roughness);
    if (rise < 0) rise = 0;
    let level = Math.min(WORLD.MAX_LEVEL, baseLevel + rise);

    let type: TileType;
    if (d > W - 2.2) {
      // coast band: beaches on low ground, cliff coasts on highlands
      level = baseLevel;
      type = level <= 1 ? TileType.Sand : TileType.Ground;
    } else if (level - baseLevel >= def.highAt) {
      type = TileType.High;
    } else {
      type = rand2(this.seed, tx, tz, TILE_SALT.GROUND_VARIANT) < GROUND_ALT_CHANCE ? TileType.GroundAlt : TileType.Ground;
    }

    if (water) {
      const wl = Math.max(1, water.level);
      if (water.wd < 0) {
        type = TileType.Water;
        level = wl - 1;
        out.water = level * STEP + WORLD.WATER_Y;
      } else if (water.wd < HYDRO.BANK) {
        level = wl;
        type = TileType.Sand;
        out.bank = true;
      } else {
        // valley sides climb one terrace per ~1.4 tiles away from the bank
        const cap = wl + Math.floor((water.wd - HYDRO.BANK) / 1.4);
        if (level > cap) {
          level = cap;
          if (type === TileType.High && level - baseLevel < def.highAt) type = TileType.Ground;
        }
      }
    }
    out.type = type;
    out.level = level;
    out.height = level * STEP;
  }

  generateChunk(cx: number, cz: number): ChunkData {
    const CS = WORLD.CHUNK_SIZE;
    const size = CS + 2;
    const n = size * size;
    const chunk: ChunkData = {
      cx, cz, size,
      height: new Float32Array(n),
      type: new Uint8Array(n),
      biome: new Uint8Array(n),
      prop: new Uint8Array(n),
      propRot: new Float32Array(n).fill(Number.NaN),
      shore: new Float32Array(n),
      corners: new Float32Array(n * 4),
      water: new Float32Array(n),
      empty: true,
    };
    const grid = this.sampleGrid(cx, cz);
    if (!grid) return chunk;

    let drawn = 0;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        // output tile (lx,lz) is grid tile (lx+1, lz+1): the grid carries one extra ring for the filter
        const gi = (lz + 1) * grid.G + (lx + 1);
        const idx = lz * size + lx;
        if (grid.type[gi] === TileType.Skip) continue;
        drawn++;
        const { type, level } = this.despeckle(grid, gi);
        chunk.type[idx] = type;
        chunk.biome[idx] = grid.biome[gi];
        chunk.water[idx] = grid.water[gi];
        chunk.shore[idx] = grid.shore[gi];
        if (type === TileType.Road || type === TileType.Bridge) {
          chunk.height[idx] = grid.height[gi];
          chunk.corners.set(grid.corners.subarray(gi * 4, gi * 4 + 4), idx * 4);
          continue;
        }
        chunk.height[idx] = level * WORLD.STEP;
        if (type !== TileType.Seabed) chunk.prop[idx] = this.rollProp(grid, gi, type);
      }
    }

    chunk.empty = drawn === 0;
    if (!chunk.empty) this.stampStructures(chunk, cx * CS - 1, cz * CS - 1);
    return chunk;
  }

  /**
   * Raw samples for the chunk plus a two-tile apron, so every output tile (including the mesher's
   * one-tile apron) has all eight neighbours available for the de-speckle filter. Null if the whole
   * area is open sea.
   */
  private sampleGrid(cx: number, cz: number): SampleGrid | null {
    const CS = WORLD.CHUNK_SIZE;
    const G = CS + 4;
    const x0 = cx * CS - 2, z0 = cz * CS - 2;
    const cands = this.edgeIndex.query(x0, z0, x0 + G, z0 + G);
    if (cands.length === 0) return null;
    const riverCands = this.riverIndex.query(x0, z0, x0 + G, z0 + G);
    const n = G * G;
    const grid: SampleGrid = {
      G, x0, z0,
      type: new Uint8Array(n), biome: new Uint8Array(n), bank: new Uint8Array(n),
      level: new Float32Array(n), height: new Float32Array(n), water: new Float32Array(n), shore: new Float32Array(n),
      roadDist: new Float32Array(n), roadWidth: new Float32Array(n), base: new Int16Array(n),
      corners: new Float32Array(n * 4),
    };
    const s = this.newSample();
    for (let gz = 0; gz < G; gz++) {
      for (let gx = 0; gx < G; gx++) {
        const gi = gz * G + gx;
        this.sampleTile(x0 + gx, z0 + gz, s, cands, riverCands);
        grid.type[gi] = s.type;
        if (s.type === TileType.Skip) continue;
        grid.biome[gi] = s.biome; grid.bank[gi] = s.bank ? 1 : 0;
        grid.level[gi] = s.level; grid.height[gi] = s.height; grid.water[gi] = s.water; grid.shore[gi] = s.shore;
        grid.roadDist[gi] = s.roadDist; grid.roadWidth[gi] = s.roadWidth; grid.base[gi] = s.base;
        if (s.type === TileType.Road || s.type === TileType.Bridge) grid.corners.set(s.corners, gi * 4);
      }
    }
    return grid;
  }

  /** Majority filter: a lone tile a terrace off from its neighbourhood joins the crowd. */
  private despeckle(grid: SampleGrid, gi: number): { type: TileType; level: number } {
    let type = grid.type[gi] as TileType;
    let level = grid.level[gi];
    if (!isFlatLand(type) || grid.bank[gi] || type === TileType.Sand) return { type, level };
    const counts = new Map<number, number>();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const ni = gi + dz * grid.G + dx;
      if (!isFlatLand(grid.type[ni] as TileType)) continue;
      counts.set(grid.level[ni], (counts.get(grid.level[ni]) ?? 0) + 1);
    }
    let mode = level, modeN = 0;
    for (const [l, cnt] of counts) if (cnt > modeN) { modeN = cnt; mode = l; }
    if (modeN < DESPECKLE_MAJORITY || mode === level) return { type, level };
    level = mode;
    const def = BIOMES[grid.biome[gi]];
    const tx = grid.x0 + (gi % grid.G), tz = grid.z0 + Math.floor(gi / grid.G);
    if (level - grid.base[gi] >= def.highAt) type = TileType.High;
    else if (type === TileType.High) type = rand2(this.seed, tx, tz, TILE_SALT.GROUND_VARIANT) < GROUND_ALT_CHANCE ? TileType.GroundAlt : TileType.Ground;
    return { type, level };
  }

  /** Which prop (if any) grows on a land tile. Roads keep a clear shoulder; banks and water have their own tables. */
  private rollProp(grid: SampleGrid, gi: number, type: TileType): PropKind {
    const tx = grid.x0 + (gi % grid.G), tz = grid.z0 + Math.floor(gi / grid.G);
    const def = BIOMES[grid.biome[gi]];
    const r = rand2(this.seed, tx, tz, TILE_SALT.PROP_ROLL);
    const kindRoll = rand2(this.seed, tx, tz, TILE_SALT.PROP_KIND);
    if (type === TileType.Water) return r < def.waterDensity ? pickWeighted(def.water, kindRoll) : PropKind.None;
    if (grid.bank[gi]) return r < def.bankDensity ? pickWeighted(def.bank, kindRoll) : PropKind.None;
    if (grid.roadDist[gi] < grid.roadWidth[gi] + ROAD_SHOULDER) return PropKind.None;
    switch (type) {
      case TileType.High: return r < HIGH_ROCK_DENSITY ? (kindRoll < 0.5 ? PropKind.Rock : PropKind.Boulder) : PropKind.None;
      case TileType.Ground:
      case TileType.GroundAlt: return r < def.propDensity ? pickWeighted(def.props, kindRoll) : PropKind.None;
      case TileType.Sand: return r < def.bankDensity * COAST_PROP_FACTOR ? pickWeighted(def.bank, kindRoll) : PropKind.None;
      default: return PropKind.None;
    }
  }

  /** Flatten yards, lay door paths, and drop each building prop on its centre tile. */
  private stampStructures(chunk: ChunkData, ox: number, oz: number): void {
    if (!this.structIndex) return;
    const hits = this.structIndex.query(ox, oz, ox + chunk.size, oz + chunk.size);
    for (const si of hits) {
      const s = this.structures.all[si];
      switch (s.kind) {
        case StructureKind.Plaza: stampPlaza(chunk, ox, oz, s); break;
        case StructureKind.Sign:
        case StructureKind.Stall: stampSingleProp(chunk, ox, oz, s); break;
        default:
          stampFootprint(chunk, ox, oz, s);
          stampPath(chunk, ox, oz, s);
          stampCentreProp(chunk, ox, oz, s);
      }
    }
  }
}

/** One sampled grid with a two-tile apron; indices are gz * G + gx. */
interface SampleGrid {
  G: number;
  x0: number;
  z0: number;
  type: Uint8Array;
  biome: Uint8Array;
  bank: Uint8Array;
  level: Float32Array;
  height: Float32Array;
  water: Float32Array;
  shore: Float32Array;
  roadDist: Float32Array;
  roadWidth: Float32Array;
  base: Int16Array;
  corners: Float32Array;
}

/** Tiles whose level the de-speckle filter may compare and adjust. */
function isFlatLand(t: TileType): boolean {
  return t === TileType.Ground || t === TileType.GroundAlt || t === TileType.High || t === TileType.Sand;
}

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
function stampPlaza(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
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
function stampFootprint(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
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
function stampPath(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
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
function stampCentreProp(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const idx = interiorIndex(chunk, ox, oz, s.tx, s.tz);
  if (idx < 0) return;
  chunk.prop[idx] = structureProp(s);
  chunk.propRot[idx] = s.rot;
}

/** Signs and stalls: no yard, just the prop on its tile if the ground allows. */
function stampSingleProp(chunk: ChunkData, ox: number, oz: number, s: Structure): void {
  const idx = interiorIndex(chunk, ox, oz, s.tx, s.tz);
  if (idx < 0) return;
  if (!isStampable(chunk.type[idx]) || chunk.type[idx] === TileType.Floor) return;
  chunk.prop[idx] = structureProp(s);
  chunk.propRot[idx] = s.rot;
}

/** Like localIndex but excludes the apron ring. */
function interiorIndex(chunk: ChunkData, ox: number, oz: number, tx: number, tz: number): number {
  const lx = tx - ox, lz = tz - oz;
  const CS = WORLD.CHUNK_SIZE;
  if (lx < 1 || lz < 1 || lx > CS || lz > CS) return -1;
  return lz * chunk.size + lx;
}

export function structureProp(s: Structure): PropKind {
  switch (s.kind) {
    case StructureKind.House: return (PropKind.HousePlains + s.biome) as PropKind;
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
  }
}

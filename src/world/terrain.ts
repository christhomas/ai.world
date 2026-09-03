import { GRAPH, HYDRO, WORLD } from '../core/config';
import { rand2 } from '../core/rng';
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
  water: boolean;
}

interface RiverSeg { ax: number; az: number; bx: number; bz: number; la: number; lb: number; wa: number; wb: number }

const CELL = 32;
const EDGE_MARGIN = GRAPH.MAX_WIDTH * 1.45 + WORLD.SEABED_RANGE + 2;
const RIVER_MARGIN = HYDRO.RIVER_MAX_WIDTH + HYDRO.BANK + 8;
const LAKE_MARGIN = HYDRO.BANK + 8;
const HUB_PLAZA = 5;

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

  constructor(readonly graph: RoadGraph) {
    this.seed = graph.seed;
    this.noise = new Simplex2D((graph.seed ^ 0x3333) >>> 0);
    this.biomeNoise = new Simplex2D((graph.seed ^ 0x7e7e) >>> 0);

    this.edgeIndex = new CellIndex(CELL, graph.edges.length);
    graph.edges.forEach((e, i) => {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      this.edgeIndex.insert(i,
        Math.min(a.x, b.x) - EDGE_MARGIN, Math.min(a.z, b.z) - EDGE_MARGIN,
        Math.max(a.x, b.x) + EDGE_MARGIN, Math.max(a.z, b.z) + EDGE_MARGIN);
    });

    this.hydro = generateHydrology(graph, (x, z) => this.landProbe(x, z));
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
    this.structures = generateStructures(this);
    this.structIndex = new CellIndex(CELL, this.structures.all.length);
    this.structures.all.forEach((s, i) => {
      const b = structureBounds(s);
      this.structIndex!.insert(i, b.minX, b.minZ, b.maxX + 1, b.maxZ + 1);
    });
  }

  newSample(): TileSample {
    return { type: TileType.Skip, level: 0, height: 0, water: 0, shore: 0, biome: 0 as Biome, bank: false, roadDist: Infinity, roadWidth: 0, corners: [0, 0, 0, 0] };
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
    if (!lp) return { land: false, biome, roadDist: Infinity, hub, water: false };
    const w = this.waterAt(x, z, this.riverIndex.query(x - 1, z - 1, x + 1, z + 1));
    return { land: lp.land, biome, roadDist: lp.roadDist, hub, water: !!w && w.wd < 0 };
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
    out.water = 0; out.shore = 0; out.bank = false; out.level = 0; out.height = 0;
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
        const deck = surface + 0.14;
        for (let k = 0; k < 4; k++) out.corners[k] = Math.max(out.corners[k], deck);
        out.height = Math.max(out.height, deck);
      }
      return;
    }

    const baseLevel = Math.max(1, Math.round(roadLevel));
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
      type = rand2(this.seed, tx, tz, 3) < 0.35 ? TileType.GroundAlt : TileType.Ground;
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
    const ox = cx * CS - 1, oz = cz * CS - 1;
    const cands = this.edgeIndex.query(ox, oz, ox + size, oz + size);
    if (cands.length === 0) return chunk;
    const riverCands = this.riverIndex.query(ox, oz, ox + size, oz + size);
    const seed = this.seed;
    const s = this.newSample();
    let drawn = 0;

    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const idx = lz * size + lx;
        const tx = ox + lx, tz = oz + lz;
        this.sampleTile(tx, tz, s, cands, riverCands);
        if (s.type === TileType.Skip) continue;
        drawn++;
        chunk.type[idx] = s.type;
        chunk.biome[idx] = s.biome;
        chunk.height[idx] = s.height;
        chunk.water[idx] = s.water;
        chunk.shore[idx] = s.shore;
        if (s.type === TileType.Road || s.type === TileType.Bridge) {
          chunk.corners.set(s.corners, idx * 4);
          continue;
        }
        if (s.type === TileType.Seabed) continue;

        // --- props ---
        const def = BIOMES[s.biome];
        const r = rand2(seed, tx, tz, 7);
        const r2 = rand2(seed, tx, tz, 8);
        const type = s.type;
        if (type === TileType.Water) {
          if (r < def.waterDensity) chunk.prop[idx] = pickWeighted(def.water, r2);
          continue;
        }
        if (s.bank) {
          if (r < def.bankDensity) chunk.prop[idx] = pickWeighted(def.bank, r2);
          continue;
        }
        if (s.roadDist < s.roadWidth + 1.2) continue; // keep the road shoulder clear
        if (type === TileType.High) {
          if (r < 0.06) chunk.prop[idx] = r2 < 0.5 ? PropKind.Rock : PropKind.Boulder;
        } else if (type === TileType.Ground || type === TileType.GroundAlt) {
          if (r < def.propDensity) chunk.prop[idx] = pickWeighted(def.props, r2);
        } else if (type === TileType.Sand) {
          if (r < def.bankDensity * 0.25) chunk.prop[idx] = pickWeighted(def.bank, r2);
        }
      }
    }

    chunk.empty = drawn === 0;
    if (!chunk.empty) this.stampStructures(chunk, ox, oz);
    return chunk;
  }

  /** Flatten yards, lay door paths, and drop the building prop on its centre tile. */
  private stampStructures(chunk: ChunkData, ox: number, oz: number): void {
    if (!this.structIndex) return;
    const size = chunk.size;
    const CS = WORLD.CHUNK_SIZE;
    const hits = this.structIndex.query(ox, oz, ox + size, oz + size);
    const isLand = (t: number) =>
      t !== TileType.Skip && t !== TileType.Seabed && t !== TileType.Water && t !== TileType.Bridge;

    for (const si of hits) {
      const s = this.structures.all[si];
      const h = s.level * WORLD.STEP;
      const house = s.kind === StructureKind.House || s.kind === StructureKind.Church;
      if (s.kind === StructureKind.Plaza) {
        const r = s.radius ?? 4;
        for (let dz = -s.hd; dz <= s.hd; dz++) {
          for (let dx = -s.hw; dx <= s.hw; dx++) {
            if (Math.hypot(dx, dz) > r) continue;
            const lx = s.tx + dx - ox, lz = s.tz + dz - oz;
            if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
            const idx = lz * size + lx;
            if (!isLand(chunk.type[idx])) continue;
            chunk.type[idx] = TileType.Plaza;
            chunk.height[idx] = h;
            chunk.prop[idx] = PropKind.None;
          }
        }
        continue;
      }
      if (s.kind === StructureKind.Sign || s.kind === StructureKind.Stall) {
        // single-tile props: no yard, just the prop itself
        const lx = s.tx - ox, lz = s.tz - oz;
        if (lx >= 1 && lz >= 1 && lx <= CS && lz <= CS) {
          const idx = lz * size + lx;
          if (isLand(chunk.type[idx]) && chunk.type[idx] !== TileType.Floor) {
            chunk.prop[idx] = structureProp(s);
            chunk.propRot[idx] = s.rot;
          }
        }
        continue;
      }
      for (let dz = -s.hd - 1; dz <= s.hd + 1; dz++) {
        for (let dx = -s.hw - 1; dx <= s.hw + 1; dx++) {
          const lx = s.tx + dx - ox, lz = s.tz + dz - oz;
          if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
          const idx = lz * size + lx;
          const t = chunk.type[idx];
          if (!isLand(t) || t === TileType.Road) continue;
          const inner = Math.abs(dx) <= s.hw && Math.abs(dz) <= s.hd;
          chunk.height[idx] = h;
          chunk.prop[idx] = PropKind.None;
          if (inner && house) chunk.type[idx] = TileType.Floor;
          else if (t === TileType.High) chunk.type[idx] = TileType.Ground;
        }
      }
      for (const [x, z] of s.path) {
        const lx = x - ox, lz = z - oz;
        if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
        const idx = lz * size + lx;
        if (!isLand(chunk.type[idx]) || chunk.type[idx] === TileType.Plaza || chunk.type[idx] === TileType.Floor) continue;
        chunk.type[idx] = TileType.Road;
        chunk.height[idx] = h;
        chunk.corners.fill(h, idx * 4, idx * 4 + 4);
        chunk.prop[idx] = PropKind.None;
      }
      const lx = s.tx - ox, lz = s.tz - oz;
      if (lx >= 1 && lz >= 1 && lx <= CS && lz <= CS) {
        const idx = lz * size + lx;
        chunk.prop[idx] = structureProp(s);
        chunk.propRot[idx] = s.rot;
      }
    }
  }
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

import { GRAPH, HYDRO, WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { SALT, TILE_SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';
import { biomeAt, segDist2, type RoadGraph } from './graph';
import { BIOMES, type Biome, PropKind, pickWeighted } from './biomes';
import { generateHydrology, type Hydrology, type LandProbe } from './rivers';
import { isLand, type WorldMesh } from './mesh';
import { planMassifs, upliftAt, upliftRawAt, type Massif } from './mountains';
import { buildRanges, liftField, mountainAt, nearestLift, planBowl, terracesAt, type Ranges } from './ranges';
import { CellIndex } from './spatial';
import { generateStructures, structureBounds, StructureKind, type Structure, type Structures } from './structures';
import { stampCentreProp, stampFootprint, stampPath, stampPier, stampPlaza, stampSingleProp } from './stamp';

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
  Pier = 11,   // wooden deck over water; walkable, flat
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
  /** Heights at the 4 corners (NW, NE, SE, SW). Flat tiles repeat their own height four times. */
  corners: Float32Array;
  /**
   * 1 where the tile is a face of a mountain and is drawn as one leaning surface rather than a
   * terrace. Terraces are the look of this world and stay exactly as they were; a mountain is
   * cut from a smooth field, and mixing the two — a flat tile height with sloped corners — draws
   * tops and walls that disagree and tears the mesh apart.
   */
  sloped: Uint8Array;
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
  /** Whether this tile is part of a mountain face, and so drawn as a slope rather than a step. */
  sloped: boolean;
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
/**
 * What `landWidth` reports in a mesh world: the width of the countryside a road runs through,
 * not the size of the landmass. Kept near the old world's widest so everything tuned against it —
 * river sizes, how far off a road a shrine is set — stays in the range it was tuned for.
 */
const MESH_LAND_WIDTH = 22;

const GROUND_ALT_CHANCE = 0.35;
/** Neighbours (of 8) that must agree before the de-speckle filter overrides a tile's level. */
const DESPECKLE_MAJORITY = 5;
/** Tiles beyond the road edge kept free of props. */
const ROAD_SHOULDER = 1.2;
/** How far a mountain has to stand above the ground before nothing grows under it, in units. */
const PROP_HEADROOM = 1.5;
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
  /**
   * The polygons the world is tiled with, when it was grown that way.
   *
   * Its presence is what decides where land comes from. With a mesh, dry ground is somewhere
   * inside a dry face and the roads are only roads; without one, the old rule stands and land is
   * whatever lies within W tiles of a road. Both worlds can be generated, which is what lets the
   * two be compared rather than swapped over blind.
   */
  readonly mesh: WorldMesh | null;
  /** The world's mountains. Planned before structures, because structures sample the ground. */
  readonly massifs: Massif[];
  /**
   * The mountains of a polygon world, as geometry standing on the ground rather than as ground.
   *
   * Null in the road-tree world, which has no mountain country wide enough to put one in, and
   * where `massifs` above is still the answer. Built last of everything here: it asks how high the
   * ground is at a few hundred points, and the ground has to be finished before that means
   * anything.
   */
  readonly ranges: Ranges | null = null;
  /**
   * How many storeys the houses of a village have, by village name.
   *
   * Set from outside, because how rich a village is belongs to the register and changes by the
   * day, while the ground is a function of the seed. Chunks are rebuilt whenever they reload, so
   * a village that has prospered while you were away is taller when you come back without
   * anything having to be told to change.
   */
  readonly storeys = new Map<string, number>();

  constructor(readonly graph: RoadGraph, prebuilt?: { hydro: Hydrology; structures: Structures }) {
    this.seed = graph.seed;
    this.mesh = (graph as RoadGraph & { mesh?: WorldMesh }).mesh ?? null;
    this.noise = new Simplex2D(derive(graph.seed, SALT.TERRAIN));
    this.biomeNoise = new Simplex2D(derive(graph.seed, SALT.BIOME));

    this.edgeIndex = new CellIndex(CELL, graph.edges.length);
    graph.edges.forEach((e, i) => {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      this.edgeIndex.insert(i,
        Math.min(a.x, b.x) - EDGE_MARGIN, Math.min(a.z, b.z) - EDGE_MARGIN,
        Math.max(a.x, b.x) + EDGE_MARGIN, Math.max(a.z, b.z) + EDGE_MARGIN);
    });

    // The mountains go in before anything reads the ground, and before the water in particular:
    // a river has to know what it is running down. Their anchors come off the road tree rather
    // than off the village list, because villages are structures and structures are built from
    // the finished ground — asking them where the towns are would be a circle. The graph already
    // knows which nodes grew towns, which is the same answer one step earlier.
    //
    // Only in the road-tree world. A polygon world's mountains are polygons — built at the end of
    // this constructor, out of the faces the mesh already marked as mountain country — and a
    // massif raising the heightfield underneath them would be a second, rounder mountain standing
    // inside the first.
    this.massifs = this.mesh ? [] : planMassifs(graph.seed, graph, graph.towns.map((i) => graph.nodes[i]),
      (x, z) => {
        const probe = this.landProbe(x, z);
        if (!probe || !probe.land) return null;
        return { fromRoad: probe.roadDist, fromCoast: probe.landWidth - probe.roadDist };
      });

    // The mountains, measured from nothing, because the water has to know where the high ground is
    // before there is a settled ground for them to stand on.
    const high = this.mesh ? liftField(this.mesh) : null;
    this.hydro = prebuilt ? prebuilt.hydro : generateHydrology(
      graph,
      (x, z) => this.landProbe(x, z),
      // how high the ground is here, mountains included: without it no river ever ran down one
      (x, z, roadDist) => (high ? terracesAt(high, x, z) : upliftAt(x, z, this.massifs, roadDist)),
      // and how high they stand nearby, which is where water comes out of the ground
      (x, z) => (high ? nearestLift(high, x, z) : 0),
    );
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

    // The mountains, last. They stand on the finished ground rather than being part of it, so
    // this has to happen after everything that decides how high the ground is — and can, because
    // nothing above it asks where the mountains are. The ground is read at the corners and apexes
    // of the polygons only: a few hundred tiles for a whole world, against one per tile if the
    // mountains were a field again.
    if (this.mesh) {
      const probe = this.newSample();
      const groundAt = (x: number, z: number): number => {
        this.sampleTile(Math.round(x), Math.round(z), probe);
        return probe.height;
      };
      // one village in the world is walled into the mountains, with the roads it already had as the
      // only ways in. It is chosen here rather than in the geometry because it needs the villages,
      // and the villages are the last thing this constructor builds.
      const bowl = planBowl(this.mesh, this.structures.villages, (x, z) => {
        const land = this.landProbe(x, z);
        return land !== null && land.land;
      });
      this.ranges = buildRanges(this.mesh, groundAt, bowl
        ? { bowl, roadAway: (x, z) => this.landProbe(x, z)?.roadDist ?? Infinity }
        : undefined);
    }
  }

  newSample(): TileSample {
    return { type: TileType.Skip, level: 0, base: 0, height: 0, water: 0, shore: 0, biome: 0 as Biome, bank: false, roadDist: Infinity, roadWidth: 0, corners: [0, 0, 0, 0], sloped: false };
  }

  biomeOf(x: number, z: number): Biome {
    return biomeAt(this.graph, this.biomeNoise, x, z);
  }

  /** Road-relative facts about a point. Used by hydrology routing, structures and the HUD. */
  /**
   * Roughly how far this point is from water, in tiles, giving up past `most`.
   *
   * The road-tree world got this for nothing: land was a band around a line, so the distance to
   * the sea was the distance to the road subtracted from the band's width. A face has no such
   * arithmetic, so the ground is felt outward in rings until it stops being ground. Coarse on
   * purpose — it decides where a beach is drawn and how far the seabed reaches, and neither wants
   * more than a tile or so of precision.
   */
  private waterAway(x: number, z: number, most: number, looking: boolean): number {
    const mesh = this.mesh;
    if (!mesh) return most;
    // the distance to the nearest place where `isLand` is `looking`: pass false to find the water
    // from dry ground, true to find the shore from out at sea
    for (let r = 1; r <= most; r += 1.5) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (isLand(mesh, x + Math.cos(a) * r, z + Math.sin(a) * r) === looking) return r;
      }
    }
    return most;
  }

  landProbe(x: number, z: number): LandProbe | null {
    const cands = this.edgeIndex.query(x - 1, z - 1, x + 1, z + 1);
    const hit = this.nearest(x, z, cands);
    if (!hit) return null;
    const e = this.graph.edges[hit.edge];
    // With a mesh, land is not a band around the road and this is no longer what decides it. It
    // still has readers though — the rivers size themselves by it and landmarks are placed at a
    // fraction of it — so it stays the width of the country a road runs through rather than
    // becoming the radius of the world, which drowned the map in rivers and bridges.
    const W = this.mesh ? MESH_LAND_WIDTH : this.landWidth(hit.edge, x, z);
    const a = this.graph.nodes[e.a], b = this.graph.nodes[e.b];
    const roadLevel = a.level + (b.level - a.level) * hit.t;
    let ux = b.x - a.x, uz = b.z - a.z;
    const len = Math.hypot(ux, uz) || 1;
    ux /= len; uz /= len;
    return {
      land: this.mesh ? isLand(this.mesh, x, z) : hit.d < W,
      roadDist: hit.d, roadWidth: e.roadWidth, landWidth: W,
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
    out.roadDist = Infinity; out.roadWidth = 0; out.sloped = false;
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

    const wet = this.mesh ? !isLand(this.mesh, px, pz) : d >= W;
    if (wet) {
      // how far out to sea we are: measured off the coast with a mesh, off the road without one
      const away = this.mesh ? this.waterAway(px, pz, WORLD.SEABED_RANGE, true) : d - W;
      if (away < WORLD.SEABED_RANGE) {
        out.type = TileType.Seabed;
        out.shore = away;
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
    // and whatever the mountains put here, which is nought over most of the world and a great deal
    // in a few places. It is nought along a road at any height, so a pass stays a pass.
    const lift = upliftAt(px, pz, this.massifs, d);
    rise += lift;
    let level = Math.min(WORLD.MAX_LEVEL, baseLevel + rise);

    const COAST = 2.2;
    const shoreNear = this.mesh ? this.waterAway(px, pz, COAST, false) < COAST : d > W - COAST;
    let type: TileType;
    if (shoreNear) {
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
        // valley sides climb one terrace per ~1.4 tiles away from the bank.
        // Measured against the ground rather than against the mountain standing on it: a river
        // cuts a valley into the country it runs through, it does not shave the top off a peak
        // half a mile above it. Without the `lift` here a massif with a stream anywhere near it
        // came out as level 5 in the middle and broke into slabs around the edges.
        const cap = wl + Math.floor((water.wd - HYDRO.BANK) / 1.4);
        if (level - lift > cap) {
          level = cap + lift;
          if (type === TileType.High && level - baseLevel < def.highAt) type = TileType.Ground;
        }
      }
    }
    out.type = type;
    out.level = level;
    out.height = level * STEP;

    // Corners. Flat ground is flat, which is the whole look of this world and is left alone.
    // A mountain is drawn from the smooth field instead, so its faces are leaning surfaces rather
    // than a hundred half-unit steps. Only the drawing changes: `height` above is still the tile,
    // and still what anybody walking into the face has to climb, so a wall stays a wall.
    if (lift <= 0) {
      out.corners[0] = out.corners[1] = out.corners[2] = out.corners[3] = out.height;
    } else {
      const settled = out.height - lift * STEP;
      out.corners[0] = settled + upliftRawAt(tx, tz, this.massifs, d) * STEP;
      out.corners[1] = settled + upliftRawAt(tx + 1, tz, this.massifs, d) * STEP;
      out.corners[2] = settled + upliftRawAt(tx + 1, tz + 1, this.massifs, d) * STEP;
      out.corners[3] = settled + upliftRawAt(tx, tz + 1, this.massifs, d) * STEP;
      // the tile *is* its corners now, so nothing draws a step in the middle of a mountain face.
      // Still far too steep to climb — a face runs several terraces to the tile against a stride
      // of one — so what this changes is how it looks and not where anybody can go.
      out.height = (out.corners[0] + out.corners[1] + out.corners[2] + out.corners[3]) / 4;
      out.sloped = true;
    }
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
      sloped: new Uint8Array(n),
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
        if (grid.sloped[gi] === 1) {
          // a mountain face is taken exactly as it was cut, corners and all. The de-speckle filter
          // works in whole terraces and has nothing to say about a surface that has none.
          chunk.sloped[idx] = 1;
          chunk.height[idx] = grid.height[gi];
          chunk.corners.set(grid.corners.subarray(gi * 4, gi * 4 + 4), idx * 4);
        } else {
          chunk.height[idx] = level * WORLD.STEP;
          chunk.corners.fill(level * WORLD.STEP, idx * 4, idx * 4 + 4);
        }
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
      corners: new Float32Array(n * 4), sloped: new Uint8Array(n),
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
        grid.corners.set(s.corners, gi * 4);
        grid.sloped[gi] = s.sloped ? 1 : 0;
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
    // Nothing grows under a mountain. The ground beneath one is still generated — it is what the
    // rock stands on, and the rim needs it — but a tree rooted in ground that is now the inside of
    // a mountain is a trunk sticking out of a cliff. A hand's breadth of clearance rather than
    // nought, so the skirt where the rock meets the grass still has its scrub.
    if (this.ranges) {
      const rock = mountainAt(this.ranges, tx + 0.5, tz + 0.5);
      if (rock !== null && rock > grid.height[gi] + PROP_HEADROOM) return PropKind.None;
    }
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
  /** Which village a structure belongs to, by whose radius it falls inside. Empty for the wild. */
  private villageHolding(s: Structure): string {
    for (const v of this.structures.villages) {
      if (Math.hypot(v.x - s.tx, v.z - s.tz) <= v.radius) return v.name;
    }
    return '';
  }

  private stampStructures(chunk: ChunkData, ox: number, oz: number): void {
    if (!this.structIndex) return;
    const hits = this.structIndex.query(ox, oz, ox + chunk.size, oz + chunk.size);
    for (const si of hits) {
      const s = this.structures.all[si];
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
          // a house is as tall as the village it stands in has managed to become
          stampCentreProp(chunk, ox, oz, s, this.storeys.get(this.villageHolding(s)) ?? 1);
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
  sloped: Uint8Array;
  base: Int16Array;
  corners: Float32Array;
}

/** Tiles whose level the de-speckle filter may compare and adjust. */
function isFlatLand(t: TileType): boolean {
  return t === TileType.Ground || t === TileType.GroundAlt || t === TileType.High || t === TileType.Sand;
}

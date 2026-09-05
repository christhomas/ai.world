import { WORLD } from '../core/config';
import { rand2 } from '../core/rng';
import { TILE_SALT } from '../core/salts';
import { BIOMES } from './biomes';
import { TileType, type ChunkData } from './terrain';

/**
 * Turns a chunk into flat-shaded, vertex-coloured meshes: a land mesh (top quad per tile plus
 * cliff walls wherever a neighbour is lower) and a water mesh (river/lake surfaces plus vertical
 * waterfall quads wherever water steps down). One draw call each per chunk, no textures.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Water only: 1 on waterfall faces, 0 on still surfaces. Drives the shader animation. */
  flow?: Float32Array;
}

export interface ChunkMeshes {
  land: MeshData | null;
  water: MeshData | null;
}

type RGB = [number, number, number];

const linearCache = new Map<number, RGB>();

/** sRGB hex → linear RGB, matching what three.js does for `new Color(hex)`. */
export function hexToLinear(hex: number): RGB {
  let c = linearCache.get(hex);
  if (!c) {
    const conv = (v: number) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    c = [conv((hex >> 16) & 255), conv((hex >> 8) & 255), conv(hex & 255)];
    linearCache.set(hex, c);
  }
  return c;
}

const DEEP_SEABED = 0x2c5f7c;
const RIVER = 0x3fa3da;
const FOAM = 0xd9f0fb;
const BRIDGE_TOP = 0x9a6a3d;
const BRIDGE_SIDE = 0x6e4a2a;
const FLOOR = 0x8a7a62;
const PLAZA = 0xbfb096;
/** River beds are the biome's sand, darkened this much (they are seen through water). */
const WET_BED = [0.7, 0.72, 0.72] as const;
/** Per-tile brightness jitter so flat fields still read as many facets. */
const SHADE_MIN = 0.94, SHADE_RANGE = 0.12;
/** Drops up to this fraction of a terrace are ramp lips, drawn in the top colour instead of cliff. */
const LIP_FRACTION = 0.6;
const LIP_DARKEN = 0.8;
/** Waterfall faces sit this far into the lower tile so they never z-fight with the bed cliff behind. */
const FALL_OFFSET = 0.02;
/** Ignore height differences smaller than this when deciding to draw a wall or a fall. */
const EPS = 1e-3;
const FALL_EPS = 0.01;

/**
 * The four sides of a tile. Corner indices: 0 = NW (x,z), 1 = NE (x+1,z), 2 = SE (x+1,z+1), 3 = SW (x,z+1).
 * `mine`/`theirs` are the corner pairs that meet along the shared edge; `a`/`b` are that edge's endpoints.
 */
interface Side {
  dx: number; dz: number;
  mine: [number, number];
  theirs: [number, number];
  a: [number, number];
  b: [number, number];
  nx: number; nz: number;
}
const SIDES: readonly Side[] = [
  { dx: 1, dz: 0, mine: [1, 2], theirs: [0, 3], a: [1, 0], b: [1, 1], nx: 1, nz: 0 },   // east
  { dx: -1, dz: 0, mine: [0, 3], theirs: [1, 2], a: [0, 0], b: [0, 1], nx: -1, nz: 0 }, // west
  { dx: 0, dz: 1, mine: [3, 2], theirs: [0, 1], a: [0, 1], b: [1, 1], nx: 0, nz: 1 },   // south
  { dx: 0, dz: -1, mine: [0, 1], theirs: [3, 2], a: [0, 0], b: [1, 0], nx: 0, nz: -1 }, // north
];

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  flows: number[] = [];
  indices: number[] = [];
  private vcount = 0;

  /** Emit a quad p0..p3 facing `n`. Winding is fixed up automatically. */
  quad(p0: number[], p1: number[], p2: number[], p3: number[], nx: number, ny: number, nz: number, color: RGB, flow = 0): void {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.vcount;
    for (const p of [p0, p1, p2, p3]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(color[0], color[1], color[2]);
      this.flows.push(flow);
    }
    if (flip) this.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vcount += 4;
  }

  get empty(): boolean { return this.indices.length === 0; }

  build(withFlow: boolean): MeshData {
    const out: MeshData = {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      colors: Float32Array.from(this.colors),
      indices: Uint32Array.from(this.indices),
    };
    if (withFlow) out.flow = Float32Array.from(this.flows);
    return out;
  }
}

/** Reads a chunk with its apron; hides the index arithmetic from the mesher loops. */
class ChunkView {
  readonly CS = WORLD.CHUNK_SIZE;
  constructor(private readonly c: ChunkData) {}

  index(lx: number, lz: number): number { return (lz + 1) * this.c.size + (lx + 1); }
  type(lx: number, lz: number): TileType { return this.c.type[this.index(lx, lz)] as TileType; }

  /**
   * Corner heights of a tile.
   *
   * Every tile carries them now. Flat ground sets all four to its own height, so the terraced look
   * is exactly what it was; roads carry ramp corners as they always did; a mountain carries the
   * smooth field it was cut from, which is what makes its faces lean instead of staircase.
   */
  corners(lx: number, lz: number, out: number[]): void {
    const i = this.index(lx, lz);
    if (this.c.type[i] === TileType.Skip) { out[0] = out[1] = out[2] = out[3] = 0; return; }
    for (let k = 0; k < 4; k++) out[k] = this.c.corners[i * 4 + k];
  }

  /** Water surface height a neighbour presents to us, or -1 if it is dry land. */
  surface(lx: number, lz: number): number {
    const i = this.index(lx, lz);
    const t = this.c.type[i];
    if (t === TileType.Water || t === TileType.Bridge) return this.c.water[i];
    if (t === TileType.Seabed || t === TileType.Skip) return WORLD.WATER_Y;
    return -1;
  }
}

/** Top colour for a tile, in linear RGB, including seabed depth fade and wet river beds. */
function topColor(c: ChunkData, i: number, type: TileType): RGB {
  const def = BIOMES[c.biome[i]];
  let hex: number;
  switch (type) {
    case TileType.Road: hex = def.road; break;
    case TileType.Bridge: hex = BRIDGE_TOP; break;
    case TileType.Sand: hex = def.sand; break;
    case TileType.High: hex = def.high; break;
    case TileType.GroundAlt: hex = def.groundAlt; break;
    case TileType.Seabed: hex = def.sand; break;
    case TileType.Water: hex = def.sand; break;
    case TileType.Floor: hex = FLOOR; break;
    case TileType.Plaza: hex = PLAZA; break;
    case TileType.Pier: hex = BRIDGE_TOP; break;
    default: hex = def.ground;
  }
  const [r, g, b] = hexToLinear(hex);
  if (type === TileType.Seabed) {
    const t = Math.min(1, c.shore[i] / WORLD.SEABED_RANGE);
    const [dr, dg, db] = hexToLinear(DEEP_SEABED);
    return [r + (dr - r) * t, g + (dg - g) * t, b + (db - b) * t];
  }
  if (type === TileType.Water) return [r * WET_BED[0], g * WET_BED[1], b * WET_BED[2]];
  return [r, g, b];
}

/** Normal of a road/bridge top: tilted to match the ramp so lighting follows the slope. */
function slopeNormal(me: number[]): [number, number, number] {
  const dzx = (me[1] + me[2] - me[0] - me[3]) * 0.5;
  const dzz = (me[2] + me[3] - me[0] - me[1]) * 0.5;
  const len = Math.hypot(dzx, 1, dzz);
  return [-dzx / len, 1 / len, -dzz / len];
}

export function buildChunkMesh(chunk: ChunkData, seed: number): ChunkMeshes {
  if (chunk.empty) return { land: null, water: null };
  const view = new ChunkView(chunk);
  const CS = view.CS;
  const ox = chunk.cx * CS, oz = chunk.cz * CS;
  const land = new MeshBuilder();
  const water = new MeshBuilder();
  const me = [0, 0, 0, 0], nb = [0, 0, 0, 0];
  const foam = hexToLinear(FOAM);
  const river = hexToLinear(RIVER);

  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const i = view.index(lx, lz);
      const type = chunk.type[i] as TileType;
      if (type === TileType.Skip) continue;
      const def = BIOMES[chunk.biome[i]];
      const wx = ox + lx, wz = oz + lz;

      const shade = SHADE_MIN + rand2(seed, wx, wz, TILE_SALT.SHADE) * SHADE_RANGE;
      const base = topColor(chunk, i, type);
      const top: RGB = [base[0] * shade, base[1] * shade, base[2] * shade];

      view.corners(lx, lz, me);
      // anything whose corners disagree is a real surface and has to be lit like one. Ramps were
      // the only such thing until mountains arrived; a leaning face lit straight up reads as flat
      // ground stuck on at an angle, which is most of what made the first mountains look wrong.
      const leaning = chunk.sloped[i] === 1 || type === TileType.Road || type === TileType.Bridge;
      const [nx, ny, nz] = leaning ? slopeNormal(me) : [0, 1, 0];
      land.quad([wx, me[0], wz], [wx, me[3], wz + 1], [wx + 1, me[2], wz + 1], [wx + 1, me[1], wz], nx, ny, nz, top);

      // cliff walls toward any lower neighbour; edge endpoints use corner heights so ramps stay watertight
      const isBridge = type === TileType.Bridge || type === TileType.Pier;
      const cliff = hexToLinear(isBridge ? BRIDGE_SIDE : def.cliff);
      const lip: RGB = [top[0] * LIP_DARKEN, top[1] * LIP_DARKEN, top[2] * LIP_DARKEN];
      for (const side of SIDES) {
        view.corners(lx + side.dx, lz + side.dz, nb);
        const a = me[side.mine[0]], b = me[side.mine[1]];
        const na = nb[side.theirs[0]], nbh = nb[side.theirs[1]];
        if (na >= a - EPS && nbh >= b - EPS) continue;
        const drop = Math.max(a - na, b - nbh);
        const small = !isBridge && drop <= WORLD.STEP * LIP_FRACTION;
        const xa = wx + side.a[0], za = wz + side.a[1], xb = wx + side.b[0], zb = wz + side.b[1];
        land.quad([xa, Math.min(na, a), za], [xb, Math.min(nbh, b), zb], [xb, b, zb], [xa, a, za], side.nx, 0, side.nz, small ? lip : cliff);
      }

      // --- water surface + waterfalls ---
      const s = chunk.water[i];
      if (s <= 0) continue;
      if (s > WORLD.WATER_Y + EPS) {
        // sea-level water is covered by the global sea plane; only elevated water needs its own quad
        water.quad([wx, s, wz], [wx, s, wz + 1], [wx + 1, s, wz + 1], [wx + 1, s, wz], 0, 1, 0, river, 0);
      }
      for (const side of SIDES) {
        const ns = view.surface(lx + side.dx, lz + side.dz);
        if (ns < 0 || ns >= s - FALL_EPS) continue;
        const fx = side.nx * FALL_OFFSET, fz = side.nz * FALL_OFFSET;
        const xa = wx + side.a[0] + fx, za = wz + side.a[1] + fz, xb = wx + side.b[0] + fx, zb = wz + side.b[1] + fz;
        water.quad([xa, ns, za], [xb, ns, zb], [xb, s, zb], [xa, s, za], side.nx, 0, side.nz, foam, 1);
      }
    }
  }
  return {
    land: land.empty ? null : land.build(false),
    water: water.empty ? null : water.build(true),
  };
}

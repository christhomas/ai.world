import { WORLD } from '../core/config';
import { rand2 } from '../core/rng';
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

const linearCache = new Map<number, [number, number, number]>();

/** sRGB hex → linear RGB, matching what three.js does for `new Color(hex)`. */
export function hexToLinear(hex: number): [number, number, number] {
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

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  flows: number[] = [];
  indices: number[] = [];
  private vcount = 0;

  /** Emit a quad p0..p3 facing `n`. Winding is fixed up automatically. */
  quad(
    p0: number[], p1: number[], p2: number[], p3: number[],
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
    flow = 0,
  ): void {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.vcount;
    for (const p of [p0, p1, p2, p3]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(r, g, b);
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

export function buildChunkMesh(chunk: ChunkData, seed: number): ChunkMeshes {
  if (chunk.empty) return { land: null, water: null };
  const CS = WORLD.CHUNK_SIZE;
  const size = chunk.size;
  const ox = chunk.cx * CS, oz = chunk.cz * CS;
  const land = new MeshBuilder();
  const water = new MeshBuilder();

  // Corner heights of any tile: road/bridge tiles carry real ramp corners, everything else is flat.
  const cornersOf = (lx: number, lz: number, out: number[]): void => {
    const i = (lz + 1) * size + (lx + 1);
    const t = chunk.type[i];
    if (t === TileType.Skip) { out[0] = out[1] = out[2] = out[3] = 0; return; }
    if (t === TileType.Road || t === TileType.Bridge) {
      out[0] = chunk.corners[i * 4]; out[1] = chunk.corners[i * 4 + 1];
      out[2] = chunk.corners[i * 4 + 2]; out[3] = chunk.corners[i * 4 + 3];
      return;
    }
    out[0] = out[1] = out[2] = out[3] = chunk.height[i];
  };
  // Water surface height a neighbour presents to us, or -1 if it is dry land.
  const surfaceOf = (lx: number, lz: number): number => {
    const i = (lz + 1) * size + (lx + 1);
    const t = chunk.type[i];
    if (t === TileType.Water || t === TileType.Bridge) return chunk.water[i];
    if (t === TileType.Seabed || t === TileType.Skip) return WORLD.WATER_Y;
    return -1;
  };
  const me = [0, 0, 0, 0], nb = [0, 0, 0, 0];
  const [fr, fg, fb] = hexToLinear(FOAM);
  const [rr, rg, rb] = hexToLinear(RIVER);

  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const i = (lz + 1) * size + (lx + 1);
      const type = chunk.type[i] as TileType;
      if (type === TileType.Skip) continue;
      const def = BIOMES[chunk.biome[i]];
      const wx = ox + lx, wz = oz + lz;

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
        default: hex = def.ground;
      }
      let [r, g, b] = hexToLinear(hex);
      if (type === TileType.Seabed) {
        const t = Math.min(1, chunk.shore[i] / WORLD.SEABED_RANGE);
        const [dr, dg, db] = hexToLinear(DEEP_SEABED);
        r += (dr - r) * t; g += (dg - g) * t; b += (db - b) * t;
      } else if (type === TileType.Water) {
        r *= 0.7; g *= 0.72; b *= 0.72; // wet bed
      }
      // per-tile brightness jitter so flat fields still read as many facets
      const v = 0.94 + rand2(seed, wx, wz, 11) * 0.12;
      const tr = r * v, tg = g * v, tb = b * v;

      // corners: 0 = NW (wx,wz)  1 = NE (wx+1,wz)  2 = SE (wx+1,wz+1)  3 = SW (wx,wz+1)
      cornersOf(lx, lz, me);
      const sloped = type === TileType.Road || type === TileType.Bridge;
      let nx = 0, ny = 1, nz = 0;
      if (sloped) {
        const dzx = (me[1] + me[2] - me[0] - me[3]) * 0.5;
        const dzz = (me[2] + me[3] - me[0] - me[1]) * 0.5;
        const len = Math.hypot(dzx, 1, dzz);
        nx = -dzx / len; ny = 1 / len; nz = -dzz / len;
      }
      land.quad(
        [wx, me[0], wz], [wx, me[3], wz + 1], [wx + 1, me[2], wz + 1], [wx + 1, me[1], wz],
        nx, ny, nz, tr, tg, tb,
      );

      // cliff walls toward any lower neighbour; edge endpoints use corner heights so ramps stay watertight
      const isBridge = type === TileType.Bridge;
      const [cr, cg, cb] = hexToLinear(isBridge ? BRIDGE_SIDE : def.cliff);
      const wall = (a: number, b2: number, na: number, nbh: number, xa: number, za: number, xb: number, zb: number, wnx: number, wnz: number) => {
        if (na >= a - 1e-3 && nbh >= b2 - 1e-3) return;
        const drop = Math.max(a - na, b2 - nbh);
        const small = !isBridge && drop <= WORLD.STEP * 0.6; // low lip next to a ramp: keep top colour, just darker
        const s = small ? 0.8 : 1;
        const wr = small ? tr * s : cr, wg = small ? tg * s : cg, wb = small ? tb * s : cb;
        land.quad([xa, Math.min(na, a), za], [xb, Math.min(nbh, b2), zb], [xb, b2, zb], [xa, a, za], wnx, 0, wnz, wr, wg, wb);
      };
      cornersOf(lx + 1, lz, nb);
      wall(me[1], me[2], nb[0], nb[3], wx + 1, wz, wx + 1, wz + 1, 1, 0);
      cornersOf(lx - 1, lz, nb);
      wall(me[0], me[3], nb[1], nb[2], wx, wz, wx, wz + 1, -1, 0);
      cornersOf(lx, lz + 1, nb);
      wall(me[3], me[2], nb[0], nb[1], wx, wz + 1, wx + 1, wz + 1, 0, 1);
      cornersOf(lx, lz - 1, nb);
      wall(me[0], me[1], nb[3], nb[2], wx, wz, wx + 1, wz, 0, -1);

      // --- water surface + waterfalls ---
      const s = chunk.water[i];
      if (s <= 0) continue;
      if (s > WORLD.WATER_Y + 0.001) {
        // sea-level water is covered by the global sea plane; only elevated water needs its own quad
        water.quad([wx, s, wz], [wx, s, wz + 1], [wx + 1, s, wz + 1], [wx + 1, s, wz], 0, 1, 0, rr, rg, rb, 0);
      }
      const fall = (ns: number, p0: number[], p1: number[], p2: number[], p3: number[], fnx: number, fnz: number) => {
        if (ns < 0 || ns >= s - 0.01) return;
        water.quad(p0, p1, p2, p3, fnx, 0, fnz, fr, fg, fb, 1);
      };
      // faces sit 0.02 into the lower tile so they never z-fight with the bed cliff behind them
      let ns = surfaceOf(lx + 1, lz);
      fall(ns, [wx + 1.02, ns, wz], [wx + 1.02, ns, wz + 1], [wx + 1.02, s, wz + 1], [wx + 1.02, s, wz], 1, 0);
      ns = surfaceOf(lx - 1, lz);
      fall(ns, [wx - 0.02, ns, wz], [wx - 0.02, ns, wz + 1], [wx - 0.02, s, wz + 1], [wx - 0.02, s, wz], -1, 0);
      ns = surfaceOf(lx, lz + 1);
      fall(ns, [wx, ns, wz + 1.02], [wx + 1, ns, wz + 1.02], [wx + 1, s, wz + 1.02], [wx, s, wz + 1.02], 0, 1);
      ns = surfaceOf(lx, lz - 1);
      fall(ns, [wx, ns, wz - 0.02], [wx + 1, ns, wz - 0.02], [wx + 1, s, wz - 0.02], [wx, s, wz - 0.02], 0, -1);
    }
  }
  return {
    land: land.empty ? null : land.build(false),
    water: water.empty ? null : water.build(true),
  };
}

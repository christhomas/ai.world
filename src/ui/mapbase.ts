import { WORLD } from '../core/config';
import { BIOMES, type Biome } from '../world/biomes';
import type { RoadGraph } from '../world/graph';
import { parseChunkKey } from '../world/spatial';

/** Pixels per tile in the pre-rendered base image. Everything else scales from this. */
export const BASE_SCALE = 1.6;

/** The sea, as a css colour and as a number, because the fill wants one and the pixels the other. */
const SEA = '#1b4466';
const SEA_RGB = 0x1b4466;

/**
 * What the map needs of the terrain, and nothing else.
 *
 * Narrow on purpose: the map asks what is at a point and does not want the sampler's hundred other
 * answers, so the two can be tested apart and the map cannot quietly grow a dependency on how the
 * ground is built.
 */
export interface MapGround {
  probe(x: number, z: number): { land: boolean; biome: Biome };
  /**
   * How high the rock stands at a point, in world units, or nought where there is none.
   *
   * Mountains are not in the heightfield of a polygon world — they are geometry standing on it —
   * so a map drawn from the ground alone shows a range as ordinary highland. Optional, because the
   * road-tree world has no such thing and its mountains are already in the ground it is drawn from.
   */
  rock?: (x: number, z: number) => number;
}

export interface MapBase {
  canvas: HTMLCanvasElement;
  /** World offset baked into the image, in tiles: image pixel = (world + pad) * BASE_SCALE. */
  pad: number;
}

/**
 * How many image pixels one probe of the ground covers.
 *
 * The map is drawn by asking the terrain what is at a point, and asking is cheap but not free —
 * around ten thousand probes to the millisecond. At one probe a pixel a large world costs the best
 * part of a second at start-up; at one per two-pixel square it costs a quarter of that, and since
 * a base pixel is already less than a tile of ground, the block is smaller than the smallest thing
 * the map could meaningfully show.
 */
const PROBE_BLOCK = 2;

/**
 * The world drawn once into an offscreen canvas: the ground as it actually is, then the roads on
 * top of it. Both the corner minimap and the full-screen map sample from this, so they can never
 * disagree with each other.
 *
 * It used to be drawn from the road graph alone — sea everywhere, then a thick stroke of biome
 * colour along every road, on the reasoning that land is the ribbon either side of a road. That is
 * true of the road-tree world and it is not true at all of the polygon world, where land is
 * whatever falls inside a land face and the roads merely run along the borders between them. The
 * map there drew the lattice of borders and called every acre inside them sea: no coastline, no
 * water where there was water, and nothing that matched the country you were standing in.
 *
 * So it asks the terrain now, the same terrain the ground is built from, and neither world can
 * disagree with its own map again.
 */
export function renderMapBase(graph: RoadGraph, sampler: MapGround): MapBase {
  const pad = graph.radius + 8;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(pad * 2 * BASE_SCALE);
  canvas.height = canvas.width;
  const c = canvas.getContext('2d')!;
  const s = BASE_SCALE, o = pad * BASE_SCALE;

  c.fillStyle = SEA;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // the ground itself, block by block. Written straight into the pixels rather than as thousands
  // of little fills, which is the difference between a moment at start-up and a visible stall
  const img = c.createImageData(canvas.width, canvas.height);
  const px = img.data;
  for (let y = 0; y < canvas.height; y += PROBE_BLOCK) {
    for (let x = 0; x < canvas.width; x += PROBE_BLOCK) {
      const wx = x / s - pad, wz = y / s - pad;
      const here = sampler.probe(wx, wz);
      const ground = here.land ? BIOMES[here.biome].ground : SEA_RGB;
      // rock over the top of it, going white at the summits, so a range reads as a range at a
      // glance rather than as a patch of highland that happens to be a different green
      const high = sampler.rock ? sampler.rock(wx, wz) : 0;
      const colour = high > 0 ? overRock(ground, high) : ground;
      const r = (colour >> 16) & 255, g = (colour >> 8) & 255, b = colour & 255;
      for (let dy = 0; dy < PROBE_BLOCK && y + dy < canvas.height; dy++) {
        let i = ((y + dy) * canvas.width + x) * 4;
        for (let dx = 0; dx < PROBE_BLOCK && x + dx < canvas.width; dx++) {
          px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
          i += 4;
        }
      }
    }
  }
  c.putImageData(img, 0, 0);

  c.strokeStyle = 'rgba(90, 65, 40, 0.75)';
  for (const e of graph.edges) {
    const a = graph.nodes[e.a], b = graph.nodes[e.b];
    c.lineWidth = Math.max(0.8, e.roadWidth * 2 * s);
    c.beginPath();
    c.moveTo(o + a.x * s, o + a.z * s);
    c.lineTo(o + b.x * s, o + b.z * s);
    c.stroke();
  }
  return { canvas, pad };
}

/** The unexplored dark, punched out chunk by chunk as the hero walks. */
/** Rock on the map: grey at the foot, white at the top of the tallest thing a world holds. */
function overRock(ground: number, high: number): number {
  const up = Math.max(0, Math.min(1, high / MAP_SUMMIT));
  const mix = (from: number, to: number, shift: number): number =>
    Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * up);
  // the foot of a mountain is still the country it stands in, so the ground colour shows through
  // where the rock is low and gives way entirely by the summit
  const rock = up > 0.72 ? MAP_SNOW : MAP_ROCK;
  return (mix(ground, rock, 16) << 16) | (mix(ground, rock, 8) << 8) | mix(ground, rock, 0);
}

/** The height at which rock is drawn as pale as it gets, in world units. */
const MAP_SUMMIT = 52;
const MAP_ROCK = 0x8d8d8d;
const MAP_SNOW = 0xeef2f5;

export class Fog {
  readonly canvas: HTMLCanvasElement;

  constructor(private readonly base: MapBase) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = base.canvas.width;
    this.canvas.height = base.canvas.height;
    const f = this.canvas.getContext('2d')!;
    f.fillStyle = 'rgba(6, 10, 26, 0.88)';
    f.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  reveal(chunkKeys: Iterable<string>): void {
    const f = this.canvas.getContext('2d')!;
    const CS = WORLD.CHUNK_SIZE, s = BASE_SCALE, o = this.base.pad * BASE_SCALE;
    for (const key of chunkKeys) {
      const [cx, cz] = parseChunkKey(key);
      f.clearRect(o + cx * CS * s, o + cz * CS * s, CS * s, CS * s);
    }
  }
}

export interface MapMarker {
  x: number;
  z: number;
  color: string;
  /** Drawn beside the dot on the full-screen map. */
  label?: string;
  /** Bigger dot and a ring: quest targets and the like. */
  emphasis?: boolean;
}

/**
 * The angle to rotate a map by so that "up" on the canvas is the way somebody is facing.
 *
 * A rig's yaw is measured the way `yawFor` measures it — forward is (cos yaw, -sin yaw), with z
 * running the opposite way to the angle. A map canvas has z running straight down its y axis, so
 * the same heading is the negative of the yaw. It is one minus sign and it is the sort of thing
 * that is wrong for a fortnight before anybody notices the arrow points the wrong way, so it is
 * written down once and tested rather than being inlined at each map that wants it.
 */
export function headingOnMap(yaw: number): number {
  return -yaw;
}

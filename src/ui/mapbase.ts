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
      const here = sampler.probe(x / s - pad, y / s - pad);
      const colour = here.land ? BIOMES[here.biome].ground : SEA_RGB;
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

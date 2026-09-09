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
 * Sea left round the outside of the drawn country, in tiles.
 *
 * The map is as big as the roads it has to draw, and the last road is not the last land: the
 * ground is a band either side of one, twenty-odd tiles of it at its widest, and the coast and its
 * shallows lie beyond that. Too little and a map ends in a straight green line where the canvas
 * stopped rather than where the country did. Too much and every map is mostly empty sea, at four
 * bytes and one probe of the terrain for every pixel of it.
 */
const MAP_MARGIN = 32;

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
  // As far out as the roads go, and no further. It used to be the world's radius plus a few tiles,
  // which is the same number for a mainland and wrong for everything else: the islands are anchored
  // past where the mainland reaches, so on a world whose islands stand seven hundred tiles out the
  // map ended at four hundred and eighty and they were simply not on it. Sailing to one put the
  // hero off the edge of his own map. A patch of an endless world has no radius to be padded out
  // to at all, and this asks it the only question that has an answer anywhere: where is the
  // furthest thing you are asking me to draw.
  const reach = graph.nodes.reduce((most, n) => Math.max(most, Math.abs(n.x), Math.abs(n.z)), 0);
  const pad = reach + MAP_MARGIN;
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

/**
 * The dark over the country you have not walked yet.
 *
 * What is remembered is a set of chunks — that is what the save holds, and it is the right thing
 * to hold. What was wrong was drawing it: each chunk was punched out as a hard rectangle, so the
 * edge of the known world was a staircase with sixteen-tile steps. On the corner map that is a
 * third of the width per step, and the map turns with the camera, so the steps arrive as a huge
 * blocky diamond sitting on the picture. It reads as a fault rather than as fog — which is exactly
 * what it was reported as: a black area that does not show properly.
 *
 * So the union of the chunks is kept on a mask of its own and blurred once as it is punched out.
 * Blurring each rectangle separately would not do: where two chunks meet, each would take about
 * half of what is left and the seam between them would stay half dark, so the inside of the known
 * world would be criss-crossed with the grid it was revealed in. One mask, one blur, and the only
 * soft edge is the outer one.
 */
const FOG = {
  /**
   * How dark the unknown is.
   *
   * Left where it was. Lightening it was tried at the same time as the feather and made the map
   * worse in a way the feather alone did not: the land beneath came up as a warm brown wash and
   * the whole picture went muddy, so that neither what you know nor what you do not was clear.
   * The edge was the fault, not the darkness.
   */
  INK: 'rgba(6, 10, 26, 0.88)',
  /**
   * How far the edge is feathered, in base-map pixels.
   *
   * `BASE_SCALE` pixels to the tile, so this is about six tiles of dusk — wide enough to read as
   * softness on the corner map, where a hundred and ten tiles cross a hundred and eighty pixels,
   * and narrow enough not to wash out the world map at full zoom.
   */
  FEATHER: 9,
} as const;

export class Fog {
  readonly canvas: HTMLCanvasElement;
  /** The union of everywhere that has been walked, in white on black. Never shrinks. */
  private readonly mask: HTMLCanvasElement;
  private known = 0;

  constructor(private readonly base: MapBase) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = base.canvas.width;
    this.canvas.height = base.canvas.height;
    this.mask = document.createElement('canvas');
    this.mask.width = base.canvas.width;
    this.mask.height = base.canvas.height;
    this.repaint();
  }

  reveal(chunkKeys: Iterable<string>): void {
    const m = this.mask.getContext('2d')!;
    const CS = WORLD.CHUNK_SIZE, s = BASE_SCALE, o = this.base.pad * BASE_SCALE;
    m.fillStyle = '#fff';
    let seen = 0;
    for (const key of chunkKeys) {
      const [cx, cz] = parseChunkKey(key);
      m.fillRect(o + cx * CS * s, o + cz * CS * s, CS * s, CS * s);
      seen++;
    }
    // the mask only grows, so a call that adds nothing is a call that need not repaint the fog —
    // and this runs from the frame loop every time a chunk boundary is crossed
    if (seen === this.known) return;
    this.known = seen;
    this.repaint();
  }

  /** Fill the dark, then take the known world back out of it with one soft-edged stroke. */
  private repaint(): void {
    const f = this.canvas.getContext('2d')!;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.filter = 'none';
    f.clearRect(0, 0, this.canvas.width, this.canvas.height);
    f.fillStyle = FOG.INK;
    f.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.known === 0) return;
    f.globalCompositeOperation = 'destination-out';
    // where a browser will not blur, the edge comes out as it always did rather than not at all
    f.filter = `blur(${FOG.FEATHER}px)`;
    f.drawImage(this.mask, 0, 0);
    f.filter = 'none';
    f.globalCompositeOperation = 'source-over';
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

import { WORLD } from '../core/config';
import { SALT, derive } from '../core/salts';
import { BIOMES } from '../world/biomes';
import { sectorMix, type RoadGraph } from '../world/graph';
import { Simplex2D } from '../world/noise';
import { parseChunkKey } from '../world/spatial';

/** Pixels per tile in the pre-rendered base image. Everything else scales from this. */
export const BASE_SCALE = 1.6;

export interface MapBase {
  canvas: HTMLCanvasElement;
  /** World offset baked into the image, in tiles: image pixel = (world + pad) * BASE_SCALE. */
  pad: number;
}

/**
 * The world drawn once into an offscreen canvas: sea, then a thick stroke of biome colour along
 * every road (the land), then the roads themselves. Both the corner minimap and the full-screen
 * map sample from this, so they can never disagree.
 */
export function renderMapBase(graph: RoadGraph): MapBase {
  const pad = graph.radius + 8;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(pad * 2 * BASE_SCALE);
  canvas.height = canvas.width;
  const c = canvas.getContext('2d')!;
  const s = BASE_SCALE, o = pad * BASE_SCALE;

  c.fillStyle = '#1b4466';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const noise = new Simplex2D(derive(graph.seed, SALT.BIOME));
  const mix = (h1: number, h2: number, t: number) => {
    const r = ((h1 >> 16) & 255) * (1 - t) + ((h2 >> 16) & 255) * t;
    const g = ((h1 >> 8) & 255) * (1 - t) + ((h2 >> 8) & 255) * t;
    const b = (h1 & 255) * (1 - t) + (h2 & 255) * t;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  };

  for (const e of graph.edges) {
    const a = graph.nodes[e.a], b = graph.nodes[e.b];
    const m = sectorMix(graph, noise, (a.x + b.x) / 2, (a.z + b.z) / 2);
    c.strokeStyle = mix(BIOMES[m.biome].ground, BIOMES[m.other].ground, m.t);
    c.lineWidth = Math.max(1.5, e.width * 2 * s);
    c.beginPath();
    c.moveTo(o + a.x * s, o + a.z * s);
    c.lineTo(o + b.x * s, o + b.z * s);
    c.stroke();
  }
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

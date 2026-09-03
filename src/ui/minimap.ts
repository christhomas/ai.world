import { BIOMES } from '../world/biomes';
import { sectorMix, type RoadGraph } from '../world/graph';
import { Simplex2D } from '../world/noise';
import { WORLD } from '../core/config';
import { SALT, derive } from '../core/salts';
import { parseChunkKey } from '../world/spatial';

/**
 * Minimap: the road graph is rendered once to an offscreen canvas (land blobs + roads),
 * then each frame only the camera rectangle is drawn on top.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private readonly bs = 1.6;          // base pixels per tile
  private readonly pad: number;       // world offset so the disc fits
  private readonly size: number;      // on-screen canvas size
  mode: 'local' | 'world' = 'local';
  /** Tiles visible across the corner map in local mode. */
  localTiles = 110;

  constructor(private readonly canvas: HTMLCanvasElement, graph: RoadGraph) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.size = canvas.width;
    this.pad = graph.radius + 8;
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil(this.pad * 2 * this.bs);
    this.base.height = this.base.width;
    this.renderBase(graph);
    this.fog = document.createElement('canvas');
    this.fog.width = this.base.width;
    this.fog.height = this.base.height;
    const f = this.fog.getContext('2d')!;
    f.fillStyle = 'rgba(6, 10, 26, 0.88)';
    f.fillRect(0, 0, this.fog.width, this.fog.height);
  }

  /** Punch explored chunk cells out of the fog layer. */
  reveal(chunkKeys: Iterable<string>): void {
    const f = this.fog.getContext('2d')!;
    const CS = WORLD.CHUNK_SIZE, s = this.bs, o = this.pad * this.bs;
    for (const k of chunkKeys) {
      const [cx, cz] = parseChunkKey(k);
      f.clearRect(o + cx * CS * s, o + cz * CS * s, CS * s, CS * s);
    }
  }

  toggle(): void { this.mode = this.mode === 'local' ? 'world' : 'local'; }

  private renderBase(graph: RoadGraph): void {
    const c = this.base.getContext('2d')!;
    const s = this.bs, o = this.pad * this.bs;
    c.fillStyle = '#1b4466';
    c.fillRect(0, 0, this.base.width, this.base.height);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const noise = new Simplex2D(derive(graph.seed, SALT.BIOME));
    const mixCss = (h1: number, h2: number, t: number) => {
      const r = ((h1 >> 16) & 255) * (1 - t) + ((h2 >> 16) & 255) * t;
      const g = ((h1 >> 8) & 255) * (1 - t) + ((h2 >> 8) & 255) * t;
      const b = (h1 & 255) * (1 - t) + (h2 & 255) * t;
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    };

    // land blobs: each edge as a thick stroke in its (blended) biome colour
    for (const e of graph.edges) {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      const m = sectorMix(graph, noise, (a.x + b.x) / 2, (a.z + b.z) / 2);
      c.strokeStyle = mixCss(BIOMES[m.biome].ground, BIOMES[m.other].ground, m.t);
      c.lineWidth = Math.max(1.5, e.width * 2 * s);
      c.beginPath();
      c.moveTo(o + a.x * s, o + a.z * s);
      c.lineTo(o + b.x * s, o + b.z * s);
      c.stroke();
    }
    // roads
    c.strokeStyle = 'rgba(90, 65, 40, 0.75)';
    for (const e of graph.edges) {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      c.lineWidth = Math.max(0.8, e.roadWidth * 2 * s);
      c.beginPath();
      c.moveTo(o + a.x * s, o + a.z * s);
      c.lineTo(o + b.x * s, o + b.z * s);
      c.stroke();
    }
  }

  draw(
    camX: number, camZ: number, zoom: number, aspect: number, rotation: number,
    markers: Array<{ x: number; z: number; color: string }> = [],
    playerX = camX, playerZ = camZ,
    fog = true,
  ): void {
    const ctx = this.ctx, bs = this.bs, N = this.size, B = this.base.width;
    let srcW: number, sx: number, sy: number;
    if (this.mode === 'local') {
      srcW = this.localTiles * bs;
      sx = (playerX + this.pad) * bs - srcW / 2;
      sy = (playerZ + this.pad) * bs - srcW / 2;
      sx = Math.max(0, Math.min(B - srcW, sx));
      sy = Math.max(0, Math.min(B - srcW, sy));
    } else {
      srcW = B; sx = 0; sy = 0;
    }
    const k = N / srcW;
    const toX = (x: number) => ((x + this.pad) * bs - sx) * k;
    const toZ = (z: number) => ((z + this.pad) * bs - sy) * k;
    ctx.drawImage(this.base, sx, sy, srcW, srcW, 0, 0, N, N);
    if (fog) ctx.drawImage(this.fog, sx, sy, srcW, srcW, 0, 0, N, N);
    for (const m of markers) {
      ctx.fillStyle = m.color;
      const r = this.mode === 'local' ? 3 : 2;
      ctx.fillRect(toX(m.x) - r, toZ(m.z) - r, r * 2, r * 2);
    }
    // player dot
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(toX(playerX), toZ(playerZ), this.mode === 'local' ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
    // camera rectangle
    ctx.save();
    ctx.translate(toX(camX), toZ(camZ));
    ctx.rotate(rotation + Math.PI / 4);
    const w = zoom * aspect * bs * k, d = zoom * bs * k * 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
  }
}

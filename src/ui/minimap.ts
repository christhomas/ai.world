import { BASE_SCALE, headingOnMap, type Fog, type MapBase, type MapMarker } from './mapbase';

/** The corner map: a small window on the world around the hero, cropped from the shared base. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  /** Tiles visible across the corner map. */
  localTiles = 110;
  /** How far the facing cone reaches, in pixels, and how wide it opens, in radians either side. */
  private static readonly CONE_REACH = 13;
  private static readonly CONE_HALF = 0.42;

  constructor(canvas: HTMLCanvasElement, private readonly base: MapBase, private readonly fog: Fog) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.size = canvas.width;
  }

  draw(
    camX: number, camZ: number, zoom: number, aspect: number, rotation: number,
    markers: MapMarker[] = [], playerX = camX, playerZ = camZ, fog = true,
    /** Which way the hero is looking, as a rig yaw. Undefined draws no cone. */
    facing?: number,
  ): void {
    const ctx = this.ctx, bs = BASE_SCALE, N = this.size, B = this.base.canvas.width;
    const srcW = Math.min(B, this.localTiles * bs);
    let sx = (playerX + this.base.pad) * bs - srcW / 2;
    let sy = (playerZ + this.base.pad) * bs - srcW / 2;
    sx = Math.max(0, Math.min(B - srcW, sx));
    sy = Math.max(0, Math.min(B - srcW, sy));
    const k = N / srcW;
    const toX = (x: number) => ((x + this.base.pad) * bs - sx) * k;
    const toZ = (z: number) => ((z + this.base.pad) * bs - sy) * k;

    ctx.drawImage(this.base.canvas, sx, sy, srcW, srcW, 0, 0, N, N);
    if (fog) ctx.drawImage(this.fog.canvas, sx, sy, srcW, srcW, 0, 0, N, N);
    for (const m of markers) {
      ctx.fillStyle = m.color;
      ctx.fillRect(toX(m.x) - 3, toZ(m.z) - 3, 6, 6);
    }
    // which way they are looking, drawn under the dot so the dot stays the thing you find first
    if (facing !== undefined) {
      ctx.save();
      ctx.translate(toX(playerX), toZ(playerZ));
      ctx.rotate(headingOnMap(facing));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, Minimap.CONE_REACH, -Minimap.CONE_HALF, Minimap.CONE_HALF);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,77,77,0.38)';
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(toX(playerX), toZ(playerZ), 3, 0, Math.PI * 2);
    ctx.fill();

    // the slice of world on screen right now
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

import { DTile, type DungeonMap } from '../dungeon/generate';
import { BASE_LEVEL, levelAt } from '../dungeon/map';

/**
 * How much paler a floor is drawn for each terrace it stands above the rest of it.
 *
 * A hole in the ground is all one level and this never comes into it. A castle is not, and the
 * thing the map has to answer there is "why can I see that walkway and not get onto it" — so the
 * gallery round a great hall is drawn brighter than the hall itself, the same way a contour line
 * is not a wall but tells you there is a climb. Small on purpose: at a quarter it stopped reading
 * as the same floor plan and started reading as two overlaid maps.
 */
const PER_TERRACE = 0.12;

/** Top-down dungeon map: rock stays dark, visited floor lights up, chests and stairs are marked. */
export class DungeonMinimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly seen: Uint8Array;
  private player: [number, number] = [0, 0];
  private opened = new Set<string>();
  private chestIdFn: (i: number) => string = () => '';
  private unlocked = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: DungeonMap) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.seen = new Uint8Array(map.size * map.size);
  }

  /** Reveal the room or corridor around a position. */
  reveal(x: number, z: number, radius = 4): void {
    const { size } = this.map;
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (dx * dx + dz * dz > radius * radius) continue;
        this.seen[nz * size + nx] = 1;
      }
    }
  }

  draw(playerX: number, playerZ: number, opened: Set<string>, chestId: (i: number) => string, unlocked: boolean): void {
    this.player = [playerX, playerZ];
    this.opened = opened;
    this.chestIdFn = chestId;
    this.unlocked = unlocked;
    this.paint(this.ctx, this.canvas.width, this.canvas.height);
  }

  /** Same picture at any size: used by the full-screen map. */
  drawInto(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.paint(ctx, width, height);
  }

  private paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const scale = Math.min(width, height) / this.map.size;
    const offX = (width - scale * this.map.size) / 2;
    const offY = (height - scale * this.map.size) / 2;
    const [playerX, playerZ] = this.player;
    const { opened, unlocked } = this;
    const chestId = this.chestIdFn;
    const { size, tiles } = this.map;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offX, offY);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x;
        if (!this.seen[i]) continue;
        const t = tiles[i] as DTile;
        if (t === DTile.Rock) continue;
        ctx.fillStyle = t === DTile.Water ? '#2f6f9f'
          : t === DTile.Door ? (unlocked ? '#8a6a3d' : '#c0392b')
            : lit(FLOOR, levelAt(this.map, x, z) - BASE_LEVEL);
        ctx.fillRect(x * scale, z * scale, scale, scale);
      }
    }
    // stairs
    const [ex, ez] = this.map.entrance;
    if (this.seen[ez * size + ex]) {
      ctx.fillStyle = '#8fa0ff';
      ctx.fillRect(ex * scale - 1, ez * scale - 1, scale + 2, scale + 2);
    }
    this.map.chests.forEach((c, i) => {
      if (!this.seen[c.z * size + c.x]) return;
      ctx.fillStyle = opened.has(chestId(i)) ? '#7f7f5a' : c.key ? '#e8e8e8' : '#f1c40f';
      ctx.fillRect(c.x * scale - 1, c.z * scale - 1, scale + 2, scale + 2);
    });
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(playerX * scale, playerZ * scale, Math.max(2.5, scale * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** The colour of ordinary floor, as the three channels the shading works on. */
const FLOOR: readonly [number, number, number] = [0x6a, 0x5a, 0x48];

/** The same colour lifted one notch per terrace, clamped so a tall gallery does not go white. */
function lit(base: readonly [number, number, number], terraces: number): string {
  const t = Math.min(1, Math.max(0, terraces) * PER_TERRACE);
  const up = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${up(base[0])},${up(base[1])},${up(base[2])})`;
}

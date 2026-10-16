import type { DungeonMap } from '../dungeon/generate';
import { FLOOR_ENTRANCE, FLOOR_HERO, FloorSight } from '../dungeon/floor-picture';

/** A colour the floor's rules gave as a number, as a canvas takes it. */
const css = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** Top-down dungeon map: rock stays dark, visited floor lights up, chests and stairs are marked. */
export class DungeonMinimap {
  private readonly ctx: CanvasRenderingContext2D;
  /** What has been seen, and what colour each of it is: `dungeon/floor-picture.ts`, which an app's map reads too. */
  private readonly sight: FloorSight;
  private player: [number, number] = [0, 0];
  private opened = new Set<string>();
  private chestIdFn: (i: number) => string = () => '';
  private unlocked = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: DungeonMap) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.sight = new FloorSight(map);
  }

  /** Reveal the room or corridor around a position. */
  reveal(x: number, z: number, radius = 4): void { this.sight.reveal(x, z, radius); }

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
    const { size } = this.map;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offX, offY);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const colour = this.sight.cell(x, z, unlocked);
        if (colour === null) continue;
        ctx.fillStyle = css(colour);
        ctx.fillRect(x * scale, z * scale, scale, scale);
      }
    }
    // stairs
    const [ex, ez] = this.map.entrance;
    if (this.sight.seen[ez * size + ex]) {
      ctx.fillStyle = css(FLOOR_ENTRANCE);
      ctx.fillRect(ex * scale - 1, ez * scale - 1, scale + 2, scale + 2);
    }
    this.map.chests.forEach((c, i) => {
      const colour = this.sight.chest(i, opened.has(chestId(i)));
      if (colour === null) return;
      ctx.fillStyle = css(colour);
      ctx.fillRect(c.x * scale - 1, c.z * scale - 1, scale + 2, scale + 2);
    });
    ctx.fillStyle = css(FLOOR_HERO);
    ctx.beginPath();
    ctx.arc(playerX * scale, playerZ * scale, Math.max(2.5, scale * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

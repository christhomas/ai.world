import { DTile, type DungeonMap } from '../dungeon/generate';

/** Top-down dungeon map: rock stays dark, visited floor lights up, chests and stairs are marked. */
export class DungeonMinimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly seen: Uint8Array;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: DungeonMap) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.scale = canvas.width / map.size;
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
    const { ctx, scale } = this;
    const { size, tiles } = this.map;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x;
        if (!this.seen[i]) continue;
        const t = tiles[i] as DTile;
        if (t === DTile.Rock) continue;
        ctx.fillStyle = t === DTile.Water ? '#2f6f9f' : t === DTile.Door ? (unlocked ? '#8a6a3d' : '#c0392b') : '#6a5a48';
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
    ctx.arc(playerX * scale, playerZ * scale, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

import { $ } from './dom';
import { BASE_SCALE, type Fog, type MapBase, type MapMarker } from './mapbase';
import type { DungeonMinimap } from './dungeonmap';

const ZOOM = { MIN: 0.35, MAX: 5, STEP: 1.25, START: 1.6 } as const;
const PAN_KEY_SPEED = 700; // screen pixels per second

export interface WorldMapInput {
  markers: MapMarker[];
  playerX: number;
  playerZ: number;
  /** false once the region map is in your pocket. */
  fog: boolean;
  /** Shown in the header. */
  title: string;
}

/**
 * The map, full screen: the same base image as the corner minimap, pannable and zoomable, with
 * names beside everything you have found. While underground it shows the dungeon instead.
 */
export class WorldMap {
  private readonly el = $('worldmap');
  private readonly canvas = $<HTMLCanvasElement>('worldmapCanvas');
  private readonly header = $('worldmapTitle');
  private readonly ctx: CanvasRenderingContext2D;
  private open = false;
  /** Centre of the view in world tiles. */
  private cx = 0;
  private cz = 0;
  private zoom: number = ZOOM.START;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Set while a dungeon is open, so M shows the dungeon full screen. */
  dungeon: DungeonMinimap | null = null;

  constructor(private readonly base: MapBase, private readonly fog: Fog) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('world map 2d context');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => { if (this.open) { this.resize(); } });

    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });
    const stop = () => { this.dragging = false; this.canvas.style.cursor = 'grab'; };
    this.canvas.addEventListener('mouseup', stop);
    this.canvas.addEventListener('mouseleave', stop);
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.cx -= (e.clientX - this.lastX) / this.pixelsPerTile;
      this.cz -= (e.clientY - this.lastY) / this.pixelsPerTile;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // zoom toward the cursor so the tile under it stays put
      const rect = this.canvas.getBoundingClientRect();
      const before = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.zoomBy(e.deltaY < 0 ? ZOOM.STEP : 1 / ZOOM.STEP);
      const after = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
    }, { passive: false });
  }

  get isOpen(): boolean { return this.open; }

  private get pixelsPerTile(): number { return BASE_SCALE * this.zoom; }

  private toWorld(px: number, py: number): { x: number; z: number } {
    return {
      x: this.cx + (px - this.canvas.width / 2) / this.pixelsPerTile,
      z: this.cz + (py - this.canvas.height / 2) / this.pixelsPerTile,
    };
  }

  private toScreen(x: number, z: number): { px: number; py: number } {
    return {
      px: this.canvas.width / 2 + (x - this.cx) * this.pixelsPerTile,
      py: this.canvas.height / 2 + (z - this.cz) * this.pixelsPerTile,
    };
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor((window.innerHeight - 96) * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight - 96}px`;
  }

  zoomBy(factor: number): void {
    this.zoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, this.zoom * factor));
  }

  /** Put the hero back in the middle. */
  centre(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
  }

  toggle(input: WorldMapInput): void {
    this.open = !this.open;
    this.el.classList.toggle('show', this.open);
    if (this.open) {
      this.resize();
      this.centre(input.playerX, input.playerZ);
      this.canvas.style.cursor = 'grab';
    }
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('show');
  }

  /** Arrow/WASD panning while the map is open. */
  pan(dx: number, dz: number, dt: number): void {
    if (dx === 0 && dz === 0) return;
    const step = (PAN_KEY_SPEED * dt) / this.pixelsPerTile;
    this.cx += dx * step;
    this.cz += dz * step;
  }

  draw(input: WorldMapInput): void {
    if (!this.open) return;
    this.header.textContent = input.title;
    if (this.dungeon) { this.dungeon.drawInto(this.ctx, this.canvas.width, this.canvas.height); return; }

    const { ctx, canvas } = this;
    const ppt = this.pixelsPerTile;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // the base image, positioned so world (cx,cz) lands in the middle of the canvas
    const originX = canvas.width / 2 - (this.cx + this.base.pad) * ppt;
    const originY = canvas.height / 2 - (this.cz + this.base.pad) * ppt;
    const w = this.base.canvas.width * this.zoom;
    ctx.drawImage(this.base.canvas, originX, originY, w, w);
    if (input.fog) ctx.drawImage(this.fog.canvas, originX, originY, w, w);

    // markers, with names for anything worth naming
    ctx.font = `${Math.max(11, Math.round(12 * Math.min(2, this.zoom)))}px "Courier New", monospace`;
    ctx.textBaseline = 'middle';
    for (const m of input.markers) {
      const { px, py } = this.toScreen(m.x, m.z);
      if (px < -80 || py < -40 || px > canvas.width + 80 || py > canvas.height + 40) continue;
      const r = m.emphasis ? 6 : 4;
      if (m.emphasis) {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      if (m.label && this.zoom > 0.6) {
        ctx.fillStyle = 'rgba(8, 12, 24, 0.75)';
        const width = ctx.measureText(m.label).width;
        ctx.fillRect(px + r + 3, py - 9, width + 8, 18);
        ctx.fillStyle = '#f2e9d2';
        ctx.fillText(m.label, px + r + 7, py + 1);
      }
    }

    // the hero, as an arrow-less dot with a ring so it is never lost in the clutter
    const me = this.toScreen(input.playerX, input.playerZ);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(me.px, me.py, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(me.px, me.py, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

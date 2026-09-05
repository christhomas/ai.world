import { $ } from './dom';
import { BASE_SCALE, type Fog, type MapBase, type MapMarker, headingOnMap } from './mapbase';
import type { DungeonMinimap } from './dungeonmap';

const ZOOM = { MIN: 0.35, MAX: 5, STEP: 1.25, START: 1.6 } as const;
const PAN_KEY_SPEED = 700; // screen pixels per second
/** The bar and the legend, before the page has laid them out and they can be measured. */
const MAP_CHROME_GUESS = 96;

export interface WorldMapInput {
  markers: MapMarker[];
  playerX: number;
  playerZ: number;
  /** Which way the hero is looking, as a rig yaw. Undefined draws no cone. */
  facing?: number;
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
  /** Distance between two pinching fingers last frame, in CSS pixels; 0 when nobody is pinching. */
  private pinchGap = 0;
  /** Backing-store pixels per CSS pixel, so a drag keeps up with the finger on a sharp screen. */
  private dpr = 1;
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
      this.cx -= (e.clientX - this.lastX) / this.cssPixelsPerTile;
      this.cz -= (e.clientY - this.lastY) / this.cssPixelsPerTile;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // zoom toward the cursor so the tile under it stays put
      this.zoomAbout(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM.STEP : 1 / ZOOM.STEP);
    }, { passive: false });

    // A map is the one screen everybody already knows how to work with their hands: one finger
    // drags it, two pinch it, and the tile between the fingers stays where it is.
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else {
        this.dragging = false;
        this.pinchGap = gapBetween(e.touches);
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        const gap = gapBetween(e.touches);
        if (this.pinchGap > 0 && gap > 0) {
          const mid = midpoint(e.touches);
          this.zoomAbout(mid.x, mid.y, gap / this.pinchGap);
        }
        this.pinchGap = gap;
        return;
      }
      if (!this.dragging) return;
      const t = e.touches[0];
      this.cx -= (t.clientX - this.lastX) / this.cssPixelsPerTile;
      this.cz -= (t.clientY - this.lastY) / this.cssPixelsPerTile;
      this.lastX = t.clientX;
      this.lastY = t.clientY;
    }, { passive: false });
    const lift = (e: TouchEvent) => {
      if (e.touches.length === 0) { this.dragging = false; this.pinchGap = 0; }
    };
    this.canvas.addEventListener('touchend', lift);
    this.canvas.addEventListener('touchcancel', lift);
  }

  /** Zoom by `factor` while keeping whatever is under (clientX, clientY) under it. */
  private zoomAbout(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.dpr, py = (clientY - rect.top) * this.dpr;
    const before = this.toWorld(px, py);
    this.zoomBy(factor);
    const after = this.toWorld(px, py);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
  }

  get isOpen(): boolean { return this.open; }

  private get pixelsPerTile(): number { return BASE_SCALE * this.zoom; }

  /** The same, in the pixels a finger and the mouse move in. */
  private get cssPixelsPerTile(): number { return this.pixelsPerTile / this.dpr; }

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

  /**
   * Match the backing store to whatever space the flex column left the canvas. It is measured
   * rather than calculated because the bar and the legend are not a fixed height: on a narrow
   * screen the legend wraps, and a guess would stretch the map.
   */
  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight - MAP_CHROME_GUESS;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
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
    const step = (PAN_KEY_SPEED * dt) / this.cssPixelsPerTile;
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

    // the hero: a dot with a ring so it is never lost in the clutter, and a cone off it so the
    // map answers "which way am I pointing" as well as "where am I"
    const me = this.toScreen(input.playerX, input.playerZ);
    if (input.facing !== undefined) {
      ctx.save();
      ctx.translate(me.px, me.py);
      ctx.rotate(headingOnMap(input.facing));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 26, -0.42, 0.42);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,77,77,0.32)';
      ctx.fill();
      ctx.restore();
    }
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

/** How far apart the first two fingers are, in CSS pixels. */
function gapBetween(touches: TouchList): number {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

/** The point a pinch is happening around. */
function midpoint(touches: TouchList): { x: number; y: number } {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

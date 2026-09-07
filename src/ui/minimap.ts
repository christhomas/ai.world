import { BASE_SCALE, headingOnMap, type Fog, type MapBase, type MapMarker } from './mapbase';

/**
 * The map the corner map was drawn for, in pixels.
 *
 * Everything here used to be a count of pixels on a 180-wide canvas: a marker six across, the
 * hero's dot three in radius. That was fine while the canvas was always 180 wide, and stopped
 * being fine the moment the interface learned to grow — on a 4K screen the same six pixels are a
 * speck. The marks are now shares of the map's width taken from that original, so they look the
 * same on the screen whatever number of pixels the map is drawn with.
 */
const REFERENCE = 180;

/** The marks on the map, as a share of its width. */
const MARK = {
  /** A village, a landmark, an errand: a square, this far across. */
  MARKER: 6 / REFERENCE,
  /** The hero, as a dot of this radius. */
  PLAYER: 3 / REFERENCE,
  /** How far the facing cone reaches out from the dot. */
  CONE_REACH: 13 / REFERENCE,
  /** The line round the slice of world on screen. */
  VIEW_LINE: 1 / REFERENCE,
} as const;

/** How wide the facing cone opens, in radians either side of straight ahead. */
const CONE_HALF = 0.42;

/**
 * How many pixels the canvas is given, for a box this many CSS pixels across.
 *
 * The floor is the size the map has always been drawn at, so a small window is untouched. The
 * ceiling is where more pixels stop buying anything: the base image the map is cropped from holds
 * 1.6 pixels to the tile, and the corner map shows 110 tiles, so there are only ever about 176
 * pixels of real map to enlarge. Past that the extra resolution is spent on the marks and the
 * lines drawn over it, which are the parts that were actually blurred.
 */
const backingFor = (cssWidth: number, dpr: number): number =>
  Math.max(REFERENCE, Math.min(768, Math.round(cssWidth * Math.min(dpr, 2))));

/** The corner map: a small window on the world around the hero, cropped from the shared base. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private size: number;
  /** Tiles visible across the corner map. */
  localTiles = 110;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly base: MapBase, private readonly fog: Fog) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context');
    this.ctx = ctx;
    this.size = canvas.width;
    this.fit();
    // The stylesheet decides how big the map is — a column on a wide window, a corner on a phone —
    // so the canvas has to be told, and told again when the window changes. Watching the box is
    // the only way to hear about a change that came from a media query rather than from a resize.
    // Idempotent: it sets a size it has already computed, so a second map on the same canvas (the
    // dungeon's, which reads the canvas afresh every time it paints) costs nothing.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(canvas);
  }

  /** Give the canvas as many pixels as it is being shown with, and no more. */
  private fit(): void {
    const css = this.canvas.clientWidth || this.canvas.width;
    const want = backingFor(css, window.devicePixelRatio || 1);
    if (want === this.size) return;
    this.size = want;
    // width and height together, and both of them: setting either one clears the canvas, which is
    // harmless here because the next frame redraws the lot.
    this.canvas.width = want;
    this.canvas.height = want;
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

    // Blown up, the base image is worth more as tiles than as a blur: it holds less than two pixels
    // to the tile, so smoothing an enlargement of it only makes a soft photograph of a blocky
    // world. Shrunk — a phone's corner, where the map is smaller than its source — it needs the
    // smoothing, or the roads come apart into dashes.
    ctx.imageSmoothingEnabled = N < srcW;
    ctx.drawImage(this.base.canvas, sx, sy, srcW, srcW, 0, 0, N, N);
    if (fog) ctx.drawImage(this.fog.canvas, sx, sy, srcW, srcW, 0, 0, N, N);
    // the marks go on at full resolution whatever the map under them cost
    ctx.imageSmoothingEnabled = true;
    const mark = MARK.MARKER * N;
    for (const m of markers) {
      ctx.fillStyle = m.color;
      ctx.fillRect(toX(m.x) - mark / 2, toZ(m.z) - mark / 2, mark, mark);
    }
    // which way they are looking, drawn under the dot so the dot stays the thing you find first
    if (facing !== undefined) {
      ctx.save();
      ctx.translate(toX(playerX), toZ(playerZ));
      ctx.rotate(headingOnMap(facing));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, MARK.CONE_REACH * N, -CONE_HALF, CONE_HALF);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,77,77,0.38)';
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(toX(playerX), toZ(playerZ), MARK.PLAYER * N, 0, Math.PI * 2);
    ctx.fill();

    // the slice of world on screen right now
    ctx.save();
    ctx.translate(toX(camX), toZ(camZ));
    ctx.rotate(rotation + Math.PI / 4);
    const w = zoom * aspect * bs * k, d = zoom * bs * k * 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = MARK.VIEW_LINE * N;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
  }
}

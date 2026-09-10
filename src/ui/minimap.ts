import { BASE_SCALE, castleMark, headingOnMap, type Fog, type MapBase, type MapMarker } from './mapbase';

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
  /**
   * And a castle, which is a battlemented block rather than a square, at nearly twice the width.
   *
   * Twice, because a castle is the one mark on this map that is *bigger than the map's own
   * resolution*: thirteen tiles of ward with an apron round it is about twenty pixels of base
   * image, which is three times what the square would have covered. Drawn the same size as a
   * cottage, the mark would have been smaller than the thing it stands for.
   */
  CASTLE: 11 / REFERENCE,
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
 * How far to turn the map so that the way the camera is looking is the top of it.
 *
 * Taken from the picture's own corners rather than from the camera's rotation, so there is one
 * source of truth for which way is forward and no second number to keep in step: the top edge of
 * the screen is the far edge of the quad, and the way from the near edge to the far one is up.
 * Zero when there is no picture to take it from, which is the dungeon's map and any test that
 * draws without one.
 */
export function upFrom(view: ReadonlyArray<{ x: number; z: number }>): number {
  if (view.length < 4) return 0;
  const [bl, br, tr, tl] = view;
  const ux = (tl.x + tr.x - bl.x - br.x) / 2, uz = (tl.z + tr.z - bl.z - br.z) / 2;
  if (ux === 0 && uz === 0) return 0;
  // map space has x to the right and z down the screen, so straight up is -π/2
  const spin = -Math.PI / 2 - Math.atan2(uz, ux);
  // wrapped to a half turn either way: canvas does not care, but a number a reader can hold does
  return spin <= -Math.PI ? spin + 2 * Math.PI : spin > Math.PI ? spin - 2 * Math.PI : spin;
}

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

  /**
   * @param view the four corners of what is on screen, where they meet the ground, clockwise from
   * the bottom-left. Empty draws no outline — the dungeon's own map has no such thing to show.
   */
  draw(
    playerX: number, playerZ: number, view: ReadonlyArray<{ x: number; z: number }> = [],
    markers: MapMarker[] = [], fog = true,
    /** Which way the hero is looking, as a rig yaw. Undefined draws no cone. */
    facing?: number,
  ): void {
    const ctx = this.ctx, bs = BASE_SCALE, N = this.size, B = this.base.canvas.width;
    const srcW = Math.min(B, this.localTiles * bs);
    const k = N / srcW;

    /*
     * The hero is the middle of the map, and the map turns under him.
     *
     * It used to be north-up with the hero somewhere on it, and it clamped the crop to the edges
     * of the base image, so within eighty tiles of the rim of the world the hero slid off the
     * middle and the map stopped answering "what is around me" — which is the only question a
     * corner map is asked. Worse, the game's own camera can be turned, and a map that does not
     * turn with it puts a village on your left that is in fact behind you.
     *
     * So: the crop is always centred on the hero, and everything is drawn through one rotation
     * about the middle of the canvas that puts the direction the camera is looking at the top of
     * the map. Near the rim the map runs out rather than sliding — the world genuinely ends there,
     * and a blank corner says so honestly.
     */
    const spin = upFrom(view);
    // a square wide enough that turning it leaves no empty corner: the diagonal of what is shown
    const wide = srcW * Math.SQRT2;
    const sx = (playerX + this.base.pad) * bs - wide / 2;
    const sy = (playerZ + this.base.pad) * bs - wide / 2;
    const dest = wide * k;
    // where a place in the world lands on the turned map, as two numbers rather than a canvas
    // transform, so that what is drawn at that point can stay the right way up
    const cos = Math.cos(spin), sin = Math.sin(spin);
    const px = (x: number, z: number) => N / 2 + ((x - playerX) * cos - (z - playerZ) * sin) * bs * k;
    const pz = (x: number, z: number) => N / 2 + ((x - playerX) * sin + (z - playerZ) * cos) * bs * k;

    ctx.clearRect(0, 0, N, N);
    ctx.save();
    ctx.translate(N / 2, N / 2);
    ctx.rotate(spin);
    ctx.translate(-N / 2, -N / 2);

    // Blown up, the base image is worth more as tiles than as a blur: it holds less than two pixels
    // to the tile, so smoothing an enlargement of it only makes a soft photograph of a blocky
    // world. Shrunk — a phone's corner, where the map is smaller than its source — it needs the
    // smoothing, or the roads come apart into dashes.
    ctx.imageSmoothingEnabled = N < srcW;
    const at = N / 2 - dest / 2;
    ctx.drawImage(this.base.canvas, sx, sy, wide, wide, at, at, dest, dest);
    if (fog) ctx.drawImage(this.fog.canvas, sx, sy, wide, wide, at, at, dest, dest);
    ctx.restore();

    // the marks go on at full resolution whatever the map under them cost, and outside the turn,
    // so a village stays a square rather than becoming a diamond when you swing the camera
    ctx.imageSmoothingEnabled = true;
    const mark = MARK.MARKER * N;
    for (const m of markers) {
      if (m.icon === 'castle') {
        castleMark(ctx, px(m.x, m.z), pz(m.x, m.z), MARK.CASTLE * N, m.color);
        continue;
      }
      ctx.fillStyle = m.color;
      ctx.fillRect(px(m.x, m.z) - mark / 2, pz(m.x, m.z) - mark / 2, mark, mark);
    }
    // which way they are looking, drawn under the dot so the dot stays the thing you find first
    if (facing !== undefined) {
      ctx.save();
      ctx.translate(N / 2, N / 2);
      ctx.rotate(headingOnMap(facing) + spin);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, MARK.CONE_REACH * N, -CONE_HALF, CONE_HALF);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,77,77,0.38)';
      ctx.fill();
      ctx.restore();
    }

    // the slice of world on screen right now, as the camera actually cuts it rather than as a
    // square drawn round the hero — which is the same thing only while the camera is looking
    // straight down at his feet, and is not while it is aimed up at a mountain
    if (view.length > 2) {
      ctx.beginPath();
      ctx.moveTo(px(view[0].x, view[0].z), pz(view[0].x, view[0].z));
      for (let i = 1; i < view.length; i++) ctx.lineTo(px(view[i].x, view[i].z), pz(view[i].x, view[i].z));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = MARK.VIEW_LINE * N;
      ctx.stroke();
    }

    // and the hero last, on the middle of the canvas, outside the turn: he is the one thing on
    // this map that never moves, and a circle would not show it if he did
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(N / 2, N / 2, MARK.PLAYER * N, 0, Math.PI * 2);
    ctx.fill();
  }
}

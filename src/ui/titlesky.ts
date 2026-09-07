/**
 * The country behind the title, drawn rather than photographed.
 *
 * The screen you meet first should be made of the same stuff as the game behind it. This is the
 * game's own idea of land — terraces, cut flat and stacked, no textures anywhere — as four ridges
 * receding into haze, with the sky the day cycle uses at dusk above them.
 *
 * It is drawn rather than rendered because a title screen must be up instantly: growing a real
 * world takes a second or two of solid work, and a second of nothing is exactly the feeling the
 * old screen gave. This costs about a millisecond a frame and starts on the first one.
 */

/** The sky, from the top of the screen down to the horizon. */
const SKY: Array<[number, string]> = [
  [0, '#0a1030'],
  [0.45, '#1b2b5c'],
  [0.72, '#3f4a7e'],
  [0.88, '#8a5a72'],
  [1, '#d98a5c'],
];

/**
 * The four ridges, far to near.
 *
 * Distance is drawn as paleness and as height, the way it looks from a hillside: far country is
 * washed out by the air between and stands high in the frame, near country is dark and low. The
 * steps get bigger as they come towards you, because that is what perspective does to a terrace.
 */
const RIDGES = [
  { fill: '#4a5688', sit: 0.52, rise: 0.13, steps: 5, size: 260, drift: 1.6 },
  { fill: '#38446f', sit: 0.62, rise: 0.15, steps: 6, size: 190, drift: 3.2 },
  { fill: '#26305a', sit: 0.74, rise: 0.17, steps: 7, size: 140, drift: 6.0 },
  { fill: '#151c3c', sit: 0.88, rise: 0.18, steps: 8, size: 95, drift: 11.0 },
] as const;

/** How wide a terrace is on screen, in pixels, before the ridge's own scale is applied. */
const TREAD = 26;

/** Stars, and how far down the sky they are allowed to fall. */
const STARS = 90;
const STAR_FLOOR = 0.55;

/** Smooth value noise on a line: enough to make a skyline, and cheap enough to do every frame. */
function wave(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const at = (n: number) => {
    const h = Math.sin((n * 127.1 + seed * 311.7) * 0.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = f * f * (3 - 2 * f);
  return at(i) * (1 - smooth) + at(i + 1) * smooth;
}

/** One ridge: a stepped skyline, flat-topped, filled down to the bottom of the frame. */
function ridge(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  r: (typeof RIDGES)[number], shift: number, index: number,
): void {
  const tread = TREAD * (r.size / 190);
  ctx.fillStyle = r.fill;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = -tread; x <= w + tread; x += tread) {
    const at = (x + shift) / r.size;
    // two waves of different lengths, so a ridge has both hills and the bumps on them
    const n = wave(at, index) * 0.68 + wave(at * 2.7, index + 7) * 0.32;
    // quantised, which is the whole point: this land is cut into terraces and so is its skyline
    const step = Math.round(n * r.steps) / r.steps;
    const y = Math.round(h * (r.sit - step * r.rise));
    ctx.lineTo(x, y);
    ctx.lineTo(x + tread, y);
  }
  ctx.lineTo(w + tread, h);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paint the backdrop, and keep painting it until the returned function is called.
 *
 * The drift is measured against wall-clock rather than counted in frames, so the ridges move at
 * the same speed on a Pi as on a desktop, and a tab that has been in the background does not come
 * back to a mountain range that has run off the side.
 */
export function paintTitleSky(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let running = true;
  let frame = 0;
  const began = performance.now();

  const draw = (now: number) => {
    if (!running) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) { frame = requestAnimationFrame(draw); return; }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    for (const [at, colour] of SKY) sky.addColorStop(at, colour);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // stars, fixed to the sky rather than drifting with the land, and only in the dark half of it
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let n = 0; n < STARS; n++) {
      const sx = wave(n * 1.7, 3) * w;
      const sy = wave(n * 2.3, 9) * h * STAR_FLOOR;
      const size = wave(n * 3.1, 5) > 0.8 ? 2 * dpr : dpr;
      ctx.globalAlpha = 0.25 + wave(n * 5.3, 11) * 0.55;
      ctx.fillRect(Math.round(sx), Math.round(sy), size, size);
    }
    ctx.globalAlpha = 1;

    const seconds = (now - began) / 1000;
    RIDGES.forEach((r, i) => ridge(ctx, w, h, r, seconds * r.drift * dpr, i));
    frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => { running = false; cancelAnimationFrame(frame); };
}

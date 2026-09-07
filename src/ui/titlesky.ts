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

/**
 * The sky, from the top of the screen down to the horizon.
 *
 * The horizon sits at about three-quarters, not at the bottom: the land has to be under it, and
 * everything above it is for reading words on. The warm end is kept narrow — a wide dusk is
 * pretty and turns the bottom third of the screen into something nothing can be written over.
 */
const SKY: Array<[number, string]> = [
  [0, '#070c26'],
  [0.42, '#0e1740'],
  [0.66, '#1d2a58'],
  [0.78, '#4a3f68'],
  [0.86, '#6d4a5e'],
  [1, '#8a5340'],
];

/**
 * The four ridges, far to near.
 *
 * Distance is drawn as paleness and as height, the way it looks from a hillside: far country is
 * washed out by the air between and stands high in the frame, near country is dark and low. The
 * steps get bigger as they come towards you, because that is what perspective does to a terrace.
 */
const RIDGES = [
  { fill: '#3b4675', sit: 0.790, rise: 0.080, steps: 5, size: 240, drift: 1.4 },
  { fill: '#2a3358', sit: 0.845, rise: 0.072, steps: 6, size: 175, drift: 2.8 },
  { fill: '#1b2340', sit: 0.900, rise: 0.066, steps: 7, size: 128, drift: 5.2 },
  { fill: '#0c1124', sit: 0.955, rise: 0.060, steps: 8, size: 88, drift: 9.5 },
] as const;

/**
 * How wide a terrace is on screen, before the ridge's own scale is applied.
 *
 * Small, because a wide tread makes a bar chart rather than a hillside: the eye reads a step as a
 * step only while there are enough of them across a hill to see it is a hill.
 */
const TREAD = 13;

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

    // and a wash over the whole thing, darkest where the words are. The land is scenery: it has to
    // be visibly there and it must never be the reason a line of type is hard to read.
    const scrim = ctx.createLinearGradient(0, 0, 0, h);
    scrim.addColorStop(0, 'rgba(6, 9, 22, 0.45)');
    scrim.addColorStop(0.62, 'rgba(6, 9, 22, 0.38)');
    scrim.addColorStop(0.8, 'rgba(6, 9, 22, 0.12)');
    scrim.addColorStop(1, 'rgba(6, 9, 22, 0.34)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, w, h);
    frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => { running = false; cancelAnimationFrame(frame); };
}

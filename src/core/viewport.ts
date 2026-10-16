/** Logical pixels in the host surface; never device pixels. */
export interface Viewport {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

export function hasArea(viewport: Viewport): boolean {
  return Number.isFinite(viewport.width) && viewport.width > 0
    && Number.isFinite(viewport.height) && viewport.height > 0;
}

/** Reject taps outside the world surface and surfaces that are still being laid out. */
export function pointerInViewport(x: number, y: number, viewport: Viewport): { x: number; y: number } | null {
  const left = viewport.left ?? 0, top = viewport.top ?? 0;
  if (!hasArea(viewport) || ![x, y, left, top].every(Number.isFinite)) return null;
  const px = x - left, py = y - top;
  if (px < 0 || py < 0 || px > viewport.width || py > viewport.height) return null;
  return { x: px / viewport.width * 2 - 1, y: 1 - py / viewport.height * 2 };
}

import type { Mooring } from '../jetties';

/**
 * Where the nearest open water is, as a bearing and a distance, or nothing within `reach`.
 *
 * Rings outward rather than scanning a square, so what comes back is the nearest wet tile rather
 * than whichever one happened to be looked at first, and it stops the moment it finds one. Water is
 * the same question a boat asks: ground with nothing to stand on.
 *
 * The bearing matters as much as distance. A jetty runs toward the sea, not where the player was
 * looking when they pressed Enter. `step` is one tile for a plot and four for the village-level
 * question, where scanning every tile across `BUILD.WITHIN` would cost thirty thousand samples.
 */
export function toTheWater(
  heightAt: (x: number, z: number) => number | null,
  x: number, z: number, reach: number, step = 1,
): { away: number; bearing: number } | null {
  for (let r = step; r <= reach; r += step) {
    const around = Math.max(8, Math.round(r * 8 / step));
    for (let a = 0; a < around; a++) {
      const angle = (a / around) * Math.PI * 2;
      const wx = x + Math.cos(angle) * r, wz = z + Math.sin(angle) * r;
      // the bearing is in the game's own convention, where yaw 0 is +x and turning is towards -z
      if (heightAt(wx, wz) === null) return { away: r, bearing: Math.atan2(-(wz - z), wx - x) };
    }
  }
  return null;
}

/** How far the nearest mooring is, or Infinity where this coast has none. */
export function toTheJetty(jetties: ReadonlyArray<Mooring>, x: number, z: number): number {
  let nearest = Infinity;
  for (const jetty of jetties) {
    nearest = Math.min(nearest, Math.hypot(jetty.dockX + 0.5 - x, jetty.dockZ + 0.5 - z));
  }
  return nearest;
}

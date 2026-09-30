import { mulberry32 } from '../core/rng';
import type { Manifest, Anchor } from '../world/manifest';
import type { WorldKind } from '../world/countries';

/** Two world months pass between asking and the answer. */
export const PRAYER_WAIT = 60;
export const PRAYER_REACH = 96;

/** A promise the shrine made, saved before the outcome is known. */
export interface HighlandPrayer {
  id: string;
  shrine: string;
  name: string;
  x: number;
  z: number;
  asked: number;
  due: number;
  /** The dice thrown when the prayer is made, never drawn again after a reload. */
  seed: number;
  answered: boolean;
}

export type PrayerDirection = 'north' | 'east' | 'south' | 'west';
const DIRECTIONS: Record<PrayerDirection, readonly [number, number]> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
};

/** One named site per side of a shrine, so a player can choose the affected country. */
export function prayerSite(shrine: { name: string; x: number; z: number }, direction: PrayerDirection) {
  const [dx, dz] = DIRECTIONS[direction];
  return {
    id: `highland:prayer:${shrine.name}:${direction}`,
    name: `${shrine.name} ${direction} heights`,
    x: Math.round(shrine.x + dx * PRAYER_REACH),
    z: Math.round(shrine.z + dz * PRAYER_REACH),
  };
}

/** Name every settled place inside the widest possible rise before asking for confirmation. */
export function affectedPlaces(
  site: { x: number; z: number }, villages: readonly { name: string; x: number; z: number }[],
): string[] {
  return villages.filter((v) => Math.hypot(v.x - site.x, v.z - site.z) <= PRAYER_REACH)
    .map((v) => v.name).sort();
}

export function mayPray(
  prayers: readonly HighlandPrayer[], manifest: Manifest, id: string, day: number,
): string | null {
  if (manifest.get(id) || prayers.some((p) => p.id === id)) return 'The stones have answered for this place already.';
  if (prayers.some((p) => !p.answered)) return 'The stones are still hearing your last prayer.';
  const latest = Math.max(0, ...prayers.map((p) => p.asked));
  if (prayers.length > 0 && day < latest + PRAYER_WAIT) {
    return `The stones will hear another prayer on day ${latest + PRAYER_WAIT}.`;
  }
  return null;
}

export function askForHighland(
  shrine: { name: string; x: number; z: number }, direction: PrayerDirection,
  day: number, seed: number,
): HighlandPrayer {
  const site = prayerSite(shrine, direction);
  return { ...site, shrine: shrine.name, asked: day, due: day + PRAYER_WAIT,
    seed: seed >>> 0, answered: false };
}

/** Answer once into the manifest. The anchor is the final recorded roll and its generator version. */
export function answerHighland(manifest: Manifest, prayer: HighlandPrayer, day: number): Anchor | null {
  if (day < prayer.due) return null;
  const known = manifest.get(prayer.id);
  if (known?.layer) { prayer.answered = true; return known; }
  const anchor = manifest.ensure(prayer.id, 'highland', prayer.x, prayer.z);
  manifest.override(anchor.id, prayer.seed);
  const roll = mulberry32(anchor.seed);
  // Every prayer is answered; the dice choose the breadth and height, not whether it happens.
  anchor.layer = { reach: 64 + Math.floor(roll() * 33), lift: 4 + Math.floor(roll() * 5) };
  prayer.answered = true;
  return anchor;
}

/**
 * Whether a boot may answer due prayers into its save: only a world of your own, which is a solo
 * endless one. A `?server=` link shares its save slot with the solo link of the same seed, so a
 * highland answered there would reach the page's manifest and never the server's (#491).
 */
export function prayersAnsweredHere(server: boolean, world: WorldKind): boolean {
  return !server && world === 'endless';
}

/** Resolve due promises before the manifest is used to grow country on the next boot. */
export function answerDueHighlands(manifest: Manifest, prayers: HighlandPrayer[], day: number): number {
  let answered = 0;
  for (const prayer of prayers) {
    if (prayer.answered || day < prayer.due) continue;
    if (answerHighland(manifest, prayer, day)) answered++;
  }
  return answered;
}

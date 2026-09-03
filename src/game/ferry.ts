import { DAY_LENGTH } from './state';
import type { Pier, Structures, Village } from '../world/structures';
import { yawFor } from '../entities/entity';

/**
 * Ferries run on a fixed timetable that is a pure function of world time, so a boat is always
 * exactly where the clock says it should be: nothing to save, nothing to simulate while away.
 */
export interface FerryLine {
  id: string;
  islandId: string;
  fromName: string;   // mainland shore
  toName: string;     // island harbour town
  fromPier: Pier;
  toPier: Pier;
  /** Real seconds for one crossing. */
  travel: number;
  /** Real seconds spent docked at each end. */
  dwell: number;
  /** Real seconds for a full round trip; the timetable repeats on this. */
  period: number;
}

export interface FerryState {
  x: number;
  z: number;
  yaw: number;
  /** Which end the boat is tied up at, or null while sailing. */
  docked: 'from' | 'to' | null;
  /** Seconds until it leaves the dock (0 while sailing). */
  departsIn: number;
  /** Seconds until it next docks at the given end. */
  arrivesIn: { from: number; to: number };
}

export const FERRY = {
  SPEED: 6,          // tiles per real second
  DWELL: 20,         // seconds tied up at each end
  MIN_PERIOD: 120,   // seconds; timetable rounds up to whole minutes
  DECK_HEIGHT: 0.55, // where the hero stands above the water line
  BOARD_RANGE: 3.2,  // tiles from a docked boat you can board from
} as const;

/** Real seconds elapsed in this world (day counter plus time of day). */
export function worldSeconds(day: number, time: number): number {
  return (day - 1 + time) * DAY_LENGTH;
}

/**
 * @param islands centres and radii, so the mainland end of a crossing is named after a mainland
 * village rather than the island town that happens to be nearest to both piers.
 */
export function makeFerryLines(structures: Structures, villages: Village[], islands: Array<{ x: number; z: number; radius: number }> = []): FerryLine[] {
  const onIsland = (v: Village) => islands.some((i) => Math.hypot(i.x - v.x, i.z - v.z) < i.radius + 20);
  const mainlandVillages = villages.filter((v) => !onIsland(v));
  const lines: FerryLine[] = [];
  const islands = new Set(structures.piers.map((p) => p.island));
  for (const islandId of islands) {
    const fromPier = structures.piers.find((p) => p.island === islandId && p.side === 'mainland');
    const toPier = structures.piers.find((p) => p.island === islandId && p.side === 'island');
    if (!fromPier || !toPier) continue;
    const dist = Math.hypot(toPier.dockX - fromPier.dockX, toPier.dockZ - fromPier.dockZ);
    const travel = dist / FERRY.SPEED;
    const raw = 2 * travel + 2 * FERRY.DWELL;
    const period = Math.max(FERRY.MIN_PERIOD, Math.ceil(raw / 60) * 60);
    const town = nearestVillage(villages, toPier.dockX, toPier.dockZ);
    const shore = nearestVillage(mainlandVillages, fromPier.dockX, fromPier.dockZ);
    lines.push({
      id: `ferry:${islandId}`, islandId,
      fromName: shore ? `${shore.name} shore` : 'the mainland',
      toName: town ? town.name : islandId,
      fromPier, toPier, travel, dwell: FERRY.DWELL, period,
    });
  }
  return lines;
}

function nearestVillage(villages: Village[], x: number, z: number): Village | null {
  let best: Village | null = null, bestD = Infinity;
  for (const v of villages) {
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

/**
 * Timetable within one period: [0, dwell) docked at from → sail out → docked at to → sail back.
 * Idle time to make up the rounded period is spent docked at the mainland.
 */
export function ferryStateAt(line: FerryLine, seconds: number): FerryState {
  const { travel, dwell, period } = line;
  const p = ((seconds % period) + period) % period;
  const fx = line.fromPier.dockX + 0.5, fz = line.fromPier.dockZ + 0.5;
  const tx = line.toPier.dockX + 0.5, tz = line.toPier.dockZ + 0.5;
  const outYaw = yawFor(tx - fx, tz - fz);
  const backYaw = yawFor(fx - tx, fz - tz);
  const tOut = dwell, tArriveTo = dwell + travel, tLeaveTo = tArriveTo + dwell, tArriveFrom = tLeaveTo + travel;
  const arrivesIn = { from: ((tArriveFrom - p) % period + period) % period, to: ((tArriveTo - p) % period + period) % period };

  if (p < tOut) return { x: fx, z: fz, yaw: outYaw, docked: 'from', departsIn: tOut - p, arrivesIn };
  if (p < tArriveTo) {
    const k = (p - tOut) / travel;
    return { x: fx + (tx - fx) * k, z: fz + (tz - fz) * k, yaw: outYaw, docked: null, departsIn: 0, arrivesIn };
  }
  if (p < tLeaveTo) return { x: tx, z: tz, yaw: backYaw, docked: 'to', departsIn: tLeaveTo - p, arrivesIn };
  if (p < tArriveFrom) {
    const k = (p - tLeaveTo) / travel;
    return { x: tx + (fx - tx) * k, z: tz + (fz - tz) * k, yaw: backYaw, docked: null, departsIn: 0, arrivesIn };
  }
  // padding at the end of the period: waiting at the mainland for the next departure
  return { x: fx, z: fz, yaw: outYaw, docked: 'from', departsIn: period - p + tOut, arrivesIn };
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60), r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

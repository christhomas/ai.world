import { BASE_LEVEL, DTile, levelAt, type DungeonMap } from './map';

/**
 * How much paler a floor is drawn for each terrace it stands above the rest of it.
 *
 * A hole in the ground is all one level and this never comes into it. A castle is not, and the
 * thing the map has to answer there is "why can I see that walkway and not get onto it" — so the
 * gallery round a great hall is drawn brighter than the hall itself, the same way a contour line
 * is not a wall but tells you there is a climb. Small on purpose: at a quarter it stopped reading
 * as the same floor plan and started reading as two overlaid maps.
 */
const PER_TERRACE = 0.12;

/** The colour of ordinary floor, as the three channels the shading works on. */
const FLOOR: readonly [number, number, number] = [0x6a, 0x5a, 0x48];

/** Where the way out is, and the hero, as the floor map marks them. */
export const FLOOR_ENTRANCE = 0x8fa0ff;
export const FLOOR_HERO = 0xff4d4d;

/** The same colour lifted one notch per terrace, clamped so a tall gallery does not go white. */
function lit(base: readonly [number, number, number], terraces: number): number {
  const t = Math.min(1, Math.max(0, terraces) * PER_TERRACE);
  const up = (c: number) => Math.round(c + (255 - c) * t);
  return (up(base[0]) << 16) | (up(base[1]) << 8) | up(base[2]);
}

/**
 * What of a floor the hero has seen: the room or corridor round everywhere he has stood. The
 * page's floor map and an app's both keep it this way, so they light the same cells.
 */
export class FloorSight {
  readonly seen: Uint8Array;
  private count = 0;

  constructor(readonly map: DungeonMap) {
    this.seen = new Uint8Array(map.size * map.size);
  }

  /** How many cells have been seen, which only grows. */
  get known(): number { return this.count; }

  /** Reveal the room or corridor around a position. */
  reveal(x: number, z: number, radius = 4): void {
    const { size } = this.map;
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (dx * dx + dz * dz > radius * radius) continue;
        if (!this.seen[nz * size + nx]) { this.seen[nz * size + nx] = 1; this.count++; }
      }
    }
  }

  /**
   * The colour of a seen cell, or null for one that is rock or not yet seen: water blue, a door red
   * until the floor is unlocked, and floor lifted a notch for each terrace it stands above the rest.
   */
  cell(x: number, z: number, unlocked: boolean): number | null {
    const i = z * this.map.size + x;
    if (!this.seen[i]) return null;
    const t = this.map.tiles[i] as DTile;
    if (t === DTile.Rock) return null;
    if (t === DTile.Water) return 0x2f6f9f;
    if (t === DTile.Door) return unlocked ? 0x8a6a3d : 0xc0392b;
    return lit(FLOOR, levelAt(this.map, x, z) - BASE_LEVEL);
  }

  /** A seen chest's colour: spent, a key, or treasure; null for one not yet seen. */
  chest(i: number, opened: boolean): number | null {
    const c = this.map.chests[i];
    if (!c || !this.seen[c.z * this.map.size + c.x]) return null;
    return opened ? 0x7f7f5a : c.key ? 0xe8e8e8 : 0xf1c40f;
  }
}

/**
 * A floor's map as an installed app draws it (#575): the seen cells as runs of colour row by row,
 * index 0 being dark, then the entrance once seen and every seen chest with its colour.
 */
export interface FloorPicture {
  size: number;
  colours: number[];
  runs: number[];
  entrance: [number, number] | null;
  chests: Array<{ x: number; z: number; colour: number }>;
}

export function floorPicture(sight: FloorSight, opened: (i: number) => boolean, unlocked: boolean): FloorPicture {
  const { size } = sight.map;
  const colours = [0x05060c];
  const index = new Map<number, number>([[0x05060c, 0]]);
  const runs: number[] = [];
  let last = -1;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const colour = sight.cell(x, z, unlocked) ?? 0x05060c;
      let at = index.get(colour);
      if (at === undefined) { at = colours.push(colour) - 1; index.set(colour, at); }
      if (at === last && x > 0) runs[runs.length - 1]++;
      else runs.push(at, 1);
      last = at;
    }
  }
  const [ex, ez] = sight.map.entrance;
  const chests: FloorPicture['chests'] = [];
  sight.map.chests.forEach((c, i) => {
    const colour = sight.chest(i, opened(i));
    if (colour !== null) chests.push({ x: c.x, z: c.z, colour });
  });
  return { size, colours, runs, entrance: sight.seen[ez * size + ex] ? [ex, ez] : null, chests };
}

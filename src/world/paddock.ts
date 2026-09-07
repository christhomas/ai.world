import { hashString, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Biome } from './biomes';
import { StructureKind } from './kinds';
import type { Structure } from './structures';
import type { TerrainSampler, TileSample } from './terrain';
import { TileType } from './terrain';

/**
 * The paddock beside a stable, which is what makes a stable one.
 *
 * A stable used to be a fact about a village and nothing more — a roll on its name, and a man on
 * the square who would sell you a horse. From the road the building was a house like every other
 * house, so there was no finding one except by walking up to everybody in turn. A fenced yard with
 * three animals standing in it reads as a stable from as far off as this camera ever looks.
 */

export const PADDOCK = {
  /** Roofs a village needs before anybody has spare ground to fence and time to muck it out. */
  HOUSES: 5,
  /** Of the villages big enough for one, the share that actually keeps one: worth walking to. */
  SHARE: 0.55,
  /** Rails this far from the middle, so seven tiles across — room for three animals to mill about. */
  HALF: 3,
  /** Clear tiles between the house wall and the near rail. */
  GAP: 2,
} as const;

/**
 * What each country's stables keep, as entity kinds.
 *
 * A village keeps what the country round it rides, which is why you go to the desert for a camel
 * rather than shopping for one at home. One list, because the same answer has to serve two
 * questions — what is standing in the yard, and what the stablehand will sell you — and two tables
 * that are meant to agree are two tables that will not.
 */
export const KEEPS: Record<Biome, string[]> = {
  [Biome.Plains]: ['horse', 'goat'],
  [Biome.Forest]: ['horse', 'goat'],
  [Biome.Desert]: ['camel', 'horse'],
  [Biome.Swamp]: ['goat', 'horse'],
  [Biome.Mountain]: ['goat', 'horse'],
  [Biome.Snow]: ['goat', 'horse'],
};

/**
 * The stable a village keeps: a house with a paddock beside it and animals standing in it.
 *
 * What is standing in the yard and what the stablehand will sell you are read off one list, in
 * `stock`, because two tables that are meant to agree are two tables that will not.
 */
export interface Stabling {
  house: Structure;
  doorX: number;
  doorZ: number;
  /** The middle of the paddock, in tiles. */
  x: number;
  z: number;
  /** How far the rails stand from the middle, so a spawner knows what it may fill. */
  half: number;
  /** The gap in the rails, which is a gate rather than a hole. */
  gate: [number, number];
  /** This country's animals, as entity kinds. */
  stock: string[];
}

/** Where a paddock will go, once somewhere has been found for it. */
export interface Plan {
  /** The middle of the yard, in tiles. */
  x: number;
  z: number;
  /** How far the rails stand from that middle. */
  half: number;
  /** The gap in the rails, which is a gate rather than a hole. */
  gate: [number, number];
  /** What the ground inside is levelled to. */
  level: number;
}

/** Everything finding a yard needs to know about the village it is going into. */
export interface Ground {
  house: Structure;
  seed: number;
  /** Everything already standing, which a paddock has to fit around rather than through. */
  all: readonly Structure[];
  sampler: TerrainSampler;
  sample: TileSample;
  /** The village square, which nothing fences off. */
  plaza: { x: number; z: number; r: number };
}

/**
 * What level a paddock would stand at here, or null where the ground will not take one.
 *
 * Not `footprintLevel`, which is the question a *building* asks: it wants every tile of its
 * footprint on exactly one terrace, because a house half a step into a hillside is a house with a
 * hole in it. Ground is terraced almost everywhere a village stands, so asked that question a
 * seven-tile yard was refused three times in four — by far the commonest reason a village that
 * wanted a stable did not get one.
 *
 * A paddock is a fence round some grass, and grass gets levelled. One terrace of fall is an
 * afternoon with a spade; two is a hillside, and the answer there is to fence somewhere else.
 */
function yardLevel(g: Ground, cx: number, cz: number, half: number): number | null {
  let low = Infinity, high = -Infinity;
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      g.sampler.sampleTile(cx + dx, cz + dz, g.sample);
      const t = g.sample.type;
      if (t === TileType.Skip || t === TileType.Seabed || t === TileType.Water || t === TileType.Bridge) return null;
      // a road through the middle of a paddock is a road somebody has fenced off
      if (t === TileType.Road) return null;
      low = Math.min(low, g.sample.level);
      high = Math.max(high, g.sample.level);
    }
  }
  if (high - low > 1) return null;
  // the lower of the two, so levelling a yard only ever takes ground off and fills nothing in
  return low;
}

/**
 * Whether a paddock will stand here: level ground, clear of the square, and nothing inside it.
 *
 * Not `footprintOk` either, for the same reason. That keeps a wide berth from everything already
 * standing — a house's worth either side — because two buildings a tile apart look like one
 * building. A paddock is meant to abut the house it belongs to, and asked the building question it
 * was refused by its own stable, in every village, every time.
 */
function yardOk(g: Ground, cx: number, cz: number, half: number): number | null {
  if (g.plaza.r > 0 && Math.hypot(cx + 0.5 - g.plaza.x, cz + 0.5 - g.plaza.z) < g.plaza.r + half + 1) return null;
  const level = yardLevel(g, cx, cz, half);
  // its own level, not the house's: a village sits on terraced ground, and a paddock a terrace
  // below its stable is a paddock rather than a fault. More than one terrace is a drop.
  if (level === null || Math.abs(level - g.house.level) > 1) return null;
  for (const s of g.all) {
    if (s === g.house || s.kind === StructureKind.Plaza) continue;
    // touching is fine — a rail against a wall is a paddock; overlapping is not
    if (Math.abs(s.tx - cx) <= s.hw + half && Math.abs(s.tz - cz) <= s.hd + half) return null;
    for (const [px, pz] of s.path) if (Math.abs(px - cx) <= half && Math.abs(pz - cz) <= half) return null;
  }
  return level;
}

/**
 * Find somewhere beside the house to fence, or say there is nowhere.
 *
 * Behind the house first — the door faces the road, so behind it is the side with nothing on it —
 * then either side; and a smaller yard rather than none, because a village street is a tight place
 * and a seven-tile square only sometimes has room. Tried in that order, so a village gets the best
 * yard it can actually fit.
 *
 * Whether the village keeps a stable at all is rolled here, on the stable house's own tile under a
 * label of its own, rather than taken from the layout's stream: so the answer cannot shift because
 * something laid out earlier started asking for one more number.
 */
export function planPaddock(g: Ground): Plan | null {
  const { house } = g;
  const roll = mulberry32(derive(g.seed ^ hashString(`stable:${house.tx}:${house.tz}`), SALT.STRUCTURES));
  if (roll() >= PADDOCK.SHARE) return null;
  const fx = Math.round(Math.cos(house.rot)), fz = Math.round(Math.sin(house.rot));
  for (const half of [PADDOCK.HALF, PADDOCK.HALF - 1]) {
    for (const gap of [PADDOCK.GAP, PADDOCK.GAP + 3]) {
      for (const [ax, az] of [[-fx, -fz], [fz, -fx], [-fz, fx]] as const) {
        if (ax === 0 && az === 0) continue;
        const off = half + gap;
        const x = house.tx + ax * off, z = house.tz + az * off;
        const level = yardOk(g, x, z, half);
        if (level === null) continue;
        // the gate is in the middle of the side facing the house, so the way in is the way you came
        return { x, z, half, gate: [x - ax * half, z - az * half], level };
      }
    }
  }
  return null;
}

/**
 * The yard and its rails, as structures to stand up.
 *
 * The ground goes down first: levelled and cleared of whatever was growing on it, and still grass.
 * Without it a paddock laid in a wood is a fence with three trees and a boulder inside it.
 */
export function railsFor(plan: Plan, biome: Biome): Structure[] {
  const { x, z, half, level, gate } = plan;
  const out: Structure[] = [
    { kind: StructureKind.Paddock, tx: x, tz: z, hw: half, hd: half, level, rot: 0, biome, path: [] },
  ];
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      const edgeX = Math.abs(dx) === half, edgeZ = Math.abs(dz) === half;
      if (!edgeX && !edgeZ) continue;
      const tx = x + dx, tz = z + dz;
      if (tx === gate[0] && tz === gate[1]) continue;
      // the rail is built lying along z, so a run going across x is turned a quarter to meet it
      out.push({
        kind: StructureKind.Fence, tx, tz, hw: 0, hd: 0, level,
        rot: edgeZ && !edgeX ? Math.PI / 2 : 0, biome, path: [],
      });
    }
  }
  return out;
}

import { hash3, rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { PROVINCE, provinceAt, provinceOf, type ProvinceId } from './provinces';

/**
 * What one province is like, as opposed to where it is.
 *
 * The country already varies by *landscape*: biomes come from low-frequency noise, so a forest
 * gives way to plains over a few hundred tiles and a desert belt is a belt rather than a patch.
 * What it has never varied by is **character** — a wood five provinces out was exactly as dangerous
 * as the wood behind the first village, because the only thing deciding what lived in it was which
 * biome the map called it.
 *
 * So: a province has a seed of its own, and a temperament that comes out of it.
 *
 * ## Why a province rather than a ring
 *
 * Because a ring is a lie in an endless world. "It gets harder the further you go" needs a middle
 * to be far from, and this country has no middle — walk west for an hour and you are as far from
 * where you started as anybody can be, so a ring would either wrap round or grow without limit.
 * A province is a place. It is dangerous because it *is*, not because of how you arrived, which
 * means two players who meet there agree about it and a player who leaves and comes back finds it
 * the same.
 *
 * ## Why it is derived rather than stored
 *
 * The same reason everything else here is. `hash3(rootSeed, px, pz)` is one hash, evaluated where
 * somebody is standing, against the dozens of noise samples a chunk already takes — so a world
 * does not precompute its provinces, does not save them, and cannot disagree with itself about one.
 * A province nobody has ever visited already has a character; it is simply that nobody has asked.
 */

/** How a province is disposed towards whoever walks into it. */
export interface Character {
  /** Its own seed, for anything that wants to roll something particular to this place. */
  seed: number;
  /**
   * How dangerous it is, nought to one.
   *
   * Nought is a quiet county where the worst thing out after dark is a fox. One is somewhere with
   * a reputation. It is deliberately a single number rather than a list of what lives there: what
   * lives there is already answered by the biome, and this says how much of the biome's worse half
   * you meet.
   */
  danger: number;
}

/**
 * How far the danger can be pushed either way.
 *
 * A province is never entirely safe and never entirely a nightmare, because both extremes stop
 * being a place and start being a rule. The spread is wide enough to be felt over the two hours it
 * takes to cross three provinces, and narrow enough that a player is never standing in a county
 * where nothing can happen.
 */
export const TEMPER = {
  MILDEST: 0.2,
  WORST: 0.95,
} as const;

/** The character of the province a point is in. */
export function characterAt(rootSeed: number, x: number, z: number): Character {
  return characterOf(rootSeed, provinceOf(x, z));
}

/** The character of a named province, which is the same answer asked the other way round. */
export function characterOf(rootSeed: number, id: ProvinceId): Character {
  const { px, pz } = provinceAt(id);
  const seed = hash3(derive(rootSeed, SALT.PROVINCE), px, pz);
  const roll = rand2(derive(rootSeed, SALT.PROVINCE), px, pz, 1);
  return { seed, danger: TEMPER.MILDEST + roll * (TEMPER.WORST - TEMPER.MILDEST) };
}

/**
 * How dangerous the ground under a point is, blended across the join.
 *
 * A hard edge on a province boundary would be a line in the grass that the game could be played
 * against: walk two tiles north and the wolves stop. So the four provinces nearest a point are
 * weighted by how near their middles are, which makes the frontier between a quiet county and a bad
 * one a stretch of country rather than a border — and frontiers were half of what was asked for.
 *
 * It is still one hash per province rather than a field to sample: four hashes, no state, and the
 * same answer on every machine.
 */
export function dangerAt(rootSeed: number, x: number, z: number): number {
  const px = x / PROVINCE - 0.5, pz = z / PROVINCE - 0.5;
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px - ix, fz = pz - iz;
  // smoothed rather than straight, so the blend eases in and out instead of running at a constant
  // rate across the whole province — the middle of a place should feel like the middle of it
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const at = (ax: number, az: number): number =>
    characterOf(rootSeed, `${ax}:${az}`).danger;
  const north = at(ix, iz) * (1 - sx) + at(ix + 1, iz) * sx;
  const south = at(ix, iz + 1) * (1 - sx) + at(ix + 1, iz + 1) * sx;
  return north * (1 - sz) + south * sz;
}

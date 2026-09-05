import type { Entity } from '../entities/entity';
import { damageEntity, type TileWorld } from '../entities/entity';
import { type EntityManager } from '../entities/manager';
import { PEOPLE } from '../entities/quarry';
import { mulberry32 } from '../core/rng';
import type { GameState } from './state';
import type { Deed, Standing } from './standing';
import { isFur } from './furs';
import { turnedAside, type Blow } from './magic';

export const COMBAT = {
  /** Reach of a swing, in tiles. */
  RANGE: 2.0,
  /** Half-angle of the arc in front of the hero that a swing covers, radians. */
  ARC: 1.1,
  COOLDOWN: 0.45,
} as const;

export interface SwingResult {
  hit: Entity[];
  killed: Entity[];
  gold: number;
  /** Item ids dropped into the rucksack by the kill. */
  loot: string[];
  /** Indices of creatures we struck but did not resolve, because somebody else owns the floor. */
  reported: Array<{ index: number; damage: number }>;
  /**
   * How the country now speaks of you, when this swing changed its mind. Null the rest of the
   * time, which is nearly always: most of what anybody kills is nobody's business.
   */
  regard: string | null;
}

/**
 * What a kill counts as. Cutting down a person is murder whoever they were and whatever they were
 * doing; killing something that had marked a person is a rescue, because the one it had marked is
 * now walking home. Everything else is hunting, and nobody has an opinion about hunting.
 */
export function deedOf(killed: Entity): Deed | null {
  if (PEOPLE.has(killed.kind.id)) return 'murder';
  // somebody's cow is a year of their work, and killing it for the meat is a thing you did to
  // them. Most of what it costs is local and is held by the village itself; this is only the
  // part the whole country ever hears about
  if (killed.kind.owned === true) return 'rustling';
  const saved = killed.target;
  if (saved && !saved.dead && PEOPLE.has(saved.kind.id)) return 'rescue';
  return null;
}

/**
 * What a fallen creature leaves behind, banked into the rucksack. The roll is seeded by where it
 * died, so the same kill is worth the same whoever struck the last blow.
 */
export function spoils(state: GameState, e: Entity, seed: number): { gold: number; loot: string[] } {
  const [lo, hi] = e.kind.gold ?? [0, 0];
  const roll = mulberry32(seed ^ Math.floor(e.x * 131 + e.z * 977));
  const gold = lo + Math.floor(roll() * (hi - lo + 1));
  const loot: string[] = [];
  const drop = e.kind.drop;
  // the hide is not in the loot: it stays on the body until somebody kneels with a knife, which
  // is the whole of what makes a skinning knife worth carrying rather than a tax on carrying one
  if (drop && !isFur(drop.id) && roll() < drop.chance) { state.give(drop.id, 1); loot.push(drop.id); }
  return { gold, loot };
}

/**
 * A blow arriving at the hero, with whatever a ward is turning aside taken off it first.
 *
 * The ward comes in as a plain share for the same reason the standing comes in as an object:
 * combat keeps nothing of its own, and a spell that has lapsed is a share of nought.
 *
 * @param ward how much of a blow is being turned aside now, 0 for anybody who is not warded
 * @returns true when it dropped the hero
 */
export function struck(state: GameState, damage: number, ward = 0): boolean {
  return state.damage(turnedAside(damage, ward));
}

/** Swing at everything in the arc the hero faces. Kills are removed and their gold banked. */
/**
 * @param authoritative false when another player is simulating these creatures: we then report our
 * hits rather than resolving them, so two clients can never kill the same monster twice.
 * @param standing the ledger of what the country makes of you, when there is one to keep. A swing
 * is where most good and most evil actually happens, so it is where the ledger is written.
 */
export function swing(
  state: GameState, entities: EntityManager, world: TileWorld,
  x: number, z: number, yaw: number, seed: number, authoritative = true,
  standing: Standing | null = null,
  /** What a spell is throwing instead of the hero's arm: how hard, and how far. Null for a swing. */
  blow: Blow | null = null,
): SwingResult {
  const damage = blow?.damage ?? state.attack;
  // yaw is a +x-facing rig's heading: forward is (cos yaw, -sin yaw)
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const out: SwingResult = { hit: [], killed: [], gold: 0, loot: [], reported: [], regard: null };
  for (const e of entities.within(x, z, blow?.range ?? COMBAT.RANGE)) {
    if (!e.kind.hp || e.dead) continue;
    const dx = e.x - x, dz = e.z - z;
    const len = Math.hypot(dx, dz) || 1;
    if ((dx / len) * fx + (dz / len) * fz < Math.cos(COMBAT.ARC)) continue;
    out.hit.push(e);
    if (!authoritative) {
      // somebody else runs this floor: tell them, and show the blow landing
      e.hurt = 0.35;
      if (e.rosterIndex >= 0) out.reported.push({ index: e.rosterIndex, damage });
      continue;
    }
    if (!damageEntity(e, damage, x, z, world)) continue;
    out.killed.push(e);
    // judged here rather than after the sweep, because what a creature had marked is what says
    // whether this was a rescue, and a creature taken out of the world has stopped marking anybody
    const deed = standing ? deedOf(e) : null;
    if (standing && deed && standing.did(deed)) out.regard = standing.words;
    const won = spoils(state, e, seed);
    out.gold += won.gold;
    out.loot.push(...won.loot);
  }
  // killed rather than removed: each keeps a body for as long as it takes to fall
  for (const e of out.killed) entities.killEntity(e);
  if (out.gold > 0) { state.inventory.gold += out.gold; state.version++; }
  return out;
}

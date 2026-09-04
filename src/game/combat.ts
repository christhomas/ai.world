import type { Entity } from '../entities/entity';
import { damageEntity, type TileWorld } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import { mulberry32 } from '../core/rng';
import type { GameState } from './state';

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
  if (drop && roll() < drop.chance) { state.give(drop.id, 1); loot.push(drop.id); }
  return { gold, loot };
}

/** Swing at everything in the arc the hero faces. Kills are removed and their gold banked. */
/**
 * @param authoritative false when another player is simulating these creatures: we then report our
 * hits rather than resolving them, so two clients can never kill the same monster twice.
 */
export function swing(
  state: GameState, entities: EntityManager, world: TileWorld,
  x: number, z: number, yaw: number, seed: number, authoritative = true,
): SwingResult {
  const damage = state.attack;
  // yaw is a +x-facing rig's heading: forward is (cos yaw, -sin yaw)
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const out: SwingResult = { hit: [], killed: [], gold: 0, loot: [], reported: [] };
  for (const e of entities.within(x, z, COMBAT.RANGE)) {
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
    const won = spoils(state, e, seed);
    out.gold += won.gold;
    out.loot.push(...won.loot);
  }
  for (const e of out.killed) entities.despawnEntity(e);
  if (out.gold > 0) { state.inventory.gold += out.gold; state.version++; }
  return out;
}

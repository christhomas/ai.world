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
  /** Damage bare-handed and with the iron sword. */
  FIST: 1,
  SWORD: 2,
} as const;

export interface SwingResult {
  hit: Entity[];
  killed: Entity[];
  gold: number;
}

/** Swing at everything in the arc the hero faces. Kills are removed and their gold banked. */
export function swing(
  state: GameState, entities: EntityManager, world: TileWorld,
  x: number, z: number, yaw: number, seed: number,
): SwingResult {
  const damage = state.armed ? COMBAT.SWORD : COMBAT.FIST;
  // yaw is a +x-facing rig's heading: forward is (cos yaw, -sin yaw)
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const out: SwingResult = { hit: [], killed: [], gold: 0 };
  for (const e of entities.within(x, z, COMBAT.RANGE)) {
    if (!e.kind.hp || e.dead) continue;
    const dx = e.x - x, dz = e.z - z;
    const len = Math.hypot(dx, dz) || 1;
    if ((dx / len) * fx + (dz / len) * fz < Math.cos(COMBAT.ARC)) continue;
    out.hit.push(e);
    if (!damageEntity(e, damage, x, z, world)) continue;
    out.killed.push(e);
    const [lo, hi] = e.kind.gold ?? [0, 0];
    const roll = mulberry32(seed ^ Math.floor(e.x * 131 + e.z * 977));
    out.gold += lo + Math.floor(roll() * (hi - lo + 1));
  }
  for (const e of out.killed) entities.despawnEntity(e);
  if (out.gold > 0) { state.inventory.gold += out.gold; state.version++; }
  return out;
}

import { BEHAVIOUR, damageEntity, type Entity, type TileWorld } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import { markFor, type ShotResult, type Sight } from './archery';
import { deedOf, spoils } from './combat';
import type { GameState } from './state';
import type { Standing } from './standing';

/**
 * The gun on the thing in the crater.
 *
 * `Zarch` had one and it is half of why flying it was worth doing: a craft that can only fly is a
 * vehicle, and a craft that can shoot is a reason to go and look at what is moving down there. This
 * is that, and it is deliberately the bow's rule rather than a new one — the shot is picked by
 * `markFor`, which already measures a slant rather than a distance across the ground, because the
 * bow was the one thing in this game that could reach something not standing on the earth. A craft
 * hovering four units up is in exactly that position about everything it flies over.
 *
 * What is different from a bow, and why:
 *
 *  - **No ammunition.** Whatever this is, it did not come with a quiver. The cost of shooting is
 *    that you have to fly, and flying is expensive in the only currency this machine charges in,
 *    which is your attention.
 *  - **Its own damage, rather than the hero's.** What is in your pack does not matter in the seat.
 *    A man with a rusty knife and a man in plate armour have the same gun.
 *  - **A tighter cone and a longer reach.** It is aimed by turning the whole craft, which is slow,
 *    so it has to carry further to be worth firing at all.
 *  - **A short cooldown.** A bow is nocked and drawn; this is a trigger.
 */
export const GUN = {
  /** How far it carries, measured along the shot rather than across the ground. */
  RANGE: 18,
  /** Half-angle of the cone, radians. Tighter than a bow, because the whole craft is the sight. */
  ARC: 0.3,
  /** Seconds between shots. A trigger rather than a draw. */
  COOLDOWN: 0.35,
  /**
   * What one shot takes off, in the same units a sword does.
   *
   * Between a bow and a good blade. It has to be worth flying out for and it must not make the
   * craft the answer to everything — a hero who never lands is a hero playing a different game, and
   * the country is still where the rest of it happens.
   */
  DAMAGE: 3,
} as const;

/**
 * Where the shot comes from.
 *
 * `eye` is measured from the ground under the craft, which is what the craft's own hover height
 * already is — so this is the machine's altitude rather than a pilot's shoulder, and a shot at
 * something in a valley below is the long shot it looks like.
 */
export function sightFrom(hover: number): Sight {
  return { range: GUN.RANGE, arc: GUN.ARC, eye: hover };
}

/**
 * Fire, along the way the craft is pointing.
 *
 * The same shape as `shoot`: one creature, nearest first, and the world resolves it when the world
 * owns it. Nothing here spends anything, so there is no recovery to account for either — which is
 * the whole reason this is a separate function rather than a flag on the bow.
 */
export function fire(
  state: GameState, entities: EntityManager, world: TileWorld,
  x: number, z: number, yaw: number, hover: number, seed: number, authoritative = true,
  standing: Standing | null = null,
): ShotResult {
  const out: ShotResult = {
    hit: [], killed: [], gold: 0, loot: [], reported: [], regard: null, spent: 0, recovered: 0,
  };
  const mark = markFor(entities, world, x, z, yaw, sightFrom(hover));
  if (!mark) return out;

  out.hit.push(mark);
  if (mark.worldId > 0) {
    // the world owns this one: show it flinch, and let the world say what actually happened, the
    // same way an arrow does. Two people flying over the same deer must not both kill it
    mark.hurt = BEHAVIOUR.HURT_TIME;
    return out;
  }
  if (!authoritative) {
    mark.hurt = BEHAVIOUR.HURT_TIME;
    if (mark.rosterIndex >= 0) out.reported.push({ index: mark.rosterIndex, damage: GUN.DAMAGE });
    return out;
  }
  if (!damageEntity(mark, GUN.DAMAGE, x, z, world)) return out;
  out.killed.push(mark);
  // judged while the creature is still in the world, for the reason an arrow is: what it had marked
  // is what says whether killing it was a rescue or a murder. A gun does not change that
  const deed = standing ? deedOf(mark) : null;
  if (standing && deed && standing.did(deed)) out.regard = standing.words;
  const won = spoils(mark, seed);
  out.gold += won.gold;
  out.loot.push(...won.loot);
  entities.killEntity(mark);
  for (const item of out.loot) state.give(item, 1);
  if (out.gold > 0) { state.inventory.gold += out.gold; state.version++; }
  return out;
}

/** Whatever was killed from the air, for whoever has to be told about it. */
export type GunShot = ReturnType<typeof fire>;

/** A creature the gun would reach, for a test or a probe that wants to ask without firing. */
export function markUnder(
  entities: EntityManager, world: TileWorld, x: number, z: number, yaw: number, hover: number,
): Entity | null {
  return markFor(entities, world, x, z, yaw, sightFrom(hover));
}

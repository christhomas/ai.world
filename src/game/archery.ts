import { BEHAVIOUR, damageEntity, type Entity, type TileWorld } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import { deedOf, spoils, type SwingResult } from './combat';
import type { GameState } from './state';
import type { Standing } from './standing';

/**
 * The bow, and the one thing a sword cannot do: reach something that is not standing on the ground.
 *
 * A swing measures the world flat. It takes everything in an arc in front of the hero out to two
 * tiles and never once asks how high any of it is, which is right for a wolf and useless against
 * an eagle at nine tiles up: a bird that circles overhead is never both in front of you and within
 * a sword's length of you, so nothing in the game could touch it. A shot measures the line the
 * arrow actually has to fly, height included, so a bird overhead is exactly as far off as it looks
 * and the same bird lower down is nearer.
 *
 * The decision worth explaining is that a shot takes one creature where a swing takes every
 * creature in the arc. An arrow is one arrow: it stops in the first thing it reaches and goes no
 * further. That is also what makes the quiver honest, because it leaves exactly one arrow to
 * account for per shot, which is what the recovery rule below is able to be simple about.
 */

export const BOW = {
  /** What must be in the hand, and what it eats. Both are ordinary items in the catalogue. */
  WEAPON: 'bow',
  AMMO: 'arrow',
  /** How far an arrow carries, measured along its flight rather than across the ground. Tiles. */
  RANGE: 14,
  /** Half-angle of the cone a shot covers, radians. Far tighter than a swing: a bow is aimed. */
  ARC: 0.42,
  /** Longer than a swing's: an arrow has to be nocked and drawn before it goes anywhere. Seconds. */
  COOLDOWN: 0.8,
  /** Arrows off the string per shot. One, because an arrow is one arrow. */
  SPEND: 1,
  /** Arrows found again after a shot that landed: it is standing in whatever it stopped. */
  KEEP_HIT: 1,
  /**
   * And after one that did not. A miss goes into the grass at a hundred paces with nothing to
   * mark where, so it is gone: that, and not a tax on shooting, is why the quiver empties. Shoot
   * well and you keep nearly all of them, which is what the fletcher means by getting them back.
   */
  KEEP_MISS: 0,
  /** Height the arrow leaves the bow at, so a shot at a bird is measured from the shoulder. */
  SHOULDER: 1.3,
} as const;

/**
 * What a shot did. A swing's result with the quiver added, so whatever draws the sword's outcome
 * on the screen can draw the bow's without learning anything new.
 */
export interface ShotResult extends SwingResult {
  /** Arrows taken out of the quiver. Nought when there was no shot to take. */
  spent: number;
  /** And put back into it. */
  recovered: number;
}

/** Is the hero holding a bow? A bow does nothing from inside a pack, the way a lantern does not. */
export function bowInHand(state: GameState): boolean {
  return state.worn('hand')?.id === BOW.WEAPON;
}

/** Arrows to hand. */
export function quiver(state: GameState): number {
  return state.count(BOW.AMMO);
}

/** Whether there is a shot to take at all: a bow in the hand, and something to put on the string. */
export function canShoot(state: GameState): boolean {
  return bowInHand(state) && quiver(state) > 0;
}

/**
 * The one creature an arrow loosed from here would stop in, or null for a shot into the grass.
 *
 * Pure in everything it is given, so what an arrow would hit can be asked without shooting: the
 * aiming is all here, and `shoot` below only spends the arrow and settles what falls.
 */
export function markFor(
  entities: EntityManager, world: TileWorld, x: number, z: number, yaw: number,
): Entity | null {
  // yaw is a +x-facing rig's heading: forward is (cos yaw, -sin yaw), as a swing reads it
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const eye = (world.heightAt(x, z) ?? 0) + BOW.SHOULDER;
  const cone = Math.cos(BOW.ARC);
  // the flat ring is only a sieve: nothing can be within the arrow's flight and outside a circle
  // of the same size on the ground, so this can never drop a creature the slant test would keep
  for (const e of entities.within(x, z, BOW.RANGE)) {
    if (!e.kind.hp || e.dead) continue;
    const dx = e.x - x, dz = e.z - z, dy = e.y - eye;
    const ground = Math.hypot(dx, dz);
    // the cone is measured across the ground, so a bird directly above the hero is not in front
    // of them and cannot be shot: there is no drawing a bow at your own hat
    const aim = ground || 1;
    if ((dx / aim) * fx + (dz / aim) * fz < cone) continue;
    if (Math.hypot(ground, dy) > BOW.RANGE) continue;
    return e;
  }
  return null;
}

/**
 * Loose an arrow along the way the hero faces. Nearest first, one creature only, and the arrow is
 * spent whether or not it found anything.
 *
 * @param authoritative false when another player is simulating these creatures: we then report the
 * hit rather than resolving it, exactly as a swing does, so two clients cannot kill the same bird.
 * @param standing the ledger of what the country makes of you, when there is one to keep. Shooting
 * a man in the back is still murder, so an arrow is written up the same way a sword is.
 */
export function shoot(
  state: GameState, entities: EntityManager, world: TileWorld,
  x: number, z: number, yaw: number, seed: number, authoritative = true,
  standing: Standing | null = null,
): ShotResult {
  const out: ShotResult = {
    hit: [], killed: [], gold: 0, loot: [], reported: [], regard: null, spent: 0, recovered: 0,
  };
  if (!canShoot(state)) return out;
  const damage = state.attack;
  out.spent = state.take(BOW.AMMO, BOW.SPEND);
  const mark = markFor(entities, world, x, z, yaw);
  // settled before anything is resolved, because what the arrow is worth on the way back depends
  // only on whether it stopped in something, not on whether that something died of it
  const kept = out.spent * (mark ? BOW.KEEP_HIT : BOW.KEEP_MISS);
  if (kept > 0) { state.give(BOW.AMMO, kept); out.recovered = kept; }
  if (!mark) return out;

  out.hit.push(mark);
  if (mark.worldId > 0) {
    // the world owns this one: show the arrow landing, and let the world say what it did. It picks
    // the mark itself, by the same rule — nearest first, one creature, height counted — against the
    // hero it has been walking rather than against the one drawn here.
    mark.hurt = BEHAVIOUR.HURT_TIME;
    return out;
  }
  if (!authoritative) {
    // somebody else runs this floor: tell them, and show the shot landing
    mark.hurt = BEHAVIOUR.HURT_TIME;
    if (mark.rosterIndex >= 0) out.reported.push({ index: mark.rosterIndex, damage });
    return out;
  }
  if (!damageEntity(mark, damage, x, z, world)) return out;
  out.killed.push(mark);
  // judged before the creature leaves the world, for the reason a swing judges it there: what it
  // had marked is what says whether killing it was a rescue
  const deed = standing ? deedOf(mark) : null;
  if (standing && deed && standing.did(deed)) out.regard = standing.words;
  const won = spoils(state, mark, seed);
  out.gold += won.gold;
  out.loot.push(...won.loot);
  entities.killEntity(mark);
  if (out.gold > 0) { state.inventory.gold += out.gold; state.version++; }
  return out;
}

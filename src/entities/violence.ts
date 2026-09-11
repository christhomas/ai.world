import { BOUNTY } from './spawning';
import { blowOf } from './motion';
import { PEOPLE } from './quarry';
import { Entity, damageEntity, throwBlow, type TileWorld } from './entity';

/**
 * What one creature does to another, and what it is worth to them.
 *
 * Out of the manager because it is the one thing in there that is not about *holding* creatures.
 * Everything else that file does is bookkeeping — which chunk a herd is filed under, which of them
 * are near enough to think for, which have wandered out of the world — and this is a rule of the
 * game that happens to need two of them at once.
 *
 * The hero is deliberately not here. His hearts have a HUD, a save and a death screen behind them,
 * so they are the game's business; this is the arithmetic of a wolf on a deer, a constable on a
 * thief, and a villager on the wolf.
 */

/**
 * A blow lands.
 *
 * Returns whether it killed, because the caller is the only thing that knows what to do about a
 * body — the country buries it where it fell, a dungeon floor does not, and the register wants to
 * hear about a person and not about a rabbit.
 */
export function oneHurtsAnother(
  o: {
    world: TileWorld;
    /** Somebody who was on the register has died: their family, their purse, their stone. */
    fallen: (who: Entity) => void;
    /** And whatever holds the crowd is told to let go of the body. */
    remove: (who: Entity) => void;
  },
  attacker: Entity, victim: Entity, damage: number,
): void {
  throwBlow(attacker, blowOf(attacker.kind));
  if (!damageEntity(victim, damage, attacker.x, attacker.z, o.world)) {
    // being bitten is a good reason to notice who is biting you
    if ((victim.kind.damage ?? 0) > 0) victim.target = attacker;
    return;
  }
  if (PEOPLE.has(victim.kind.id)) o.fallen(victim);
  /*
   * What a killed animal is worth to whoever killed it.
   *
   * A constable takes the whole bounty because clearing a wolf off a road is the job; anybody else
   * gets a share, because what a hunter has is a pelt and not a warrant. Only people are paid —
   * a wolf that kills a deer is not owed anything for it.
   */
  const bounty = victim.kind.gold?.[0] ?? 0;
  if (bounty > 0 && PEOPLE.has(attacker.kind.id)) {
    attacker.purse += attacker.trade === 'constable' ? bounty : Math.round(bounty * BOUNTY.RESCUE_SHARE);
  }
  o.remove(victim);
  attacker.target = null;
}

/**
 * What the law pays a constable for taking somebody in.
 *
 * On the same purse as every other bounty, and deliberately: putting down the wolf that was on a
 * farmer and putting away the man who was are the same job, and a worse criminal is worth more of
 * it. What being taken in *costs* the hero is the game's business and is decided elsewhere.
 */
export function arrestPay(guilt: number): number {
  const much = Math.max(0, Math.min(1, guilt));
  return Math.round(BOUNTY.ARREST + much * BOUNTY.ARREST_WORST);
}

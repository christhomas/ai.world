import { GAMEPLAY } from '../core/config';
import type { Entity } from '../entities/entity';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import { remember } from '../world/people';
import type { Register } from '../world/register';
import type { Structures } from '../world/structures';
import type { Sound } from './audio';
import { GRUDGE, saidOf as saidOfRegard, type Grudges } from './grudge';
import { HIRE } from './hire';
import { clockAt, toldOnWaking, windOn, type Jail } from './jail';
import type { Online } from './online';
import type { Remains } from './remains';
import type { Standing } from './standing';
import type { GameState } from './state';

/**
 * What the world does about what just happened.
 *
 * The three of these have nothing in common mechanically and everything in common in what they
 * are for: each is the moment a deed stops being a number and turns into something the country
 * did back. A cow killed is a village that has heard about you; a sentence served is hours you
 * are not getting back; somebody dead is a pack on the ground and a name off the register.
 */
export interface Consequence {
  seed: number;
  state: GameState;
  player: Player;
  iso: IsoCamera;
  structures: Structures;
  register: Register;
  grudges: Grudges;
  standing: Standing;
  jail: Jail;
  online: Online;
  remains: Remains;
  sound: Sound;
  flash: (message: string) => void;
  /** One of a band standing in the world is dead, which is the band's own business. */
  oneFell: (who: Entity) => void;
  /** A hired man dies like any other villager: all that ends here is what he was owed. */
  hireFallen: (person: string) => { name: string } | null;
  persist: () => void;
}

export function createConsequences(ctx: Consequence) {
  const {
    seed, state, player, iso, structures, register, grudges, standing, jail, online, remains,
    sound, flash, oneFell, hireFallen, persist,
  } = ctx;

  return {
    /**
     * Somebody's animal has been killed for the meat, and the village it belonged to finds out.
     *
     * The village nearest where it fell is the one that owns it, which is not a rule so much as an
     * observation: a cow does not wander far. Word travels because a village here is twenty people
     * who carry each other's news, so it lands in the memories of whoever is alive to hold it, and
     * they will say so when you next stop to talk.
     */
    rustled: (beast: Entity): string => {
      const near = structures.villages.reduce((best, v) =>
        Math.hypot(v.x - beast.x, v.z - beast.z) < Math.hypot(best.x - beast.x, best.z - beast.z) ? v : best);
      grudges.slighted(near.name, state.day);
      for (const person of [...register.living(near.name)].slice(0, GRUDGE.WORD_REACHES)) {
        remember(person, { what: 'robbed', who: `${beast.kind.label} of ${near.name}`, day: state.day });
      }
      persist();
      return saidOfRegard(grudges.regard(near.name, state.day), near.name);
    },

    /**
     * A constable has caught up with you, and now there is somewhere to put you.
     *
     * The sentence is served rather than skipped: the clock is wound forward, so the world moves on
     * without you, villagers age and the market changes while you are inside. That is more of a
     * punishment than any number would be. Where no station will take you the old arrangement
     * stands and you lose the hours in the square.
     */
    arrested: (by: Entity): void => {
      const hours = standing.sentence();
      standing.served();
      state.standing = standing.value;
      const held = jail.take(structures.villages, by.x, by.z, 'you', hours, clockAt(state), state.day, state.inventory.gold);
      windOn(state, hours);
      register.advance(state.day);            // the village grew older while you were not watching
      // your own hours are served the moment the clock jumps, so the cell is empty behind you
      if (held) { state.inventory.gold -= held.fine; jail.release(held.village); }
      const cell = held ? [held.x, held.z] : (by.posts.square ?? [by.x, by.z]);
      player.teleport(cell[0], cell[1]);
      iso.target.set(cell[0], 0.5, cell[1]);
      state.version++;
      flash(held
        ? `${by.name} takes you in. ${toldOnWaking(held)}`
        : `${by.name} takes you in. You come round in the square ${Math.round(hours)} hours later.`);
      sound.thud();
      persist();
    },

    /**
     * Somebody has been killed by something. They leave what they had where they fell, and if it
     * happened within sight you are told, because a scream in the middle distance is the point.
     */
    fallen: (who: Entity): void => {
      const bargain = who.person !== '' ? hireFallen(who.person) : null;
      oneFell(who);
      // a villager killed by something is off the register for good, and the people who knew them
      // are the only record of it left
      if (who.person !== '') {
        const death = register.bury(who.person, state.day);
        if (death) online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
      }
      // what he leaves is a soldier's pack: being in your pay was an arrangement, not a trade
      const trade = who.trade === HIRE.TREE ? HIRE.TRADE : who.trade;
      remains.leave(who.name, trade, who.x, who.z, who.purse, who.carrying?.id ?? null, seed ^ Math.floor(who.x * 131 + who.z * 977));
      if (Math.hypot(who.x - player.x, who.z - player.z) < GAMEPLAY.POI_DISCOVER_RADIUS * 6) {
        flash(`${who.name} was killed. Their pack is where they fell.`);
        sound.thud();
      }
      if (bargain) flash(`${bargain.name}, who you hired, is dead.`);
    },
  };
}

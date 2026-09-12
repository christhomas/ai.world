import { GAMEPLAY } from '../core/config';
import { buy, holds } from '../world/deeds';
import { villageTill } from './tills';
import type { Entity } from '../entities/entity';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import type { Remembering } from '../world/people';
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
  /**
   * How a thing that happened reaches the villagers it happened near.
   *
   * Handed in rather than reached for, because it is not simply remembering any more: where a world
   * is holding the villagers, a memory made here has to be said out loud or it is a memory only this
   * screen has. `main.ts` builds the one door.
   */
  recall: Remembering;
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
    sound, flash, oneFell, hireFallen, persist, recall,
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
        recall(person, { what: 'robbed', who: `${beast.kind.label} of ${near.name}`, day: state.day });
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
      // the fine goes to the village that held you: it is their constable, their cell and their
      // afternoon, and a fine that left the world was a village policing you for nothing
      if (held) {
        buy(holds(state.inventory), villageTill(register, held.village), held.fine);
        jail.release(held.village);
      }
      const cell = held ? [held.x, held.z] : (by.posts.square ?? [by.x, by.z]);
      player.teleport(cell[0], cell[1]);
      // the same telling a knockout needs, for the same reason: the world went on holding him where
      // he was arrested, and its next word would put him back there
      online.stood(cell[0], cell[1], 'carried');
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

/**
 * Everything the world has to be told when something dies. Handed in, so this decides nothing.
 *
 * Separate from `Consequence` above because it is a different question: that one is *this* player's
 * game reacting, and this is the world's own bookkeeping, which is the same however the thing died.
 */
export interface Aftermath {
  /** A carcass, left where it fell, for anybody who walks back to it with a knife. */
  fell: (kind: string, x: number, z: number) => void;
  /** The law's memory: who has been killing what, and where. */
  troubleKilled: (kind: string, x: number, z: number) => void;
  /** How much of a mine has been fought through, which is what the danger down there is made of. */
  reportCleared: (mine: string | null, many: number) => void;
  /** A beast with an owner is somebody's livelihood; taking it is remembered as what it is. */
  rustled: (beast: Entity) => string;
  /** Which mine this is happening in, or nothing for a killing in the open air. */
  fightingInAMine: () => string | null;
}

/**
 * What a kill means, in one place.
 *
 * A creature dying is not one event, it is four: a carcass in the grass, a mine that is emptier of
 * trouble than it was, a constable who now knows who started it, and — if the thing had an owner —
 * a village that thinks rather less of you. Every one of those is a fact about the *world* rather
 * than about whoever swung.
 *
 * It was written twice. `blows.felled` did all four for a creature this page killed, and
 * `authority.onCreatureKilled` did one of them for a creature the world killed, because it was
 * written later, from the other side, by somebody solving a different problem. The seam audit found
 * the gap as separate bugs, which is how a duplicated rule always presents: kill a cow in a shared
 * world and nobody minds, clear a mine and the village still believes it is haunted, cut something
 * down in front of a constable and your name stays clean.
 *
 * The rule to keep when this grows: what a kill *means* lives here, and who gets the gold does not.
 * Spoils belong to whoever landed the blow, and that is the one part of a death that is genuinely
 * about a person rather than about the world.
 */
export function whatAKillMeans(killed: readonly Entity[], o: Aftermath): { rustling: string | null } {
  /*
   * What lived in the workings is what made them dangerous, so killing it is the one thing a player
   * can do that moves a village's whole economy. Anybody on the register is not what lived down
   * there — he is the village's own, at the face — and cutting him down makes a mine emptier of
   * people rather than emptier of trouble. Counting him would let a player make a hole "safe" by
   * murdering the crew that works it, which is the economy read backwards.
   */
  const lurking = killed.filter((e) => e.person === '').length;
  if (lurking > 0) o.reportCleared(o.fightingInAMine(), lurking);

  let rustling: string | null = null;
  for (const e of killed) {
    o.fell(e.kind.id, e.x, e.z);
    o.troubleKilled(e.kind.id, e.x, e.z);
    if (e.kind.owned === true) rustling = o.rustled(e);
  }
  return { rustling };
}

/**
 * Telling everybody that a mine is that much emptier of trouble.
 *
 * Out of `blows.ts` because the world's half of a kill needs it too, and a rule that two callers
 * reach for is a rule that belongs where they can both see it.
 *
 * The running total goes on the wire rather than the handful just killed: the delta log keeps one
 * entry per mine and a later one replaces the earlier, so an increment would be swallowed. A total
 * survives that, arrives in any order, and can be applied twice without counting anything twice.
 */
export function clearedTheMine(
  mines: { slain: (id: string | null, many: number) => void; clearedIn: (id: string) => number },
  online: { report: (delta: { kind: 'cleared'; mine: string; many: number }) => void },
): (id: string | null, many: number) => void {
  return (id, many) => {
    mines.slain(id, many);
    if (id) online.report({ kind: 'cleared', mine: id, many: mines.clearedIn(id) });
  };
}

/**
 * The four things a kill means, wired up for whoever is doing the killing.
 *
 * Here rather than in `main.ts` because it is the rule's own wiring: the day a fifth consequence is
 * added, the place that knows about it and the place that hands it over should be the same file.
 * `main.ts` was also at the size this codebase holds a module to, and a paragraph of plumbing is
 * exactly what should not be the thing that pushes it over.
 *
 * Taken as one thunk rather than five arguments because most of what it needs is built *after* the
 * authority that uses it — the wire, the interface, what a village makes of a dead cow — and none
 * of it is called until somebody kills something, which is long after all of it exists.
 */
export function aftermath(
  later: () => {
    interactions: {
      fell: (kind: string, x: number, z: number) => void;
      troubleKilled: (kind: string, x: number, z: number) => void;
    };
    online: { report: (delta: { kind: 'cleared'; mine: string; many: number }) => void };
    rustled: (beast: Entity) => string;
    hud: { flash: (message: string) => void };
  },
  mines: { slain: (id: string | null, many: number) => void; clearedIn: (id: string) => number },
  fightingInAMine: () => string | null,
): Aftermath & { flash: (message: string) => void } {
  return {
    fell: (kind, x, z) => later().interactions.fell(kind, x, z),
    troubleKilled: (kind, x, z) => later().interactions.troubleKilled(kind, x, z),
    reportCleared: (mine, many) => clearedTheMine(mines, later().online)(mine, many),
    rustled: (beast) => later().rustled(beast),
    fightingInAMine,
    flash: (message) => later().hud.flash(message),
  };
}

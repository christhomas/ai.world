import { PROSPER } from './prosperity';
import type { Person } from './people';

/**
 * The things anybody in this world can do, named once, so that everybody does them the same way.
 *
 * There are two systems in this game for acting on the world and they have never shared a word of
 * vocabulary. `entities/verbs.ts` is what a creature can do — a tick's worth of walking, striking,
 * taking, selling — driven by a behaviour tree out of `behaviours/`. `game/interact/` is what the
 * player can do, three thousand lines of menus and dialogue in fifteen files, driven by the Enter
 * key. A villager sells a deer through the first. The hero buys a horse through the second. Both
 * are a sale, and until now no line of code believed that.
 *
 * What it cost is not theoretical. A hunter you watched was credited the price of his meat out of
 * nowhere while an unwatched one was paid his neighbours' money — same man, same deer, two
 * economies. And the hero has been paying for horses, ferries, beds, houses and hired swords for
 * the whole life of the game by subtracting from a number: `state.inventory.gold -= price`, at
 * fifteen separate sites, not one of which says who was paid. Every coin a player has ever spent
 * has left the world. The villagers stopped burning money a version ago and the player never did.
 *
 * So: a deed is what an act *does*, apart from who ordered it and how it was drawn. A creature verb
 * becomes a tick-function wrapping a deed; a menu choice becomes a menu wrapping the same deed.
 * Two callers, one expression — the rule this codebase already holds its catalogues and its trade
 * tables to, applied to the only layer that never had it.
 *
 * ## What a deed is allowed to be
 *
 * Pure of everything except the money and the people. No renderer, no dialogue, no HUD, no chunk
 * manager, no clock. A deed takes who is acting, what they are acting on, and hands back what
 * changed — which is what makes it testable without a browser and drivable without a keyboard, and
 * those two are the whole reason for doing this.
 *
 * It is also what makes the hero drivable by a behaviour tree later. That is a stated goal rather
 * than a thing being built here: nothing below knows or cares whether the hand that called it
 * belonged to a player, a villager, or a script running a playtest.
 */

/**
 * A place money is kept.
 *
 * An interface rather than a number because the two halves of this world keep money in different
 * shapes and neither is going to change: the hero's is `state.inventory.gold` and a villager's is
 * `person.purse`, one a field on a rucksack and the other a field on a register entry. A deed that
 * took either would have to know which, and a deed that knew which would be two deeds.
 *
 * `take` returns what was actually taken rather than assuming it got what it asked for, which is
 * the whole of how a deed says "you could not afford that" without throwing.
 */
export interface Holder {
  /** What is in it. */
  readonly has: number;
  /** Take up to this much out, and say what was actually taken. */
  take(much: number): number;
  /** And put this much in. */
  give(much: number): void;
}

/**
 * Anything that keeps its money in a field called `gold`: the hero's rucksack, a strongbox, a till.
 *
 * Uncapped by default. The hero has never had a ceiling on what he can carry and putting one in
 * here would be a rule about the game smuggled in as a rule about arithmetic.
 */
export function holds(of: { gold: number }, cap = Infinity): Holder {
  return {
    get has() { return of.gold; },
    take: (much) => {
      const took = Math.max(0, Math.min(much, of.gold));
      of.gold -= took;
      return took;
    },
    give: (much) => { of.gold = Math.min(cap, of.gold + Math.max(0, much)); },
  };
}

/**
 * A villager's purse, which is on the register and so outlives the body standing in the street.
 *
 * Capped at `PROSPER.MOST` by default, and that cap is not arbitrary: it is the one that stops a
 * long-lived shopkeeper in a quiet corner ending the century holding everything. A deed paying a
 * villager must go through here rather than touching `purse` directly, or the cap is a rule that
 * only some of the code obeys.
 */
export function purseOf(person: Person, cap: number = PROSPER.MOST): Holder {
  return {
    get has() { return person.purse; },
    take: (much) => {
      const took = Math.max(0, Math.min(much, person.purse));
      person.purse -= took;
      return took;
    },
    give: (much) => { person.purse = Math.min(cap, person.purse + Math.max(0, much)); },
  };
}

/**
 * Everywhere that is not here: the rest of the world, which this game does not simulate.
 *
 * A sink and a source, and it has to be both. Money leaves through it — a toll on an empty road, a
 * fine paid to a state with no treasury, the keep of a village whose own market is shut and whose
 * money goes off on a pedlar's cart. And money arrives through it — a shopkeeper who buys forty
 * pelts off you is not paying out of the till, he is paying because those pelts are going to a
 * city this game has never drawn, and the coin that comes back for them was never in the valley.
 *
 * Named rather than passed as `null` so that every place a coin appears or disappears has to say
 * so in so many words. That is the whole reason this file exists: fifteen sites were saying it by
 * accident, with a `-=` and no comment, and nobody had noticed that the hero's money had been
 * leaving the world since the day there was a hero.
 */
export const AWAY: Holder = {
  has: Infinity,
  take: (much) => Math.max(0, much),
  give: () => {},
};

/** What an act of paying came to. */
export interface Paid {
  /** What actually changed hands. */
  paid: number;
  /** Whether the payer could cover the whole of it. */
  afforded: boolean;
}

/**
 * Move money from one holder to another. The one place a coin changes hands.
 *
 * Partial payment is allowed and reported rather than refused, because the two callers want
 * different things from the same fact: a player who cannot afford a horse is told so and keeps
 * their gold, and a village that cannot afford the whole deer buys as much of it as it can. Both
 * are served by handing back what happened and letting them decide.
 */
export function transfer(from: Holder, to: Holder, price: number): Paid {
  if (price <= 0) return { paid: 0, afforded: true };
  const paid = from.take(price);
  to.give(paid);
  return { paid, afforded: paid >= price };
}

/**
 * Buy something at a price, all or nothing.
 *
 * The deed under every purchase in the game: a horse, a ferry crossing, a bed for the night, a
 * round of darts, a house. All or nothing because that is what a shop is — nobody sells you
 * four fifths of a horse — so a buyer who cannot cover it pays nothing and is told.
 */
export function buy(buyer: Holder, seller: Holder, price: number): Paid {
  if (buyer.has < price) return { paid: 0, afforded: false };
  return transfer(buyer, seller, price);
}

/**
 * Sell something for what the buyer can actually find, which may be less than it is worth.
 *
 * The mirror of `buy` and deliberately not the same rule. A hunter carrying a deer into a poor
 * village does not carry it home again: he takes what there is, because meat does not keep. What
 * a seller will not do is take money out of somebody's last week of dinners, which is what
 * `reserve` is for — the same reserve `spentOnLiving` will not spend below.
 */
export function sell(seller: Holder, buyer: Holder, price: number, reserve = 0): Paid {
  const afford = Math.max(0, Math.min(price, buyer.has - reserve));
  const got = transfer(buyer, seller, afford);
  return { paid: got.paid, afforded: got.paid >= price };
}

/**
 * Hand money over for nothing in return: a gift, a wage, a share of a find, an estate.
 *
 * Distinct from `buy` because nothing is being priced. A giver who has less than they meant to
 * give gives what they have, which is what anybody does.
 */
export function give(from: Holder, to: Holder, much: number): Paid {
  return transfer(from, to, Math.min(much, from.has));
}

/**
 * Things changing hands, which is the other half of the vocabulary.
 *
 * `deeds.ts` did money: one `Holder`, so a rucksack and a purse are the same shape to a deed, and
 * one `transfer` under every coin that moves. This is the same idea for everything that is not
 * money, and it exists for the same reason — the game keeps things in four different shapes and
 * every place they move between two of them was written out again from scratch.
 *
 * The four:
 *
 * - the hero's pack, a `Map<string, number>` behind `state.give` and `state.take`
 * - a villager's shoulder, `Entity.carrying`, which holds exactly one kind of thing
 * - a strongbox, a plain `Record<string, number>` on a commission
 * - a shop's shelf, which is a list of what it deals in rather than a count of what it has
 *
 * None of those is going to change and none of them should have to. What changes is that a deed
 * no longer has to know which it is looking at: `handOver` moves a thing from any of them to any
 * other, and the twelve sites that each did their own version of `take from here, add to there`
 * become twelve calls to one function that is tested once.
 *
 * The rule this is held to is the one `deeds.ts` is held to, and it is the same rule: **a thing
 * leaving one pack arrives in another.** Things are easier to lose than money — a `take` that
 * returns fewer than asked for, followed by a `give` of the full number, quietly mints goods — so
 * `handOver` moves what was actually taken and nothing else, and `goods.test.ts` counts both sides.
 */

/**
 * Somewhere things are kept.
 *
 * The mirror of `deeds.Holder`, and deliberately the same shape of interface: `take` says what it
 * actually got rather than assuming it got what it asked for, which is how a pack says "there were
 * only two of those" without throwing.
 */
export interface Pack {
  /** How many of this thing are in it. */
  count(id: string): number;
  /** Take up to this many out, and say how many actually came. */
  take(id: string, many: number): number;
  /** And put this many in. */
  give(id: string, many: number): void;
  /** Everything in it, for a menu that has to list it. Empty kinds are left out. */
  everything(): Array<[string, number]>;
}

/** Anything keeping its things in a `Map`, which is the hero's pack and most other places. */
export function packOf(items: Map<string, number>): Pack {
  return {
    count: (id) => items.get(id) ?? 0,
    take: (id, many) => {
      const had = items.get(id) ?? 0;
      const took = Math.max(0, Math.min(Math.floor(many), had));
      if (took >= had) items.delete(id); else items.set(id, had - took);
      return took;
    },
    give: (id, many) => {
      const more = Math.max(0, Math.floor(many));
      if (more > 0) items.set(id, (items.get(id) ?? 0) + more);
    },
    everything: () => [...items].filter(([, n]) => n > 0),
  };
}

/** A strongbox, a chest, a pack on the ground: things kept in a plain object. */
export function boxOf(items: Record<string, number>): Pack {
  return {
    count: (id) => items[id] ?? 0,
    take: (id, many) => {
      const had = items[id] ?? 0;
      const took = Math.max(0, Math.min(Math.floor(many), had));
      if (took >= had) delete items[id]; else items[id] = had - took;
      return took;
    },
    give: (id, many) => {
      const more = Math.max(0, Math.floor(many));
      if (more > 0) items[id] = (items[id] ?? 0) + more;
    },
    everything: () => Object.entries(items).filter(([, n]) => n > 0),
  };
}

/**
 * What somebody is carrying on their shoulder, which holds one kind of thing and no more.
 *
 * A hunter carries a deer. He does not carry a deer and four pelts and a loaf: `Entity.carrying`
 * is a single `{ id, count }` and that is the right shape for it, because what it is modelling is
 * a man with something over his shoulder walking to a market. Given a second kind of thing it
 * drops what it had, which is what would happen.
 */
export function carriedBy(who: { carrying: { id: string; count: number } | null }): Pack {
  return {
    count: (id) => (who.carrying?.id === id ? who.carrying.count : 0),
    take: (id, many) => {
      if (who.carrying?.id !== id) return 0;
      const took = Math.max(0, Math.min(Math.floor(many), who.carrying.count));
      who.carrying = took >= who.carrying.count ? null : { id, count: who.carrying.count - took };
      return took;
    },
    give: (id, many) => {
      const more = Math.max(0, Math.floor(many));
      if (more <= 0) return;
      who.carrying = who.carrying?.id === id
        ? { id, count: who.carrying.count + more }
        : { id, count: more };
    },
    everything: () => (who.carrying ? [[who.carrying.id, who.carrying.count]] : []),
  };
}

/**
 * A pack nothing comes out of and nothing stays in: the ground, the fire, the river.
 *
 * The `AWAY` of things, and here for the same reason. A loaf eaten, a log burnt and a hide cut up
 * into something else all leave the world, and every one of those has to say so rather than
 * happening as a `take` whose result nobody looked at.
 */
export const GONE: Pack = {
  count: () => 0,
  take: () => 0,
  give: () => {},
  everything: () => [],
};

/**
 * Move things from one pack to another, and say how many actually went.
 *
 * The one place a thing changes hands. What is taken is what is given — never what was asked for —
 * because the two differing by one is how a game quietly mints goods, and a pack that had two of
 * something when three were wanted is an ordinary Tuesday rather than an error.
 */
export function handOver(from: Pack, to: Pack, id: string, many = 1): number {
  const took = from.take(id, many);
  to.give(id, took);
  return took;
}

/**
 * Move everything one pack holds into another.
 *
 * "Take the lot" is a choice in three menus in this game and each of them wrote its own loop. The
 * list is taken before anything moves, because walking a pack while emptying it is how the last
 * one or two get left behind.
 */
export function handOverAll(from: Pack, to: Pack): number {
  let moved = 0;
  for (const [id, many] of from.everything()) moved += handOver(from, to, id, many);
  return moved;
}

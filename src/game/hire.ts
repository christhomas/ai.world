import { hashString, mulberry32, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { Person } from '../world/people';
import type { Village } from '../world/structures';

/**
 * Buying a sword arm, and agreeing what it costs before you set out.
 *
 * A village soldier already has a day: the gate in the morning, the square after noon, the inn
 * before dark. Coin buys that day off him. What he asks is settled at the outset, as a fee in the
 * hand, a cut of what the road turns up, or a little of each, and the agreement is held here by
 * the id of the person on the register rather than by the figure standing in the street, because
 * the figure is despawned the moment you walk two chunks away and the bargain is not.
 *
 * The price is rolled from the world seed and the man's own id, so two people in one world are
 * quoted the same figure by the same soldier without a word passing between them, in the same way
 * that they walk over the same hills. Where he lives moves it: a soldier in a one-street village
 * is giving up less than one drawing a wage in a market town, and asks accordingly.
 *
 * The decision worth explaining is that a cut is a cut of the coin and never of the goods. A third
 * of a fang is not a thing anybody can be handed, and a game that has to decide which of two
 * soldiers goes home with the gem is a game about arguments. So the pelts and the gems are yours,
 * the coin is divided, and the odd penny that will not divide stays in the purse that won it.
 *
 * Nothing here assumes the person paying is the hero. Every bargain names the side it is being
 * fought for, so that a soldier hired by somebody else on the same road is plainly somebody
 * else's soldier and not a second pair of hands for you.
 */

export const HIRE = {
  /** The trade that is for sale. Nobody else in a village has a day worth buying. */
  TRADE: 'soldier',
  /**
   * The tree a soldier follows while the bargain holds, from `behaviours/villagers.json`. Handing
   * over a tree name is the whole of what this module says to the behaviour layer: what a creature
   * does next is decided by its trade, so a hire is a change of trade and nothing more.
   */
  TREE: 'hired',
  /** The side a soldier is fighting for when there is nobody else in the world to fight for. */
  ALONE: 'you',
  /** Houses in the smallest place that has anybody living in it, and in the largest town there is. */
  POOREST: 1,
  RICHEST: 10,
  /**
   * How much of a village's standing is its roofs, its market and its pub. They come to one
   * between them, so the busiest town in the world scores exactly one and nothing scores more.
   */
  ROOFS: 0.7,
  MARKET: 0.2,
  PUB: 0.1,
  /** What a day's fighting costs in the poorest village in the world, in gold. */
  ASKING_LEAST: 15,
  /** And in the richest, where a soldier has a wage to give up and knows it. */
  ASKING_MOST: 60,
  /** How far one man's price strays from what his neighbours ask, either way. */
  HAGGLE: 0.25,
  /** The cut the cheapest soldier will work for instead of coin, and the dearest one's. */
  SHARE_LEAST: 0.15,
  SHARE_MOST: 0.35,
  /** How much of each a soldier takes when the bargain is part coin and part cut. */
  EACH_WAY: 0.5,
  /** Share of soldiers who will leave their post at all. The rest have a gate to watch. */
  WILLING: 0.6,
  /**
   * How many sword arms anybody can have behind them at once. Two of the dearest still leaves
   * most of the takings with whoever won them, which is the point of a limit rather than a rule
   * about crowds: past this a purse would pay out more than came into it.
   */
  MOST: 2,
  /** How far off a hired soldier can be and still be yours, in tiles. Past it he is only a villager. */
  EARSHOT: 40,
  /**
   * Seconds between putting the hired back onto their tree. A villager can be despawned and
   * spawned again between one and the next, and a man who has forgotten he is bought for half a
   * second is nobody's problem; doing it every frame to save that half second would be.
   */
  MUSTER_EVERY: 0.5,
  /**
   * How many days a bargain runs for before it has to be struck again.
   *
   * A hire was for ever. You paid a man once and he walked with you until a bear got him or you
   * told him to go home, which made the fee a one-off purchase of a person rather than a wage — and
   * a wage is what it is. What a term buys is that the money keeps mattering: a sword arm is an
   * expense you carry rather than a thing you own, and a long campaign costs more than a short one.
   *
   * Six days, against a village day that turns over in a few minutes of play. Long enough to be
   * worth striking — a bargain that ran out before you reached the next valley would be a fee you
   * resent — and short enough that a season of fighting means going back to the table, which is
   * the whole point.
   */
  TERM: 6,
  /**
   * How long before it runs out that he starts saying so.
   *
   * A day and a half. He has to bring it up *before* the morning he walks away, or the first a
   * player knows about the arrangement ending is an empty road behind them — which reads as a bug
   * however correct it is. This is the window where talking to him offers an extension.
   */
  ASKS_AT: 1.5,
  /**
   * What keeping him on costs, against what taking him on cost.
   *
   * The same again and a little, because he knows you want him and because the alternative is
   * finding somebody else in a village that may not have anybody. It must never be *cheaper* than
   * the first bargain or the best way to hire a man for a season would be to hire him for a day
   * eight times over.
   */
  AGAIN: 1.15,
} as const;

/**
 * What a man in your pay can be told to do.
 *
 * Deliberately three, and deliberately not a list of everything a body can do. An order is not a
 * remote control: the whole value of a hired sword is that he has a tree of his own and uses it, so
 * what these change is *which* tree branch he takes rather than each step he makes. Told to hold he
 * still defends himself; told to fight he still walks round a boulder rather than into it.
 *
 * `follow` is the standing arrangement and the absence of an order — what he does if you never say
 * anything, which is what he did before there were orders at all.
 */
export const ORDERS = {
  /** At your shoulder, and into whatever comes for either of you. The default. */
  FOLLOW: 'follow',
  /** Stand here. He still fights what comes to him; he will not walk after you. */
  HOLD: 'hold',
  /** Go for what is dangerous rather than waiting for it to go for somebody. */
  FIGHT: 'fight',
} as const;

export type Order = typeof ORDERS[keyof typeof ORDERS];

/** One way of settling an asking price: coin in the hand, a cut of what is won, or both. */
export interface Terms {
  /** Gold handed over before a step is taken. */
  fee: number;
  /** Share of the coin won while he is with you, nought to one. */
  share: number;
}

/** What one soldier will come for, and the ways he will take it. */
export interface Quote {
  /** His id on the register, which is the one thing about him that survives a despawn. */
  who: string;
  name: string;
  /** What he is worth for a day, before it is split between coin and cut. */
  asking: number;
  /** The ways of settling that asking price, most in the hand first. */
  terms: Terms[];
}

/** An agreement that has been shaken on. */
export interface Bargain extends Terms {
  who: string;
  name: string;
  /**
   * What he has been told to do, or empty for the standing arrangement.
   *
   * On the contract rather than on the body, because the body is despawned the moment you walk far
   * enough off and built again later: an order kept on the entity would be forgotten by walking
   * round a corner. This is what remembers, and `muster` presses it back onto whoever is standing
   * there now — the same way it does his trade, and for exactly the same reason.
   */
  told?: Order;
  /**
   * The world day it runs out on.
   *
   * What turns a hire from a purchase into a contract, and the thing the whole of the rest of this
   * file hangs off. A bargain with no end was a man bought outright: the fee was paid once and he
   * followed you for the rest of his life, which made a sword arm a possession rather than a cost
   * you carry. With a day on it he is an expense, he asks to be kept on, and he goes home when the
   * answer is no.
   */
  until: number;
  /**
   * Whose fight he is in: your own id in a shared world, and there is only you in a solitary one.
   * Asked rather than assumed, because a road wide enough for two players is wide enough for two
   * people to have hired somebody.
   */
  side: string;
}

/** One soldier's cut of one lot of takings. */
export interface Cut {
  who: string;
  name: string;
  gold: number;
}

/** What a lot of takings came to once everybody behind you had been paid. */
export interface Payout {
  cuts: Cut[];
  /** What left the purse. Never more than the coin that came into it. */
  paid: number;
}

/**
 * How well off a village is: nought for the smallest place with anybody in it, one for the
 * busiest town there is. Read off what the place actually has rather than declared, for the
 * reason its trades are: a village that grows a market is a village where wages went up.
 */
export function meansOf(village: Pick<Village, 'houses' | 'stalls' | 'pub'>): number {
  const spread = HIRE.RICHEST - HIRE.POOREST;
  const roofs = Math.max(0, Math.min(1, (village.houses.length - HIRE.POOREST) / spread));
  return roofs * HIRE.ROOFS
    + (village.stalls.length > 0 ? HIRE.MARKET : 0)
    + (village.pub ? HIRE.PUB : 0);
}

/** A stream of one man's own, so his price never moves and never follows anybody else's. */
function streamFor(seed: number, who: string): Rng {
  return mulberry32(derive(seed, SALT.HIRE) ^ hashString(who));
}

/**
 * The cut a soldier takes instead of coin, which follows what he was asking for it. Derived
 * rather than rolled again: a man who thinks himself worth sixty gold thinks himself worth a
 * larger share of the takings as well, and two figures rolled apart would sooner or later
 * disagree about him.
 */
function shareFor(asking: number): number {
  const spread = HIRE.ASKING_MOST - HIRE.ASKING_LEAST;
  const dear = Math.max(0, Math.min(1, (asking - HIRE.ASKING_LEAST) / spread));
  return HIRE.SHARE_LEAST + dear * (HIRE.SHARE_MOST - HIRE.SHARE_LEAST);
}

/** The three ways of settling one asking price, most in the hand first. */
function termsFor(asking: number): Terms[] {
  const cut = shareFor(asking);
  return [
    { fee: asking, share: 0 },
    { fee: Math.round(asking * HIRE.EACH_WAY), share: cut * HIRE.EACH_WAY },
    { fee: 0, share: cut },
  ];
}

/**
 * What this person would come for, or null for anybody who will not come at all: they have no
 * sword, or they are one of the ones who will not leave their gate for money. Which is which is
 * rolled from the seed and their id, so the answer holds for everybody in the world and holds all
 * week, and the two lines a soldier already has to say fall either side of it.
 */
export function quoteFor(
  seed: number,
  person: Pick<Person, 'id' | 'name' | 'trade'>,
  village: Pick<Village, 'houses' | 'stalls' | 'pub'>,
): Quote | null {
  if (person.trade !== HIRE.TRADE) return null;
  const roll = streamFor(seed, person.id);
  if (roll() >= HIRE.WILLING) return null;

  const going = HIRE.ASKING_LEAST + meansOf(village) * (HIRE.ASKING_MOST - HIRE.ASKING_LEAST);
  // one man is dearer than the man at the next gate: a going rate is not a person
  const asking = Math.max(1, Math.round(going * (1 + (roll() - 0.5) * 2 * HIRE.HAGGLE)));
  return { who: person.id, name: person.name, asking, terms: termsFor(asking) };
}

/** How a set of terms reads in a line, which is the only form of them anybody is shown. */
export function wordsFor(terms: Terms): string {
  const cut = `${Math.round(terms.share * 100)} in the hundred of what we take`;
  if (terms.share <= 0) return `${terms.fee} gold, all of it now`;
  if (terms.fee <= 0) return `nothing now, and ${cut}`;
  return `${terms.fee} gold now, and ${cut}`;
}

/**
 * The soldiers walking with somebody, and what was agreed with each.
 *
 * Shaped after the party: a roster held by id that answers questions about who is with whom, and
 * grants no powers of its own. What it knows is asked for by side rather than assumed, so the
 * same object holds your two swords and the three somebody else is paying for.
 */
export class Hires {
  private readonly agreed = new Map<string, Bargain>();

  /** Every bargain there is, for whoever has to put them all back on the right tree. */
  get all(): Bargain[] { return [...this.agreed.values()]; }

  /** Is this person already bought? Nobody can be bought twice, by you or by anybody else. */
  has(who: string): boolean { return this.agreed.has(who); }

  /** Whose fight this person is in, or empty for anybody who is nobody's. */
  fightingFor(who: string): string { return this.agreed.get(who)?.side ?? ''; }

  /** The ones walking with one side. */
  roster(side: string): Bargain[] { return this.all.filter((b) => b.side === side); }

  /**
   * Shake on it, and hand back what was agreed so the fee can be counted out.
   *
   * Null when the bargain cannot be made and nothing whatever has changed: the purse will not
   * cover the fee, the man is already somebody's, or there are as many swords behind this side as
   * anybody will follow. A refusal costs nothing, because a refused bargain is not a bargain.
   */
  strike(quote: Quote, terms: Terms, purse: number, side: string, day = 0): Bargain | null {
    if (this.agreed.has(quote.who)) return null;
    if (terms.fee > purse) return null;
    if (this.roster(side).length >= HIRE.MOST) return null;

    const bargain: Bargain = {
      who: quote.who, name: quote.name, fee: terms.fee, share: terms.share, side,
      until: Math.floor(day) + HIRE.TERM,
    };
    this.agreed.set(quote.who, bargain);
    return bargain;
  }

  /**
   * Whether a bargain still holds on a given day, and whether it is nearly up.
   *
   * Two questions rather than a state on the bargain, because the day is the only thing that moves
   * and the answer is a subtraction. A contract that kept a `state` field would be a contract that
   * has to be ticked, and a thing that has to be ticked is a thing that is wrong whenever nobody
   * ticked it — which for a saved game reopened after a fortnight is always.
   */
  holds(who: string, day: number): boolean {
    const bargain = this.agreed.get(who);
    return bargain !== undefined && day < bargain.until;
  }

  /** Is the end of it close enough that he would bring it up? */
  nearlyUp(who: string, day: number): boolean {
    const bargain = this.agreed.get(who);
    return bargain !== undefined && day >= bargain.until - HIRE.ASKS_AT;
  }

  /** What he asks to be kept on for another term. Dearer than the first, and never cheaper. */
  askingAgain(bargain: Bargain): number {
    return Math.max(1, Math.round(bargain.fee * HIRE.AGAIN));
  }

  /**
   * Keep him on: the same terms, a fresh term, starting from today.
   *
   * From today rather than from the day it ran out, so a bargain renewed a week late is a week
   * from now and not a day and a half of it already gone. Somebody whose contract has already
   * lapsed is not here to renew with — `part` has taken him off the books and he is walking home.
   */
  extend(who: string, day: number): Bargain | null {
    const bargain = this.agreed.get(who);
    if (!bargain) return null;
    bargain.until = Math.floor(day) + HIRE.TERM;
    return bargain;
  }

  /**
   * Everybody whose day has come, taken off the books in the same breath.
   *
   * Handed back rather than merely dropped, because somebody has to be told: a man who leaves
   * without a word is indistinguishable from a man who has fallen down a hole, and the difference
   * matters to a player who is about to walk into a fight expecting two swords.
   */
  ranOut(day: number): Bargain[] {
    const done = this.all.filter((b) => day >= b.until);
    for (const bargain of done) this.agreed.delete(bargain.who);
    return done;
  }

  /**
   * The end of it, however it came: you paid him off, or a bear did. There is one way out on
   * purpose, because the money says the same thing either way: what was handed over up front is
   * gone, and nothing further is owed on anything won after this moment.
   */
  part(who: string): Bargain | null {
    const bargain = this.agreed.get(who) ?? null;
    this.agreed.delete(who);
    return bargain;
  }

  /**
   * Divide a lot of takings. Everybody on this side takes their share of the coin, rounded down,
   * so what leaves the purse is never more than what came into it and the odd penny stays with
   * whoever won it. Goods are not divided: see the note at the top of the file.
   */
  divide(gold: number, side: string): Payout {
    const cuts: Cut[] = [];
    let paid = 0;
    for (const bargain of this.roster(side)) {
      const cut = Math.floor(Math.max(0, gold) * bargain.share);
      if (cut <= 0) continue;                    // a fee-only man has already been paid
      cuts.push({ who: bargain.who, name: bargain.name, gold: cut });
      paid += cut;
    }
    return { cuts, paid };
  }

  /**
   * The behaviour tree this person should be following: a hire's while the bargain holds, and
   * otherwise the one their own trade gives them. This is the whole of what the behaviour layer
   * is told, and it is told it by whoever owns the figure in the street rather than by this.
   */
  follows(who: string, trade: string): string {
    return this.agreed.has(who) ? HIRE.TREE : trade;
  }

  /**
   * Tell somebody in your pay what to do.
   *
   * Nothing happens to anybody who is not yours, which is the whole of the check that matters: a
   * man is taking instructions because he is being paid, and the moment the contract ends he is
   * taking none. `follow` clears the order rather than storing it, so the standing arrangement is
   * the absence of an instruction and there is one state for it rather than two.
   */
  tell(who: string, order: Order): boolean {
    const bargain = this.agreed.get(who);
    if (!bargain) return false;
    if (order === ORDERS.FOLLOW) delete bargain.told;
    else bargain.told = order;
    return true;
  }

  /** What this one has been told, or the standing arrangement. */
  toldTo(who: string): Order {
    return this.agreed.get(who)?.told ?? ORDERS.FOLLOW;
  }

  /** How the company reads in a line: "Greta Vos at your shoulder". */
  describe(side: string): string {
    const names = this.roster(side).map((b) => b.name);
    if (names.length === 0) return 'nobody at your shoulder';
    if (names.length === 1) return `${names[0]} at your shoulder`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} at your shoulder`;
  }
}

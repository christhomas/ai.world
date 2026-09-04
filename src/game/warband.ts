import { LIMITS, clamp } from '../../server/protocol';
import { COMBAT } from './combat';
import { HIRE, type Hires } from './hire';
import type { GameState } from './state';

/**
 * A fight with sides, where the men one side paid for stand in front of him.
 *
 * A duel is one sword against one sword, and between a hero in chain mail and a hero in a tunic it
 * is not a fight at all: it is over in a second and a quarter, and the man in the tunic has no
 * answer to it but staying out of the way. This is the answer. Coin already buys a sword arm in
 * every village square and `hire.ts` already knows whose arm is whose, so a contest built on that
 * lets somebody who cannot win alone bring people who agreed to be there and make a fight of it.
 *
 * Nothing whatever is at stake but the bragging. A side fights out of a pool of its own, the way a
 * duel does, so gear, gold and hearts are exactly where they were when it is over. That is on
 * purpose, and so is the rest of it: coin that buys an ambush on a stranger buys a game nobody
 * weaker wants to log into. Both sides must have asked or been asked before either can begin, a
 * blow may only be aimed at the one player who agreed, and every hired man is checked against
 * `fightingFor` at the moment he swings, which is also how two players who have both hired on the
 * same road keep their men straight.
 *
 * The decision worth explaining is the screen: a blow aimed at a man who still has swords in front
 * of him lands on the swords. Without it hired men are only extra blows, and extra blows are worth
 * least to the person who needs them most, because a village soldier's three against chain mail is
 * turned aside down to one: six of them cannot save a hero in a tunic, and the reckoning below
 * says so in seconds. With the screen the same two men double how long he stands, which is what
 * being outmatched actually needs to buy. It costs the stronger side nothing he did not agree to,
 * since he may bring his own two and they screen him in exactly the same way.
 */

export const WARBAND = {
  /**
   * What a hired man is worth in a fight: how hard he hits, how often, and what he has in him.
   * The first two are the `hired` tree's own figures in `behaviours/villagers.json` and the third
   * is the `villager` kind's in `entities/animals.ts`. They are written out rather than read
   * because a reckoning has to answer before anybody has agreed to anything and a behaviour tree
   * is JSON loaded at run time; a test holds all three of them to their sources.
   */
  SWORD_BLOW: 3,
  SWORD_EVERY: 1.1,
  SWORD_HEARTS: 6,
  /** Armour: every this many points turns one off a blow, which is the rule a hero's hide follows. */
  PLATE: 2,
  /** What gets through however much iron is in the way, because nobody is ever untouchable. */
  LEAST: 1,
  /** How fine the reckoning's clock is, in seconds. Finer than any blow either side can land. */
  TICK: 0.01,
  /** How long it watches two people who cannot hurt each other before calling it neither's. */
  LONGEST: 120,
} as const;

/** One hired man as he stands in a fight: what is left of him, and nothing about his wages. */
export interface Sword {
  who: string;
  name: string;
  hearts: number;
}

/** One side of a fight: the player paying for it, and the men in front of him. */
export interface Side {
  /** The player's own id, which is the side `Hires` already holds his bargains under. */
  who: string;
  name: string;
  /** Hearts in this fight only, never the hero's own. */
  hearts: number;
  full: number;
  /**
   * Armour worn, as `GameState.defence` counts it. Nought for the far side: what somebody else is
   * wearing is their own client's business, so our tally of them is a readout and not a ruling.
   */
  guard: number;
  /** The men he brought, in the order they step in front of him. */
  swords: Sword[];
}

/** Where a blow ended up, for whoever has to say so out loud. */
export interface Landing {
  /** Who took it: a hired man's id, or the player's own when there was nobody left in front. */
  at: string;
  name: string;
  sword: boolean;
  /** Whether that blow put him out of the fight. */
  felled: boolean;
  /** Whether that was the end of the side, which only a player can be. */
  over: boolean;
}

/** A blow one side landed, as it crosses the wire: how hard, and whether a hired man threw it. */
export interface Swing {
  damage: number;
  sword: boolean;
}

/** What a blow comes to once armour has had its say, by the rule a hero's own hide follows. */
export function softened(damage: number, guard: number): number {
  return Math.max(WARBAND.LEAST, damage - Math.floor(guard / WARBAND.PLATE));
}

/** A body of hired men, all alike, since one is worth exactly what the next one is. */
function men(count: number): Sword[] {
  const many = Math.max(0, Math.floor(Number(count)) || 0);
  return Array.from({ length: many }, (_, n) => ({ who: `sword-${n}`, name: 'a hired sword', hearts: WARBAND.SWORD_HEARTS }));
}

/**
 * The men one side has already paid for, as they stand at the start of a fight. Read off the
 * bargains rather than counted anywhere else, so a man is in this fight for the same reason he is
 * anybody's at all.
 */
export function swordsOf(hires: Hires, side: string): Sword[] {
  return hires.roster(side).map((b) => ({ who: b.who, name: b.name, hearts: WARBAND.SWORD_HEARTS }));
}

/**
 * The far side's men, as many as they say they brought. A count and never a roster: who is in
 * somebody else's pay is their client's business, their names would be a message per man, and the
 * only thing ever done with the number here is drawing it.
 */
export function strangers(count: number): Sword[] {
  return men(cleanSwords(count));
}

/** One side, ready to fight, out of a pool that is nobody's real hearts. */
export function sideOf(
  fighter: { who: string; name: string; hearts: number; guard: number },
  swords: Sword[],
): Side {
  return {
    who: fighter.who, name: fighter.name,
    hearts: fighter.hearts, full: fighter.hearts, guard: fighter.guard, swords,
  };
}

/**
 * Where a blow arriving at a side actually lands. The men step in front in the order they were
 * hired, and only when the last of them is down does anything reach the player. What is aimed at a
 * hired man arrives whole, because he wears no armour, exactly as a swing at any villager does.
 */
function land(side: Side, damage: number): Landing {
  const hit = Math.max(0, Math.floor(damage));
  const sword = side.swords.find((s) => s.hearts > 0);
  if (sword) {
    sword.hearts = Math.max(0, sword.hearts - hit);
    return { at: sword.who, name: sword.name, sword: true, felled: sword.hearts === 0, over: false };
  }
  side.hearts = Math.max(0, side.hearts - softened(hit, side.guard));
  const done = side.hearts === 0;
  return { at: side.who, name: side.name, sword: false, felled: done, over: done };
}

/** A fighter as the reckoning counts him: what he swings, what he wears, and who is with him. */
export interface Fighter {
  /** Damage one swing deals, as `GameState.attack` gives it. */
  attack: number;
  /** Armour worn, as `GameState.defence` gives it. */
  guard: number;
  /** Hearts he fights out of, as `GameState.maxHpTotal` gives them. */
  hearts: number;
  /**
   * Men at his shoulder. Never more than `HIRE.MOST` in a fight anybody can actually have, but
   * counted however high it is asked, so that "how many would it take" has an answer.
   */
  swords: number;
}

/** What a fight between two of them would come to, before either has agreed to have one. */
export interface Reckoning {
  /** Seconds we would last, and seconds they would. */
  ours: number;
  theirs: number;
  win: boolean;
  /** Whether we would win it with nobody at our shoulder, so what the coin bought is plain. */
  alone: boolean;
  /**
   * How much longer the men keep us on our feet than going alone would, and 1 when they change
   * nothing. Measured as the length of the fight, because a fight ends when somebody goes down and
   * the one still standing has been on his feet for exactly that long.
   */
  bought: number;
  /** How it reads in a line, for somebody deciding whether to say yes. */
  words: string;
}

/** One side as the reckoning has to hold it: the side itself, and when its next blow falls due. */
interface Bout {
  side: Side;
  attack: number;
  swing: number;
  bite: number;
}

/**
 * Watch a fight to its end and say when each side went down, in seconds, nought for anybody still
 * standing at the end of it. Nothing here is rolled: both sides swing on a fixed clock, so the
 * same two fighters always come to the same answer and it can be shown to somebody in a village
 * square before they agree to anything. The clock counts in ticks rather than in seconds so that
 * adding a hundredth of a second twelve thousand times cannot drift a blow off its cadence.
 */
function watch(us: Fighter, them: Fighter): [number, number] {
  const bouts: Bout[] = [us, them].map((f, n) => ({
    side: sideOf({ who: `side-${n}`, name: '', hearts: f.hearts, guard: f.guard }, men(f.swords)),
    attack: f.attack, swing: 0, bite: 0,
  }));
  const swingEvery = Math.round(COMBAT.COOLDOWN / WARBAND.TICK);
  const biteEvery = Math.round(WARBAND.SWORD_EVERY / WARBAND.TICK);
  const fell: [number, number] = [0, 0];

  for (let tick = 1; tick <= Math.round(WARBAND.LONGEST / WARBAND.TICK); tick++) {
    for (let n = 0; n < 2; n++) {
      const mine = bouts[n], theirs = bouts[1 - n];
      if (mine.side.hearts <= 0) continue;          // a man on the ground throws nothing
      mine.swing++;
      mine.bite++;
      if (mine.swing >= swingEvery) { mine.swing = 0; land(theirs.side, mine.attack); }
      if (mine.bite < biteEvery) continue;
      mine.bite = 0;
      for (const sword of mine.side.swords) if (sword.hearts > 0) land(theirs.side, WARBAND.SWORD_BLOW);
    }
    for (let n = 0; n < 2; n++) if (fell[n] === 0 && bouts[n].side.hearts <= 0) fell[n] = tick * WARBAND.TICK;
    if (fell[0] > 0 || fell[1] > 0) break;
  }
  return fell;
}

/** How long a side stood, with anybody still on their feet at the end counted as standing yet. */
function stood(fell: number): number {
  return fell > 0 ? fell : WARBAND.LONGEST;
}

/**
 * What a fight would come to, and how much of that is the men. Run twice on purpose: once as the
 * fight would be and once with nobody at your shoulder, because "you would lose" and "you would
 * lose in three times the time" are different answers to whether the money was well spent.
 */
export function reckon(us: Fighter, them: Fighter): Reckoning {
  const fought = watch(us, them);
  const ours = stood(fought[0]), theirs = stood(fought[1]);
  const unaided = watch({ ...us, swords: 0 }, them);
  const lasted = Math.min(ours, theirs);
  const lastedAlone = Math.min(stood(unaided[0]), stood(unaided[1]));
  const win = theirs < ours;
  const alone = stood(unaided[1]) < stood(unaided[0]);
  const bought = lastedAlone > 0 ? lasted / lastedAlone : 1;
  const held = bought > 1.05
    ? ` Your swords keep you on your feet ${bought.toFixed(1)} times as long as going alone would.`
    : '';
  return {
    ours, theirs, win, alone, bought,
    words: !win ? `He would put you down in about ${ours.toFixed(1)} seconds.${held}`
      : alone ? `You would have him in about ${theirs.toFixed(1)} seconds, swords or no swords.`
      : `Your swords are the difference: he goes down in about ${theirs.toFixed(1)} seconds.`,
  };
}

/** The hero as the reckoning counts him, which is the three numbers his gear comes to. */
export function fighterOf(
  state: Pick<GameState, 'attack' | 'defence' | 'maxHpTotal'>,
  swords: number,
): Fighter {
  return { attack: state.attack, guard: state.defence, hearts: state.maxHpTotal, swords };
}

/**
 * Guard a muster off the wire. Nobody may claim more men than anybody is allowed to hire, and
 * anything that is not a number is nobody at all.
 */
export function cleanSwords(count: unknown): number {
  const many = Math.floor(Number(count));
  if (!Number.isFinite(many)) return 0;
  return clamp(many, 0, HIRE.MOST);
}

/**
 * Guard a blow off the wire: no harder than anybody may claim to hit, and no softer than a blow.
 * A blow of nothing is turned away rather than clamped up, because the hide rule would let one
 * through for a heart all the same, and a stream of them is a way of winning without swinging.
 */
export function cleanSwing(swing: unknown): Swing | null {
  const sent = swing as Partial<Swing> | null | undefined;
  const damage = Math.floor(Number(sent?.damage));
  if (!Number.isFinite(damage) || damage < WARBAND.LEAST) return null;
  return { damage: clamp(damage, WARBAND.LEAST, LIMITS.DAMAGE), sword: sent?.sword === true };
}

/**
 * A fight with sides, as one client sees its own half of it.
 *
 * Shaped after the duel: this client rules on what arrives at its own side and reports what it
 * lands, and the far side does the same, so no two clients can ever disagree about who is dead.
 * What this adds is the men, and the one rule that keeps them honest: nobody swings at anybody who
 * has not agreed to be swung at.
 */
export class Warband {
  /** Askings outstanding, either way round, held as a set for the reason the server holds one. */
  private readonly askings = new Set<string>();
  private us: Side | null = null;
  private them: Side | null = null;

  get active(): boolean { return this.us !== null && this.them !== null; }
  get opponent(): string { return this.them?.who ?? ''; }
  get opponentName(): string { return this.them?.name ?? ''; }

  /** How many of our men are still on their feet, which is the one number the far side is told. */
  get muster(): number { return this.us ? this.us.swords.filter((s) => s.hearts > 0).length : 0; }
  /** And how many of theirs are, as far as they have told us. */
  get theirMuster(): number { return this.them ? this.them.swords.filter((s) => s.hearts > 0).length : 0; }

  /** Put it to somebody. An asking is not a fight: nothing has begun until they answer. */
  ask(them: string): void { this.askings.add(them); }

  /** Hear it put to us, which is the same standing offer seen from the other end. */
  asked(them: string): void { this.askings.add(them); }

  /** Whether an asking is outstanding with this person, either way round. */
  asking(them: string): boolean { return this.askings.has(them); }

  /** An asking that came to nothing: turned down, thought better of, or the person has gone. */
  forget(them: string): void { this.askings.delete(them); }

  /**
   * Step into it, and hand back whether we did.
   *
   * Refused unless an asking is outstanding with this very person, which is what stops a client
   * being told it is in a fight it never agreed to: somewhere on this machine, somebody said yes.
   * Every other asking lapses on the spot, because a man in a fight is in one fight.
   */
  begin(us: Side, them: Side): boolean {
    if (this.active || !this.askings.has(them.who)) return false;
    this.askings.clear();
    this.us = us;
    this.them = them;
    return true;
  }

  /** A blow the far side says it landed. Where it goes is ours to say, because the side is ours. */
  struck(swing: Swing): Landing | null {
    return this.us ? land(this.us, swing.damage) : null;
  }

  /**
   * A blow of our own, so the readout moves before their word of it reaches us. Their armour is
   * nought in our copy of them, so this runs a little ahead of the truth; their client keeps the
   * pool that decides the fight, exactly as ours keeps the one that decides ours.
   */
  landed(swing: Swing): Landing | null {
    return this.them ? land(this.them, swing.damage) : null;
  }

  /** Take the far side's word for how many of them are still up, since only they can know. */
  theirs(count: number): void {
    if (this.them) this.them.swords = strangers(count);
  }

  /**
   * One of our men is out of it for a reason the fight had nothing to do with: a bear had him, or
   * the bargain ended and he turned for home. Either way he stops standing in front of anybody.
   */
  fallen(who: string): boolean {
    const sword = this.us?.swords.find((s) => s.who === who && s.hearts > 0);
    if (!sword) return false;
    sword.hearts = 0;
    return true;
  }

  /**
   * Whether this blow may be thrown at all, which is the whole of what keeps coin from buying an
   * ambush. A fight has to be running, the person aimed at has to be the one who agreed to it, and
   * a hired man has to be in the pay of this side and still standing in this fight. Whose he is
   * comes from the bargain and nowhere else, so a man paid off a moment ago is nobody's sword arm,
   * and a man hired by the other player is asking on his employer's behalf and is turned down.
   */
  mayStrike(who: string, at: string, hires: Hires): boolean {
    if (!this.us || !this.them || at !== this.them.who) return false;
    if (who === this.us.who) return true;
    return hires.fightingFor(who) === this.us.who
      && this.us.swords.some((s) => s.who === who && s.hearts > 0);
  }

  /**
   * Over, however it came: won, lost, or called off. Both sides are put down together, which is
   * also how a hired man learns to stop: with no fight there is nobody he may strike.
   */
  end(): void {
    this.askings.clear();
    this.us = null;
    this.them = null;
  }

  /** The fight as one line, for the corner of the screen. */
  readout(): string {
    if (!this.us || !this.them) return '';
    const swords = (n: number) => `${n} sword${n === 1 ? '' : 's'}`;
    return `Fight with ${this.them.name} — you ${this.us.hearts}/${this.us.full} and ${swords(this.muster)},`
      + ` them ${this.them.hearts}/${this.them.full} and ${swords(this.theirMuster)}`;
  }
}

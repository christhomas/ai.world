/**
 * What a village holds against somebody.
 *
 * The good and evil scale in standing.ts is what the whole country thinks of you, and it is far
 * too blunt for this. Killing a man's cow should not put you level with a murderer, and walking
 * two villages down the road should not make it stop having happened. A grudge is local, and it
 * fades, which is what a village bearing one is actually like.
 *
 * The decision worth stating is that a grudge is held by the PLACE rather than by whoever owned
 * the animal. A village here is twenty people who all know each other and carry each other's news
 * in their heads, so word travelling is the default rather than a feature: you did it to one of
 * them, so you did it to all of them, and the shopkeeper who never saw it charges you for it.
 */

export const GRUDGE = {
  /** What one beast costs, on a scale where a hundred is being run out of the place. */
  A_BEAST: 30,
  /** How much of a grudge a village lets go of each day. A month of staying away settles it. */
  FORGIVEN_A_DAY: 1.2,
  /** Past this, the shops still serve you but they take their opinion out of your purse. */
  SOURED: 20,
  /** And past this they would rather you went somewhere else. */
  UNWELCOME: 65,
  /** The most a village will ever add to a price, as a share, at the very worst of it. */
  MARKUP: 0.6,
  /** Nobody holds more of a grudge than this: past being unwelcome there is nowhere further. */
  MOST: 100,
  /** How many of a village carry the news themselves. The rest hear it from these. */
  WORD_REACHES: 4,
} as const;

/** How a village is disposed towards somebody, in the only terms anybody needs. */
export type Regard = 'fine' | 'soured' | 'unwelcome';

/** What one village thinks, and when it last thought about it. */
export interface Held {
  /** How much is held against them. */
  weight: number;
  /** The day it was last added to, so it can fade from there. */
  day: number;
}

/** How a village feels about somebody, from what it is holding. */
export function regardOf(weight: number): Regard {
  if (weight >= GRUDGE.UNWELCOME) return 'unwelcome';
  if (weight >= GRUDGE.SOURED) return 'soured';
  return 'fine';
}

/** What somebody who lives there would say about it, which is the only form the player sees. */
export function saidOf(regard: Regard, village: string): string {
  switch (regard) {
    case 'fine': return `You are nothing in particular to ${village}.`;
    case 'soured': return `${village} has not forgotten what you did to its animals.`;
    case 'unwelcome': return `You are not welcome in ${village}, and everybody in it knows why.`;
  }
}

/** What a shopkeeper adds for the look of you, as a share of the price. */
export function markupFor(weight: number): number {
  if (weight < GRUDGE.SOURED) return 0;
  const past = (weight - GRUDGE.SOURED) / (GRUDGE.MOST - GRUDGE.SOURED);
  return Math.min(GRUDGE.MARKUP, past * GRUDGE.MARKUP);
}

/**
 * Every village's opinion of one person.
 *
 * Fading is worked out when it is asked for rather than ticked, because a grudge nobody has been
 * near for a fortnight has still been fading all that while, and a village the player never
 * visits should not need a heartbeat to forgive them.
 */
export class Grudges {
  private readonly held = new Map<string, Held>();

  constructor(saved?: Record<string, Held>) {
    for (const [village, what] of Object.entries(saved ?? {})) this.held.set(village, { ...what });
  }

  /**
   * Something of theirs was killed, or something of theirs went unpaid for. Returns what the
   * village now holds.
   *
   * `by` is written out as a number rather than left to be inferred from the default, because the
   * default is a `as const` literal and inference made this take only the number thirty — which
   * silently meant a beast was the only thing anybody could ever be blamed for.
   */
  slighted(village: string, day: number, by: number = GRUDGE.A_BEAST): number {
    const now = this.weight(village, day);
    const after = Math.min(GRUDGE.MOST, now + by);
    this.held.set(village, { weight: after, day });
    return after;
  }

  /** What this village is holding today, with the fading already taken off. */
  weight(village: string, day: number): number {
    const held = this.held.get(village);
    if (!held) return 0;
    const faded = held.weight - Math.max(0, day - held.day) * GRUDGE.FORGIVEN_A_DAY;
    return Math.max(0, faded);
  }

  /** How the village is disposed towards them today. */
  regard(village: string, day: number): Regard {
    return regardOf(this.weight(village, day));
  }

  /** What a shopkeeper here adds to a price, as a share of it. */
  markup(village: string, day: number): number {
    return markupFor(this.weight(village, day));
  }

  /** Every village currently holding something, for a save or a readout. */
  save(): Record<string, Held> {
    const out: Record<string, Held> = {};
    for (const [village, held] of this.held) out[village] = { ...held };
    return out;
  }
}

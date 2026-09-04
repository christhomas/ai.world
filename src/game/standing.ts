/**
 * What the country makes of you, and the law that answers it.
 *
 * Everything the player does to the people of a village lands on one number, from as well as
 * anybody is thought of down to as badly. Killing a farmer drags it one way; pulling a wolf off
 * one, or carrying the wounded to the surgery, drags it back. Past the bottom of it the
 * constables stop watching the road and start watching you.
 *
 * The number is never shown. A player told they are at -74 has been told nothing: they want to
 * know they are not welcome here, which is a thing you can feel walking into a square. So the
 * scale reads out in bands of words, and the law's own line is the floor of a band rather than a
 * threshold hidden somewhere inside one. The moment the words say "wanted for murder" is the
 * moment somebody in a helmet leaves their post, so the game never has to explain itself twice.
 *
 * It knows nothing about creatures, villages or swings, on purpose. Whoever saw the deed decides
 * what kind of deed it was; this only keeps the score and says what the score has come to.
 */

export const LAW = {
  /** As well as anybody is ever thought of. */
  BEST: 100,
  /** And as badly. Neither end can be passed, so no spree runs up a debt that cannot be worked off. */
  WORST: -100,
  /** What killing somebody's neighbour costs. Two of them and the village has had enough of you. */
  MURDER: -40,
  /**
   * What pulling an animal off somebody is worth. Deliberately far short of a murder: a country
   * where three dead wolves buy a dead farmer is a country with a price list rather than a law.
   */
  RESCUE: 12,
  /** And carrying the wounded to the doctor, which is worth more because it costs you the walk. */
  MERCY: 20,
  /**
   * The lowest standing a village will put up with. Below this the constables come for you, and
   * the words the player is reading change to say so.
   */
  WANTED_AT: -70,
  /** The shortest anybody is held, in hours of the game's clock. */
  CELL_LEAST: 4,
  /** And the longest, for somebody as bad as the scale goes. */
  CELL_MOST: 14,
} as const;

/** Something you did that the country has an opinion about. */
export type Deed = 'murder' | 'rescue' | 'mercy';

/** What each deed moves the scale by. */
const WEIGHT: Record<Deed, number> = {
  murder: LAW.MURDER,
  rescue: LAW.RESCUE,
  mercy: LAW.MERCY,
};

/**
 * The scale in words, best first. A band runs from its own floor up to the next one, so what the
 * player sees changes when they cross a boundary rather than ticking along with every deed.
 */
const BANDS: ReadonlyArray<{ from: number; words: string }> = [
  { from: 60, words: 'well thought of' },
  { from: 25, words: 'a good neighbour' },
  { from: -10, words: 'nobody in particular' },
  { from: -45, words: 'given a wide berth' },
  { from: LAW.WANTED_AT, words: 'not welcome here' },
  { from: LAW.WORST, words: 'wanted for murder' },
];

/** How a standing reads out loud. The bottom band catches anything below the scale. */
export function wordsFor(score: number): string {
  for (const band of BANDS) if (score >= band.from) return band.words;
  return BANDS[BANDS.length - 1].words;
}

/** Nobody is ever better than the best or worse than the worst. */
function held(score: number): number {
  return Math.max(LAW.WORST, Math.min(LAW.BEST, score));
}

/** The running total of what you have done to people, and what the law makes of it. */
export class Standing {
  private score: number;

  /** @param score what the save had, or nought for somebody nobody has an opinion about yet */
  constructor(score = 0) {
    this.score = held(score);
  }

  /** The number itself: for the save, and for nothing the player is ever shown. */
  get value(): number { return this.score; }

  /** What people say about you, which is the only form of this the player sees. */
  get words(): string { return wordsFor(this.score); }

  /**
   * Something happened. True when the words changed, which is the only moment worth telling the
   * player about: a scale that announces every point is a scale nobody reads.
   */
  did(deed: Deed): boolean {
    const before = this.words;
    this.score = held(this.score + WEIGHT[deed]);
    return this.words !== before;
  }

  /** The village has run out of patience, and the constables are coming. */
  get wanted(): boolean { return this.score < LAW.WANTED_AT; }

  /**
   * How far past that patience you are: nought for anybody the law has no interest in, one for
   * the worst there is. A sentence is measured in it, and so is what a constable is paid.
   */
  get guilt(): number {
    if (!this.wanted) return 0;
    return Math.min(1, (LAW.WANTED_AT - this.score) / (LAW.WANTED_AT - LAW.WORST));
  }

  /** How long the cell holds you, in hours of the clock. Nought for anybody the law is not after. */
  sentence(): number {
    if (!this.wanted) return 0;
    return LAW.CELL_LEAST + this.guilt * (LAW.CELL_MOST - LAW.CELL_LEAST);
  }

  /**
   * Let out. Time served buys back exactly enough to walk down the street and no more: the
   * village remembers, and the next killing puts you straight back inside.
   */
  served(): void {
    this.score = LAW.WANTED_AT;
  }
}

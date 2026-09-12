import type { Person } from './people';

/**
 * What a village *is*, as against what a village does.
 *
 * The register is a busy file — founding, living a day, burying, resettling, reconciling a death
 * that happened on somebody else's screen — and none of that is these. A `Settlement` is the state
 * a village carries between days and a `Change` is the news it makes; both are read all over the
 * game by things that have no interest in how a day is lived.
 *
 * Split out when the treasury pushed `register.ts` past the size the architecture test allows,
 * which was a fair moment to notice that the nouns and the verbs had been sharing a file.
 */


/** Something that happened to the population, worth telling the player and worth logging. */
export interface Change {
  kind: 'born' | 'died' | 'lost' | 'resettled';
  id: string;
  name: string;
  village: string;
  day: number;
  /** How they went, for a death: their years, or something with teeth. */
  cause?: 'age' | 'violence' | 'hunger';
}

/**
 * Somebody the village has buried, as the church writes it down.
 *
 * Every death in this world passes through one place, so the roll is kept there and cannot fall out
 * of step with who is alive. It is bounded because it is a record rather than a history: a village
 * that has stood for years has buried more people than anybody wants to read, and the parish only
 * keeps the recent stones legible.
 */
export interface Burial {
  name: string;
  /** What they did, when they were old enough to do anything. */
  trade: string;
  born: number;
  day: number;
  cause: 'age' | 'violence' | 'hunger';
  /**
   * What they left, and who got it.
   *
   * Written down for the same reason the cause of death is: a parish register records what a
   * person's death actually did, and until now a purse simply vanished into the ground with its
   * owner — 18,617 gold across twenty-one villages in a hundred days, which was the largest single
   * drain in this economy and appeared in no book anywhere.
   *
   * It is also the only way the money can be *audited*. `chore economy` deliberately judges the
   * world by the books a player can pay a clerk to read and never by the simulation behind them,
   * so a transfer that no book records is a transfer the audit has to guess at — and it guessed
   * wrong three times, because whether somebody earns or pays their keep on the day they die
   * depends on which of three ways they died. A number that is written down cannot be guessed at.
   */
  left: number;
  /** Whoever it went to, or the village itself when there was nobody of the name left. */
  to: string;
}

/** How many of the dead a village's church keeps. Older stones are there; the ledger has moved on. */
export const STONES_KEPT = 60;

/** A village the register has been told about, so it knows how big to keep it. */
export interface Settlement {
  people: Person[];
  /**
   * Who is standing on the village's watchtower today, or nobody.
   *
   * Worked out again every morning out of who is here and what the hall can pay — see
   * `whoStandsWatch` — rather than being an appointment somebody holds. A village that buries its
   * watchman has a different man up there tomorrow without anything having to notice, and one that
   * runs out of money has an empty tower, which is exactly what being unable to pay looks like.
   */
  watch: string;
  /**
   * What the hall holds, which is nobody's.
   *
   * `inheritance.ts` turned a village treasury down when it went in, and said why: there was no pot
   * to bank anything in, and inventing one would have been inventing a thing nothing in the game
   * could see or spend. A hall is somewhere to keep it and a vote is something to spend it on, so
   * there is a pot now.
   *
   * It is emphatically not the mayor's. A person's purse goes to their family the day they are
   * buried; this stays exactly where it is for whoever is elected next, which is the whole
   * difference between a treasury and a rich man. Nothing in `handOnWhatTheyHad` touches it and a
   * test says so.
   */
  purse: number;
  /**
   * Meals in the store. Grown by whoever farms, eaten every day, and spoiling past what a cellar
   * of this size can keep — so a village cannot bank a good decade against a bad year.
   */
  food: number;
  /**
   * The cattle the village's farmers keep between them.
   *
   * A number rather than a list of beasts, for the same reason the larder is a number of meals:
   * what matters about a herd is that it breeds, that it feeds the place and that the surplus is
   * worth money in the next valley. Which particular cow is which is the paddock's business and
   * the paddock is drawn from this.
   */
  herd: number;
  /** The day the last of them died, for a place that has been emptied. */
  emptied?: number;
  /** The size it was founded at. Births aim to hold it near this. */
  founded: number;
  houses: number;
  trades: string[];
  /** Who has been buried here, newest last. */
  buried: Burial[];
  /**
   * What the village has paid to have built, oldest first.
   *
   * Owned rather than implied. What a village had was worked out from what its people held that
   * evening — so a village that had a hard winter lost its second storey, which is not a thing that
   * happens to a building. These are bought out of the hall, they stay bought, and the money goes
   * back into the village that raised it.
   */
  works: string[];
}

/** The day every village is founded on, whenever the player happens to arrive. */
import type { Debt } from './debts';
import type { Sworn } from './vacancies';
import type { Deed } from './homes';
import type { Holding, Owner } from './holdings';
import type { Person } from './people';
import type { Rank } from './rank';

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
  /**
   * Where they walked from, for a resettling.
   *
   * `village` is where somebody now is, which is the whole of what a death or a birth needs to say.
   * A person who has moved is the one case where the place they left matters as much: the village
   * they came from is a village one person lighter, and anybody keeping books on both — the audit
   * does — has to know which two places the day touched.
   */
  from?: string;
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
  /**
   * Whoever it went to, or the village itself when there was nobody of the name left.
   *
   * Since #240 there is a third reading of an empty name: his creditors had the whole of it and
   * there was nothing behind them to hand on. `left` is what came out of his purse either way,
   * which is the number the audit above is about — a debt paid at a funeral is money that stayed
   * in the village, it simply went to the man who was owed rather than to the man of the name.
   */
  to: string;
}

/** How many of the dead a village's church keeps. Older stones are there; the ledger has moved on. */
export const STONES_KEPT = 60;

/** The village itself: one owner, one treasury, and the building that gives it a body. */
export interface Hall {
  /** The same identity used by holdings and payroll entries. */
  readonly id: Owner;
  /** A place keeps its books under the mayor's roof until its voted hall has finished building. */
  body: 'mayor-house' | 'town-hall';
  /** The village treasury, separate from every mayor and therefore never inherited. */
  purse: number;
}

/** A village the register has been told about, so it knows how big to keep it. */
export interface Settlement {
  people: Person[];
  /** What this place has declared itself to be; town and city never follow from roofs alone. */
  rank: Rank;
  /**
   * The days somebody was raised at a shrine and sent here.
   *
   * Kept rather than derived, for the reason a violent death is kept: nothing about the seed implies
   * it, so a village re-lived from its founding would simply lose whoever the magic brought. *Only*
   * the days are kept — who each of them turned out to be is worked out from the village and the
   * day, so the person is derived like everybody else and two machines that both know a raising
   * happened raise the same person. See `shrine.ts`.
   */
  raised: number[];
  /**
   * Which household holds which roof. Item 111.
   *
   * Kept for the reason `raised` is kept, and for a narrower one: who lives where is arithmetic
   * until the list changes underneath it, and then a family finds itself in a different house than
   * the one it lived in yesterday with nothing having happened to either. See `deedsAfter`.
   */
  deeds: Deed[];
  /** Travellers who have taken work this village had nobody for. Item 24a's other half.
   *
   * Kept for the reason `raised` is kept: a village re-lived from its seed would otherwise lose
   * whoever walked in off the road and offered. The register holds the copy that survives a
   * re-founding; this is the one a day reads, so the mayor stops raising children into work
   * somebody is already doing. See `swearIn` and `tradeTakenUp`.
   */
  sworn: Sworn[];
  /**
   * Who is standing on the village's watchtower today, or nobody.
   *
   * Worked out again every morning out of who is here and what the hall can pay — see
   * `whoStandsWatch` — rather than being an appointment somebody holds.
   */
  watch: string;
  /** The village owner, its treasury, and where that owner can be found. */
  hall: Hall;
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
  /**
   * The farms, yards and boats the village has, and who owns and works each of them.
   *
   * The line above is the herd and this is who keeps it, which is a distinction the village did not
   * have until now: `herd` is a number belonging to nobody in particular, and a farm is a thing with
   * a gate and a family name on it that is still standing the morning after its farmer is buried.
   * The herd is not stored on them — `shareTheBeasts` divides it — because one number that two
   * places keep is one number two places can disagree about.
   *
   * Optional, and it has to be: a village is founded before it holds anything and lives its first
   * morning before the farms are hung on the people in it. Absent means "not worked out yet", which
   * is a different thing from empty and is what the register sees on day one. See `holdings.ts`.
   */
  holdings?: Holding[];
  /**
   * What the people here owe one another, and nothing about what they own. See `debts.ts`.
   *
   * Derived rather than told, which is why it sits beside the holdings instead of beside the
   * raisings and the votes. A claim in this world falls out of a piece of work and a purse — the
   * doctor who set a bone the man could not pay for — and both of those a re-living reproduces on
   * its own, so there is nothing here for the register to be told and nothing for two copies of it
   * to disagree about.
   *
   * Optional for the same reason `holdings` is: a village is founded before anybody in it has had
   * the chance to owe anybody anything, and absent means "nothing has happened yet" rather than
   * "worked out and empty".
   */
  debts?: Debt[];
  /** The day the last of them died, for a place that has been emptied. */
  emptied?: number;
  /**
   * How many people the village's roofs hold. Births aim to hold it near this.
   *
   * It used to mean the size it happened to be founded at, full stop, and that was the whole of why
   * no village in this world could ever get bigger: births backfilled the dead against a ceiling
   * nothing could lift. It is made of houses now — a house holds a household, so the ceiling rises
   * by a houseful the morning a house is raised and on no other occasion. See `growth.ts`.
   */
  founded: number;
  /**
   * How many houses the village was laid out with, which is the ground's own verdict on the site.
   *
   * Emphatically the *founding* count and not the number standing today: `structures.ts` decides it
   * by trying eighty plots and keeping whatever the footprint check will have, so a village in a
   * narrow valley comes out with three and one on a plain with six, and `roomFor` reads that back
   * to say how much room there is to grow into. Houses raised since are counted out of `works`,
   * where they are replayed like everything else a village has paid for — a village is founded on
   * day one and lived forward to today, so anything stored about a grown one is a thing the
   * re-living would have to reproduce exactly, and a number that never changes cannot drift.
   */
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
   *
   * Houses are in here too, one entry each, and they are the one sort of entry that repeats: a
   * village digs one well and raises as many roofs as it has ground for. `housesStanding` counts
   * them, which is how a grown village knows how big it is without keeping a second number that
   * could disagree with this one.
   */
  works: string[];
}

/** The day every village is founded on, whenever the player happens to arrive. */

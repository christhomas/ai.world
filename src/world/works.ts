import { transfer, type Holder, type Paid } from './deeds';

/**
 * A purchase with a lead time.
 *
 * This began as "gold for work rather than gold for an object", on the reasoning that hiring a
 * sword and commissioning a house are the same act. That was half right and the half it got wrong
 * is the useful half: **a house is very much an object, it just is not there yet.** You pay, he
 * builds, and two months later you are handed a house. Every way it differs from `buy` follows
 * from the delay rather than from the work — a deposit, a balance, and a stretch in between where
 * each of you owes the other something.
 *
 * Which leaves hiring as the genuinely different one, and there is deliberately no `hire` here.
 * See the note beside `cutOf`.
 *
 * ## Why it is worth having as a deed
 *
 * `building.ts` already did all of this and nothing else in the game could reach it: a deposit
 * down, a house going up over days, a balance falling due when it is finished, and a village that
 * hears about it every day the debt stands. It wrote out its own "what is still owed" and its own
 * "take it off the payer and add it to the builder" — three lines that had to agree about one
 * number, and they very nearly did not: the conversion that moved the deposit onto a deed missed
 * the balance entirely, because `houses.pay` sat between the two halves of it.
 *
 * It also opens the thing the vocabulary is for. A villager cannot commission a house today, and
 * the reason is not that it would be strange — a prospering village paying a builder is the most
 * ordinary thing in the world — but that the act only ever existed inside a menu. As a deed it is
 * available to anybody, a behaviour tree included.
 *
 * ## What it deliberately does not know
 *
 * How long the work takes, what it produces, whether it is finished, or what happens if it never
 * is. Those are the caller's: a house has a building day and a soldier has a road to walk, and
 * neither has anything to say about the other. What is shared is the money and the debt.
 *
 * What it knows and does not act on: **what was ordered.** `Work.what` names the thing — a house,
 * a second storey, a bath house — and is carried from the table to the site without being read
 * here, because what a name means is the builder's business. What is still missing is the rest of
 * a specification: a design, a size, what goes in it. Those want a catalogue of things that can
 * actually be put up, and a catalogue is only worth having once the world can grow more than one
 * of them.
 */

/**
 * A piece of work somebody is being paid for: what it comes to, and what has been handed over.
 *
 * Deliberately two fields and no more, so that the things this world already keeps satisfy it
 * without being changed. A `Commission` out of `building.ts` is a `Work` as it stands, which is
 * the test of whether an abstraction was found or invented.
 */
export interface Work {
  /**
   * What was ordered.
   *
   * The argument that makes this a verb rather than one hard-coded transaction: *build* does not
   * mean "build a house", it means build a thing, and the thing has to be named. A house, a second
   * storey on one, a bath house, a paddock, a farm — whatever the world grows a way to put up. It
   * was very nearly left out on the grounds that only houses exist today, which would have been
   * building the one case into the vocabulary and calling it general.
   *
   * A name rather than a shape, because what it means is the builder's business and not this
   * file's. `building.ts` reads it to decide what to stand on the plot; `commission` only has to
   * carry it from the table to the site.
   *
   * Optional only because every commission written down before there was a choice was a house, and
   * a save from last week is not wrong, it is old. Absent means whatever the builder's default is.
   */
  what?: string;
  /** What the whole of it comes to. */
  price: number;
  /** What has been handed over so far. */
  paid: number;
}

/**
 * What is still owed on it.
 *
 * Never negative. Somebody who has overpaid is owed nothing rather than owed a negative amount,
 * because every caller of this puts the answer straight into a sentence and "you owe -40 gold" is
 * not a sentence anybody wants to read.
 */
export function owing(work: Work): number {
  return Math.max(0, work.price - work.paid);
}

/**
 * Order a thing that has to be made: a purchase with a lead time.
 *
 * Named `commission` rather than `engage` because that is what it turned out to be. It was put in
 * beside hiring, on the reasoning that both are gold for work rather than gold for an object — and
 * the sharper reading is that a house is very much an object, it just is not there yet. You pay, he
 * builds, and two months later you are handed a house. That is a purchase with a delay in the
 * middle, and every difference from `buy` follows from the delay rather than from the work: a
 * deposit, a balance, and a stretch in between where each of you owes the other something.
 *
 * Which leaves `hire` as the genuinely different one, and this file deliberately does not pretend
 * to cover it — see the note at the foot.
 *
 * All or nothing, like any other bargain struck across a table: a builder does not lay four fifths
 * of a foundation because you had four fifths of the deposit. A payer who cannot cover it pays
 * nothing, the work is untouched, and the caller is told.
 *
 * `down` is capped at what is actually owed, so an over-generous caller cannot pay more than the
 * job is worth and leave the books unable to explain it.
 */
export function commission(payer: Holder, worker: Holder, work: Work, down: number): Paid {
  const due = Math.min(Math.max(0, down), owing(work));
  if (due <= 0) return { paid: 0, afforded: true };
  if (payer.has < due) return { paid: 0, afforded: false };
  const got = transfer(payer, worker, due);
  work.paid += got.paid;
  return got;
}

/**
 * And settle what is left when the job is done.
 *
 * Takes what the payer can find rather than refusing, which is the opposite rule to `commission` and is
 * the right one: a bargain you cannot afford is one you do not strike, but a debt you cannot cover
 * is one you pay down. A house half paid for is a house standing there with a balance on it and a
 * village that hears about it every day — which is a far better thing for a game to do with a debt
 * than to refuse the payment.
 */
export function settle(payer: Holder, worker: Holder, work: Work): Paid {
  const due = owing(work);
  if (due <= 0) return { paid: 0, afforded: true };
  const got = transfer(payer, worker, Math.min(due, payer.has));
  work.paid += got.paid;
  return { paid: got.paid, afforded: got.paid >= due };
}

/**
 * What a share of a haul comes to for whoever is walking with you.
 *
 * This is where hiring parts company with commissioning, and it is why there is no `hire` in this
 * file. A commission is a purchase with a delay: a price, a balance, and a day the books go square
 * and the thing is yours. A hired sword is none of that. You are not owed an object at the end of
 * it, there is no balance, and there is no moment of delivery — you have bought a claim on
 * somebody's days, and what you get for the money is that he is there. The money side of it is
 * already sayable in words this vocabulary has: `buy` for the fee in the hand, and this for each
 * cut of whatever turns up, for as long as the bargain holds. What makes hiring its own deed is
 * the claim, and a claim is not a payment.
 *
 * Floored, and the odd penny stays with whoever won it. A share of one gold three ways is nothing
 * each rather than a third each, which is what a share of the takings means when the takings are a
 * single coin.
 */
export function cutOf(won: number, share: number): number {
  return Math.floor(Math.max(0, won) * Math.max(0, Math.min(1, share)));
}

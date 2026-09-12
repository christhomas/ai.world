import { FOOD } from './food';
import type { Person } from './people';

/**
 * A villager who has been hurt, and what it costs the village.
 *
 * Until now a villager had exactly two conditions: alive, and buried. Something with teeth either
 * missed you entirely or took you off the register — which made every wolf in the country a coin
 * flip and left the village doctor with nothing whatever to do, in a game that has had doctors
 * since the first village was laid out.
 *
 * So there is a middle. A man who has been mauled is hurt for some days: he does not work, which is
 * the whole of what it costs the village, and he mends. A village with a doctor mends faster,
 * because that is what the doctor is *for* — and it is the first answer this economy has ever had
 * to "why is a doctor worth feeding".
 *
 * ## What it is not
 *
 * It is not hit points. A villager's body already has those while it is standing in the street and
 * loses them the moment it is despawned; this is the fact about the *person* that survives walking
 * round a corner, in the same way that being hungry does. The two are deliberately the same shape:
 * a number of days, nought for anybody who is fine, counted down by the day the village lives.
 *
 * It is also not a second way to die. A wound heals or it stays, and what kills people here is
 * hunger, violence and years; adding a fourth would mean every unwatched valley quietly losing
 * people to grazed knees, which is the sort of thing a simulation does when nobody is looking.
 */

export const WOUND = {
  /**
   * How many days a villager is laid up by the worst of it.
   *
   * Six: long enough that a household notices — it is most of a week of somebody not earning, and
   * `roofs.ts` will not give a hungry family a child — and short enough that a village does not
   * carry a cripple for a season because of one bad afternoon on the road.
   */
  WORST: 6,
  /**
   * What a doctor is worth, as a share of the days taken off the mending.
   *
   * Half. It is the largest number that still leaves being hurt worth avoiding, and the smallest
   * that makes a village with a doctor visibly better at absorbing a bad week than one without —
   * which is the whole argument for a village paying one to stand about.
   */
  DOCTOR_SAVES: 0.5,
  /** What a doctor charges for it, in gold. A day of anybody's keep, and he does not refuse. */
  FEE: 4,
} as const;

/** The trade that mends people. Here rather than spelled out at each site that asks. */
export const MENDS = 'doctor';

/** Is anybody in this village able to set a bone? */
export function doctoredBy(people: readonly Person[]): Person | null {
  return people.find((person) => person.trade === MENDS) ?? null;
}

/**
 * How long somebody is laid up by a wound of this severity, given who is in the village.
 *
 * `severity` is nought to one — a scratch to a mauling — and is whatever hurt them decides it. The
 * days are rounded up, so the lightest wound anybody can take still costs a day: a villager who was
 * bitten and went back to work in the same hour is a villager nobody would believe.
 */
export function laidUpFor(severity: number, doctor: Person | null): number {
  const worst = Math.max(0, Math.min(1, severity));
  if (worst <= 0) return 0;
  const days = Math.ceil(worst * WOUND.WORST);
  return doctor ? Math.max(1, Math.round(days * (1 - WOUND.DOCTOR_SAVES))) : days;
}

/**
 * Whether somebody can do a day's work today.
 *
 * The one question the rest of the economy asks about a wound, and the only thing it costs: a man
 * who is laid up earns nothing, and the village earns nothing by him. He still eats — a village
 * that let its injured starve would be a different game — and he still pays for his dinner out of
 * whatever he had, which is what makes a bad week expensive rather than fatal.
 */
export function ableToWork(person: Person): boolean {
  return (person.hurt ?? 0) <= 0;
}

/**
 * A day of mending, for everybody in a village.
 *
 * Counted down by the day the village lives, so a village re-lived from its founding mends its
 * people again at the same pace. The days are written onto the people here, because a day of
 * mending is what this file is about; the coin is handed back, because moving one is the register's
 * business and it has exactly one door for it.
 *
 * The fee is the doctor's, and it is the first money in this world that changes hands for *work
 * somebody needed doing at the moment they needed it*. A seller's takings and an innkeeper's beds
 * are paid by everybody every day whether or not anybody wanted anything; this is paid by the man
 * with the broken arm, to the man who set it.
 */
export function mendThem(people: readonly Person[]): Map<string, number> {
  const doctor = doctoredBy(people);
  const fees = new Map<string, number>();
  for (const person of people) {
    const hurt = person.hurt ?? 0;
    if (hurt <= 0) continue;
    // paid on the first morning of being seen to, once, rather than daily: a doctor sets a bone and
    // is paid for setting it, and nobody is billed for lying still afterwards
    if (doctor && doctor.id !== person.id && hurt === laidUpFor(1, doctor)) {
      const paid = Math.min(WOUND.FEE, person.purse);
      if (paid > 0) {
        fees.set(person.id, -paid);
        fees.set(doctor.id, (fees.get(doctor.id) ?? 0) + paid);
      }
    }
    person.hurt = hurt > 1 ? hurt - 1 : undefined;
  }
  return fees;
}

/** How badly a creature of this much bite hurts somebody, nought to one. */
export function hurtBy(damage: number): number {
  // measured against what a hero can take, which is the only scale of harm this game has
  return Math.max(0, Math.min(1, damage / FOOD.HEARTS));
}

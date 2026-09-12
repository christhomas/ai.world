/**
 * What is standing over a village today.
 *
 * Out of `register.ts` because it is a different subject from the book of who is alive: this is the
 * one fact about a village that comes from *outside* the simulation. A warband on the road is the
 * game's business — where it is, what mood it is in, whether anybody has driven it off — and the
 * register only needs the number, because nobody trades while their neighbours are being buried.
 * That is what makes a village's prosperity something a player can protect.
 *
 * The whole design is in the dates. Nothing in this world ever says a band has *gone*:
 * `roaming.pressings` hands back the villages a band is standing over and says nothing whatever
 * about the rest, so a pressing that did not expire would be a siege that never lifted. `chore
 * economy` found what that cost — one morning's band over Thornby, and the place was empty by the
 * fiftieth day with twenty-one of its twenty-seven stones reading starved, because the register
 * still believed the band was there. Worse, a village is re-lived from its founding whenever
 * anybody learns something new about it, so walking into one a band happened to be near meant
 * re-living all forty of its days under today's siege: sixteen graves and nobody alive, on arrival.
 *
 * So a pressing is about exactly one day, and has to be said again tomorrow. The game says it every
 * frame, so a band that is still there presses again in the morning and one that has moved on stops
 * mattering without anybody having to notice that it left.
 */
export class Pressings {
  private readonly told = new Map<string, { pressure: number; told: number }>();

  /** Somebody has looked at what the bands are doing, and this is what stands over here today. */
  leanedOn(village: string, pressure: number, day: number): void {
    this.told.set(village, { pressure, told: day });
  }

  /**
   * How hard a village is being leaned on now, for whoever is writing its books.
   *
   * "Now" is the day the register is about to live, because that is the day the answer changes
   * anything: a pressing already spent on a day gone by is history, and a roll that quoted it would
   * be quoting a wage nobody is going to be paid.
   */
  now(village: string, day: number): number {
    const said = this.told.get(village);
    return said !== undefined && said.told === day ? said.pressure : 0;
  }

  /** And what it comes to on one particular day, which is the only day it was ever about. */
  on(village: string, day: number): number {
    const said = this.told.get(village);
    return said !== undefined && said.told + 1 === day ? said.pressure : 0;
  }
}

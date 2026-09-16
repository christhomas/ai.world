import { describe, expect, it } from 'vitest';
import { streamFor } from './aday';
import { restWhoIsFailing } from './oldage';
import { LIFE, ageOf, grownUp, stageOf, type Person } from './people';
import { WOUND, ableToWork, mendThem } from './wounds';

/**
 * There is an old age at the end of a life, and it costs the village something.
 *
 * `LIFE` used to run baby, child, adult, and then a funeral somewhere between day sixty and day
 * ninety. Nothing made the last fifteen days of a life different from the first fifteen of
 * adulthood: a man of eighty-eight went down the mine on the morning he died, and a village's
 * output was a head count and nothing else. Item #245.
 *
 * What is asserted here is the pair of claims that make the stage worth having. An old body gives
 * out now and then, which is the first time in this economy that *who* a village's people are
 * decides what it takes in rather than merely how many of them there are — and a village with a
 * doctor gets its old people back on their feet twice as fast, which is the second reason that
 * trade has ever had to exist.
 */

const villager = (id: string, trade: string, over: Partial<Person> = {}): Person => ({
  id, name: id, village: 'Testing', sex: 'man', trade,
  born: 0, lives: 80, mother: '', father: '', knows: [], memories: [], opinions: [],
  purse: 20, hungry: 0, ...over,
} as Person);

/** Somebody of exactly this many days, on the day the test is standing in. */
const aged = (id: string, days: number, over: Partial<Person> = {}): Person =>
  villager(id, 'farmer', { born: -days, ...over });

/**
 * A valley of villages lived forward, and the share of mornings each man could not work.
 *
 * The real pieces in the real order: `mendThem` counts the beds down and then the evening lays up
 * whoever is failing, exactly as `liveADay` runs the two.
 *
 * Over a valley rather than over one man, because how often a body gives out is a chance and one
 * old man over one season reads like the coin it is — the first village this was written against
 * put its elder in bed for exactly half the days in it, which is neither the design nor a fault,
 * merely sixty tosses. Every village gets a stream of its own, the way the day hands one out.
 */
function mornings(make: () => Person[], days: number, villages = 40): Map<string, number> {
  const abed = new Map<string, number>();
  for (let n = 1; n <= villages; n++) {
    const people = make();
    for (let day = 1; day <= days; day++) {
      for (const person of people) {
        if (!ableToWork(person)) abed.set(person.id, (abed.get(person.id) ?? 0) + 1);
      }
      mendThem(people);
      restWhoIsFailing(people, day, streamFor(n, `village ${n}:elders`, day));
    }
  }
  const share = new Map<string, number>();
  for (const person of make()) share.set(person.id, (abed.get(person.id) ?? 0) / (days * villages));
  return share;
}

/*
 * How long a run of mornings is worth asking about: a fortnight, which is what an old age is, and
 * short enough that both men in it are still the age they started.
 *
 * Ages move as the days do here, exactly as they do in a village, so a run long enough to feel
 * comfortable would be asking about a man of ninety and getting the right answer to the wrong
 * question — which is what the first draft of this did.
 */
const OVER = LIFE.OLD_AGE - 1;

describe('where a life turns into an old age', () => {
  it('has a stage after adulthood, which is what this world has never had', () => {
    const old = aged('old', 70, { lives: 80 });
    expect(stageOf(old, 0)).toBe('elder');
  });

  it('is still adulthood before it', () => {
    expect(stageOf(aged('mid', 40, { lives: 80 }), 0)).toBe('adult');
    expect(stageOf(aged('lad', 12, { lives: 80 }), 0)).toBe('child');
    expect(stageOf(aged('babe', 2, { lives: 80 }), 0)).toBe('baby');
  });

  /*
   * The same stretch for everybody, counted back from the day they will die.
   *
   * A birthday cannot work when a life runs from sixty days to ninety — a line at sixty gives the
   * shortest life no old age at all — and a share of `lives` cannot either, because a founder's
   * `lives` is an age with a whole life added to it and so is half as long again as anybody's who
   * was actually born here. Counted back, a hundred-and-forty-day founder and a sixty-day boy both
   * get a fortnight of it.
   */
  it('gives the shortest life an old age too, and the longest no more of one', () => {
    const daysOld = (lives: number): number => {
      const person = aged('x', 0, { lives });
      let days = 0;
      while (days < lives && stageOf(person, days) !== 'elder') days++;
      return lives - days;
    };
    expect(daysOld(LIFE.SHORTEST_LIFE)).toBe(LIFE.OLD_AGE);
    expect(daysOld(LIFE.LONGEST_LIFE)).toBe(LIFE.OLD_AGE);
    // and a founder, who carries an age with a whole life added on top of it
    expect(daysOld(LIFE.LONGEST_LIFE + 50)).toBe(LIFE.OLD_AGE);
  });

  it('is nobody the village stops counting as grown', () => {
    expect(grownUp(aged('old', 70, { lives: 80 }), 0)).toBe(true);
    expect(grownUp(aged('mid', 40, { lives: 80 }), 0)).toBe(true);
    expect(grownUp(aged('lad', 12, { lives: 80 }), 0)).toBe(false);
    expect(ageOf(aged('old', 70), 0)).toBe(70);
  });
});

describe('an old body, on an ordinary morning', () => {
  it('gives out now and then, where a young one never does', () => {
    const share = mornings(
      () => [aged('old', 74, { lives: 88 }), aged('young', 30, { lives: 88 })], OVER);
    expect(share.get('old'), 'an old man never had a bad morning anywhere').toBeGreaterThan(0);
    expect(share.get('young'), 'a man of thirty was laid up by his years').toBe(0);
  });

  it('still goes out most mornings, because this is an old age and not a retirement', () => {
    const share = mornings(() => [aged('old', 74, { lives: 88 })], OVER).get('old')!;
    expect(share, 'an elder has effectively stopped working').toBeLessThan(0.5);
    expect(share, 'an elder is never laid up by his years at all').toBeGreaterThan(0.05);
  });

  it('is not laid up twice over by a wound it is already carrying', () => {
    const old = aged('old', 74, { lives: 88, hurt: WOUND.WORST });
    restWhoIsFailing([old], 1, streamFor(7, 'Testing:elders', 1));
    expect(old.hurt).toBe(WOUND.WORST);
  });

  it('comes out the same on two machines, off a stream of its own', () => {
    const make = (): Person[] => [aged('a', 74, { lives: 88 }), aged('b', 76, { lives: 90 })];
    expect([...mornings(make, OVER)]).toEqual([...mornings(make, OVER)]);
  });

  it('does not spend the village its own roll, so a valley with no old people is unchanged', () => {
    const rng = streamFor(7, 'Testing:elders', 1);
    const drawn = [rng(), rng(), rng()];
    const again = streamFor(7, 'Testing:elders', 1);
    expect([again(), again(), again()]).toEqual(drawn);
  });
});

describe('what a doctor is worth to the old', () => {
  /*
   * The second reason for the trade. A doctor has earned his keep since `wounds.ts` only when
   * something with teeth came through the valley, which in a quiet village is never — so half the
   * doctors in this world stood about for four hundred days doing nothing whatever. Old age happens
   * in every village, every season, whether or not anything is hunting there.
   */
  it('gets more work out of a village than one without, over the same days', () => {
    const doctored = mornings(
      () => [aged('old', 74, { lives: 88 }), villager('doc', 'doctor', { born: -30 })], OVER)
      .get('old')!;
    const alone = mornings(() => [aged('old', 74, { lives: 88 })], OVER).get('old')!;
    expect(doctored, 'a doctor made no difference to an old man at all').toBeLessThan(alone);
    // got out of bed in half the days, so he loses appreciably less of his old age to it
    expect(alone - doctored).toBeGreaterThan(0.05);
  });
});

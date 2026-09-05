import { describe, expect, it } from 'vitest';
import { MINING, dayUnderground, faceValue, freshMine, leftIn, perilAfter, restOvernight, saidOfMine, toldOfMine } from './mining';

/** Run a mine for a year and report what it did. */
function overAYear(peril: number = MINING.PERIL, miners = 3, days = 365) {
  let mine = freshMine('m');
  let gold = 0, dropped = 0, scares = 0, deaths = 0, idle = 0;
  for (let day = 1; day <= days; day++) {
    const today = dayUnderground(7, day, mine, miners, peril);
    gold += today.gold; dropped += today.dropped;
    if (today.scared) scares++;
    if (today.lost) deaths++;
    if (today.gold === 0 && !today.scared) idle++;
    mine = restOvernight(mine, today);
  }
  return { gold, dropped, scares, deaths, idle, mine };
}

/**
 * An economy that only circulates runs down; the mines are what mint. The whole design problem is
 * the brake — one patch of mountain holds about five thousand gold against a village's entire
 * wealth of about three thousand, so an unmetered mine drowns the economy rather than feeding it.
 */
describe('a mine as a source of money', () => {
  it('pays nothing when nobody works it', () => {
    expect(dayUnderground(1, 1, freshMine('m'), 0).gold).toBe(0);
  });

  it('gives what the seam gives, however many people are sent at it', () => {
    const mine = freshMine('m');
    const two = dayUnderground(1, 5, mine, 2, 0).gold;
    const twenty = dayUnderground(1, 5, mine, 20, 0).gold;
    expect(twenty, 'sending a crowd multiplies the gold').toBe(two);
  });

  it('runs out as it is worked', () => {
    const fresh = freshMine('m');
    const spent = { ...fresh, worked: MINING.DEPTH * 0.9 };
    expect(faceValue(spent)).toBeLessThan(faceValue(fresh) * 0.2);
    expect(leftIn({ ...fresh, worked: MINING.DEPTH * 2 })).toBe(0);
  });

  it('comes back if it is left alone', () => {
    let mine = { ...freshMine('m'), worked: 400 };
    for (let n = 0; n < 50; n++) mine = restOvernight(mine, { gold: 0, scared: false, lost: false, dropped: 0 });
    expect(mine.worked).toBeLessThan(400);
  });

  it('mints a village-sized fortune over a year, not ten of them', () => {
    // a village's whole accumulated wealth is around three thousand; a mine should be a
    // significant part of a local economy without being the entire thing
    const year = overAYear();
    expect(year.gold).toBeGreaterThan(800);
    expect(year.gold).toBeLessThan(6000);
  });

  it('kills people, and what they carried is left where they fell', () => {
    const year = overAYear();
    expect(year.deaths).toBeGreaterThan(0);
    expect(year.dropped).toBeGreaterThan(0);
  });

  it('produces far less when it is feared, without anybody forbidding it', () => {
    const safe = overAYear(0);
    const awful = overAYear(0.9);
    expect(awful.gold).toBeLessThan(safe.gold * 0.5);
  });

  it('makes clearing it out worth real money within a season', () => {
    // The whole point of the loop: peril is the dial the player can move. Measured over a season
    // rather than a year, because what danger changes is the RATE — see the test below.
    const season = 60;
    expect(overAYear(0, 3, season).gold).toBeGreaterThan(overAYear(0.45, 3, season).gold * 1.5);
  });

  it('holds only so much, so danger costs time rather than the gold itself', () => {
    // A mine is finite. A safe one takes its gold out quickly and a feared one leaves it in the
    // ground, so over a long enough window the two converge on what the seam actually held. That
    // is the honest shape of it, and it is why the test above measures a season: clearing a mine
    // buys the village its money SOONER, and buys back the people it would otherwise have lost.
    const safe = overAYear(0), feared = overAYear(0.45);
    expect(feared.gold).toBeGreaterThan(safe.gold * 0.5);
    expect(feared.deaths).toBeGreaterThan(safe.deaths);
    expect(feared.dropped).toBeGreaterThan(safe.dropped);
  });

  it('fears a mine that has hurt somebody, and forgets slowly if it does not', () => {
    const bad = restOvernight(freshMine('m'), { gold: 0, scared: true, lost: true, dropped: 20 });
    expect(bad.dread).toBeGreaterThan(0.3);
    let calm = bad;
    for (let n = 0; n < 40; n++) calm = restOvernight(calm, { gold: 5, scared: false, lost: false, dropped: 0 });
    expect(calm.dread).toBeLessThan(bad.dread);
  });

  it('has something to say about a bad mine and nothing about an ordinary one', () => {
    expect(saidOfMine(freshMine('m'))).toBe('');
    expect(saidOfMine({ id: 'm', worked: 0, dread: 0.8 })).toContain('Nobody');
  });

  it('gets safer the more of what lives in it is killed, and stops at safe', () => {
    expect(perilAfter(0)).toBe(MINING.PERIL);
    expect(perilAfter(3)).toBeLessThan(MINING.PERIL);
    // a cave floor holds about eight things. Clearing one out should finish the job, not leave a
    // village still losing a man a month to a mine the player has already emptied
    expect(perilAfter(8)).toBe(0);
    expect(perilAfter(500)).toBe(0);
  });

  it('pays for clearing it out in people and in quiet rather than in gold', () => {
    // The seam holds what it holds, so an emptied mine's year is only a little richer — the test
    // above says why. What it buys instead is everybody who would have been buried, and a village
    // that is not frightened of its own workings at the end of it. Left alone, an ordinary mine
    // ends its first year having killed half a dozen men and with nobody willing to go down.
    const feared = overAYear(MINING.PERIL, 3, 365);
    const emptied = overAYear(perilAfter(8), 3, 365);
    expect(feared.deaths).toBeGreaterThan(3);
    expect(emptied.deaths).toBe(0);
    expect(feared.mine.dread).toBeGreaterThan(0.5);
    expect(emptied.mine.dread).toBe(0);
  });
});

/**
 * The other half of the loop, and the one that took the longest to get right: a mine can be made
 * safe without anybody knowing it has been. Fear is what stops a village working, fear fades at a
 * fiftieth a day, and a player who clears a mine and walks away watches nothing happen for a
 * month. So there has to be a second way for fear to end — somebody says so — and it has to be
 * the player's doing rather than the clock's.
 */
describe('what a village believes about its mine', () => {
  const feared = (dread: number) => ({ id: 'm', worked: 100, dread });

  it('goes on being frightened of a mine that has been emptied, until it is told', () => {
    const mine = feared(0.8);
    // the mine is safe now, and nobody in the village has the faintest idea
    expect(saidOfMine(mine)).toContain('Nobody');
    expect(toldOfMine(mine, perilAfter(8)).dread).toBe(0);
    expect(saidOfMine(toldOfMine(mine, perilAfter(8)))).toBe('');
  });

  it('only half believes it about a mine that is only half cleared', () => {
    const told = toldOfMine(feared(0.9), perilAfter(3));
    expect(told.dread).toBeLessThan(0.9);
    expect(told.dread).toBeGreaterThan(0.4);
  });

  it('never takes a frightening story as good news', () => {
    // somebody who walked out of a mine alive is not what frightens a village. What frightens a
    // village is the one who did not, and that arrives through restOvernight, not through this
    expect(toldOfMine(feared(0.1), MINING.PERIL).dread).toBe(0.1);
    expect(toldOfMine(feared(0), MINING.PERIL).dread).toBe(0);
  });

  it('leaves the seam alone: word about the danger is not word about the gold', () => {
    expect(toldOfMine(feared(0.8), 0).worked).toBe(100);
  });
});

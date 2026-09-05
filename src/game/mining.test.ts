import { describe, expect, it } from 'vitest';
import { MINING, dayUnderground, faceValue, freshMine, leftIn, restOvernight, saidOfMine } from './mining';

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
});

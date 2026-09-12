import { describe, expect, it } from 'vitest';
import { LEAVING, livingIn, whoMovesIn, whoWalksIn, type Living } from './movingon';

/**
 * Why anybody leaves the village they were born in.
 *
 * The machinery for moving somebody has existed since villages could empty, and was never once
 * called by the simulation, because it had to be told which village sends and which receives and
 * nothing in the world had a reason to say. These are the reasons.
 */

const place = (over: Partial<Living> & { village: string }): Living => ({
  people: 20, food: 60, purse: 400, room: 24, emptyFor: null, ...over,
});

const ruin = place({ village: 'Thornby', people: 0, food: 0, purse: 0, emptyFor: 40 });

describe('what sort of living a place is', () => {
  it('counts food and coin together, because either alone is a lie', () => {
    const fed = livingIn(place({ village: 'a', food: 200, purse: 0 }));
    const rich = livingIn(place({ village: 'b', food: 0, purse: 4000 }));
    expect(fed).toBeGreaterThan(0);
    expect(rich).toBeGreaterThan(0);
  });

  it('counts them per head, because that is what anybody actually experiences', () => {
    const small = place({ village: 'small', people: 10, food: 60, purse: 400 });
    const crowded = place({ village: 'crowded', people: 30, food: 60, purse: 400 });
    expect(livingIn(small)).toBeGreaterThan(livingIn(crowded));
  });

  it('is nothing at all in an empty village, however much is left lying about', () => {
    // nobody moves to a ruin because the ruin is rich. They move because there is room and nobody
    expect(livingIn(place({ village: 'gone', people: 0, food: 900, purse: 9000 }))).toBe(0);
  });
});

describe('who walks over to an empty village', () => {
  it('is somebody from the place that gains least by staying', () => {
    const thin = place({ village: 'Fernreach', people: 30, food: 20, purse: 50, room: 20 });
    const rich = place({ village: 'Oakcross', people: 30, food: 300, purse: 4000, room: 20 });
    expect(whoMovesIn(ruin, [rich, thin], 60)).toBe('Fernreach');
  });

  it('is nobody at all while the place is still somebody’s home', () => {
    const lived = place({ village: 'Thornby', people: 3, emptyFor: null });
    expect(whoMovesIn(lived, [place({ village: 'Oakcross' })], 60)).toBeNull();
  });

  it('waits until a disaster has stopped being one', () => {
    // whatever emptied it may still be there, and walking in the next morning is not resettlement
    const fresh = { ...ruin, emptyFor: LEAVING.LEFT_A_WHILE - 1 };
    expect(whoMovesIn(fresh, [place({ village: 'Oakcross', people: 30, room: 20 })], 60)).toBeNull();
    const stale = { ...ruin, emptyFor: LEAVING.LEFT_A_WHILE };
    expect(whoMovesIn(stale, [place({ village: 'Oakcross', people: 30, room: 20 })], 60)).toBe('Oakcross');
  });

  it('takes nobody from a village that has room for the people it has', () => {
    // a village that can still build is a village whose people have no reason to go anywhere
    const roomy = place({ village: 'Oakcross', people: 10, room: 40 });
    expect(whoMovesIn(ruin, [roomy], 60)).toBeNull();
  });

  it('takes nobody from a ruin, which would be moving a village rather than repopulating one', () => {
    expect(whoMovesIn(ruin, [place({ village: 'Blackmarsh', people: 0, emptyFor: 30 })], 60)).toBeNull();
  });

  it('will not resettle a place with nowhere to live', () => {
    // a village whose houses are gone is a field with a name, and walking into it is camping
    expect(whoMovesIn({ ...ruin, room: 0 }, [place({ village: 'Oakcross', people: 30, room: 20 })], 60)).toBeNull();
  });
});

describe('the one move a day', () => {
  const settled = (people: number, food: number, purse: number, founded: number, emptied?: number) => ({
    people: Array.from({ length: people }, () => ({ purse })),
    food, founded, emptied,
  });

  it('picks an empty village and a village that can spare somebody', () => {
    const villages: Array<[string, ReturnType<typeof settled>]> = [
      ['Thornby', settled(0, 0, 0, 12, 10)],
      ['Oakcross', settled(30, 40, 2, 22)],
    ];
    expect(whoWalksIn(villages, 40)).toEqual({ to: 'Thornby', from: 'Oakcross' });
  });

  it('is nothing at all in a world where everybody is housed and fed', () => {
    const villages: Array<[string, ReturnType<typeof settled>]> = [
      ['Ashford', settled(12, 90, 30, 24)],
      ['Oakcross', settled(14, 90, 30, 26)],
    ];
    expect(whoWalksIn(villages, 40)).toBeNull();
  });

  it('moves one village at a time, because a valley that repopulates overnight is a respawn', () => {
    const villages: Array<[string, ReturnType<typeof settled>]> = [
      ['Thornby', settled(0, 0, 0, 12, 10)],
      ['Blackmarsh', settled(0, 0, 0, 12, 10)],
      ['Oakcross', settled(30, 40, 2, 22)],
    ];
    const walk = whoWalksIn(villages, 40);
    expect(walk).not.toBeNull();
    expect(['Thornby', 'Blackmarsh']).toContain(walk!.to);
  });
});

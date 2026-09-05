import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Register } from '../world/register';
import { gossipFor } from './gossip';
import { MINES, Mines, claimedMines, mineIdOf, type Working } from './mines';

const CAVE = { id: 'cave:10,10', name: 'Bat Hollow', x: 10, z: 10 };
const MINE = mineIdOf(CAVE);

/** One village at one mine, with the next village along close enough to hear about it. */
const working = (heardIn: string[] = ['Ashford']): Working =>
  ({ village: 'Ashford', mine: MINE, name: CAVE.name, x: CAVE.x, z: CAVE.z, heardIn });

/** A village where everybody grown works underground, so the crew is never nought by accident. */
const village = (seed = 1): Register => {
  const register = new Register(seed);
  register.settle('Ashford', 6, ['miner']);
  register.settle('Thinby', 4, ['farmer']);
  return register;
};

const purseOf = (register: Register, name = 'Ashford'): number =>
  Math.round(register.living(name).reduce((sum, p) => sum + p.purse, 0));

/** A mine somebody has already been frightened out of, for testing what happens next. */
const alreadyFeared = (dread = 0.85) => ({ day: 1, mines: [{ id: MINE, worked: 0, dread, cleared: 0 }] });

/**
 * The mines are where the world's money is minted, and for a long time nothing called them. The
 * arithmetic in mining.ts was written and tested and unreached, so the game had a source of gold
 * that never produced a coin. This is the part with the map in front of it: which village works
 * which hole, how often, and what everybody round it comes to believe about the place.
 */
describe('the world working its mines', () => {
  it('puts real money into the purses of the people who go down', () => {
    const register = village();
    const mines = new Mines(7, 1);
    expect(purseOf(register)).toBe(0);

    mines.advance(60, [working()], (v) => register.living(v));
    expect(purseOf(register)).toBeGreaterThan(0);
    // and it goes to the miners rather than into the air: a village's money has to sit somewhere
    // that food and upkeep can take it out of again
    expect(register.living('Ashford').filter((p) => p.purse > 0).every((p) => p.trade === 'miner')).toBe(true);
  });

  it('works a day once, however many times it is asked to', () => {
    // The bug this is here for: the mine used to be run from the frame loop with no notion of a
    // day, so a village emptied its seam in about four seconds of standing still and every mine
    // in the world was worked out and terrified before anybody reached it.
    const register = village();
    const mines = new Mines(7, 1);
    mines.advance(20, [working()], (v) => register.living(v));
    const earned = purseOf(register);
    const worked = mines.at(MINE)!.worked;

    for (let again = 0; again < 200; again++) mines.advance(20, [working()], (v) => register.living(v));
    expect(purseOf(register)).toBe(earned);
    expect(mines.at(MINE)!.worked).toBe(worked);
    expect(mines.today).toBe(20);
  });

  it('agrees with another machine that has lived the same days', () => {
    const here = village(), there = village();
    const slowly = new Mines(7, 1), quickly = new Mines(7, 1);
    for (let day = 2; day <= 40; day++) slowly.advance(day, [working()], (v) => here.living(v));
    quickly.advance(40, [working()], (v) => there.living(v));
    expect(slowly.at(MINE)).toEqual(quickly.at(MINE));
    expect(purseOf(here)).toBe(purseOf(there));
  });

  it('lets a mine nobody works calm down on its own', () => {
    // a village with no miners in it still has a mine, and the fear in it still has to fade, or
    // a place that loses its last miner is frightened of that hole for the rest of the world
    const register = village();
    const mines = Mines.from(7, alreadyFeared(), 1);
    mines.advance(60, [{ ...working(), village: 'Thinby' }], (v) => register.living(v));
    expect(mines.at(MINE)!.dread).toBeLessThan(0.85);
    expect(purseOf(register, 'Thinby')).toBe(0);
  });
});

/**
 * Fear is the brake on the whole economy, and until now nobody could hear it being applied. A
 * frightened village works a fraction of the days it would otherwise, which is the difference
 * between a poor place and a comfortable one — so the fright has to reach somebody's mouth.
 */
describe('what people hear about a mine', () => {
  it('carries a bad day at the face into what a villager will tell you', () => {
    const register = village();
    const mines = new Mines(7, 1);
    const digs = mines.advance(60, [working(['Ashford', 'Thinby'])], (v) => register.living(v));
    const scare = digs.filter((d) => d.scared).at(-1)!;
    expect(scare, 'sixty days at an ordinary mine should frighten somebody').toBeTruthy();

    const teller = register.living('Ashford').find((p) => p.memories.some((m) => m.what === 'feared'))!;
    const said = gossipFor(teller, register, scare.day, mulberry32(1)).news;
    expect(said).toContain(CAVE.name);
  });

  it('carries it to the next village along, so it can be heard where it did not happen', () => {
    // the point of this: you can be warned off a hole in the ground by somebody in a pub who has
    // never seen it, which is how anybody ever finds out about anywhere
    const register = village();
    const mines = new Mines(7, 1);
    mines.advance(60, [working(['Ashford', 'Thinby'])], (v) => register.living(v));

    const neighbour = register.living('Thinby').find((p) => p.memories.some((m) => m.what === 'feared'));
    expect(neighbour, 'nobody in the next village had heard').toBeTruthy();
    expect(gossipFor(neighbour!, register, 60, mulberry32(1)).small.length).toBeGreaterThan(0);
  });

  it('leaves most of a village able to talk about something else', () => {
    // nobody holds more than a couple of memories. Telling everybody would push the deaths out of
    // the village's head, and the deaths are the more important news
    const register = village();
    const mines = new Mines(7, 1);
    mines.advance(60, [working()], (v) => register.living(v));
    const carrying = register.living('Ashford').filter((p) => p.memories.some((m) => m.what === 'feared'));
    expect(carrying.length).toBeLessThanOrEqual(MINES.TOLD);
  });
});

/**
 * The loop the player is actually in: something lives in the mine, it can be killed, and killing
 * it makes the village richer — but only once somebody has walked back in and said so. Both
 * halves have to be there. Fear fades at a fiftieth a day on purpose, so a player who clears a
 * mine and walks away watches nothing happen for a month.
 */
describe('clearing a mine out', () => {
  const cleared = (mines: Mines, many = 8): Mines => {
    for (let n = 0; n < many; n++) mines.slain(MINE);
    return mines;
  };

  it('makes the place safer without changing a single mind', () => {
    const mines = cleared(Mines.from(7, alreadyFeared(), 1));
    expect(mines.perilOf(MINE)).toBe(0);
    expect(mines.at(MINE)!.dread, 'the village was not there and does not know').toBe(0.85);
    expect(mines.saidOf(MINE)).toContain('Nobody');
  });

  it('counts nothing for a swing that landed somewhere else', () => {
    const mines = new Mines(7, 1);
    mines.slain(null, 20);                        // above ground, or in a vault that is not a mine
    expect(mines.perilOf(MINE)).toBeGreaterThan(0);
  });

  it('changes their minds when somebody goes back and tells them', () => {
    const mines = cleared(Mines.from(7, alreadyFeared(), 1));
    expect(mines.told(MINE, CAVE.name)).toContain(CAVE.name);
    expect(mines.at(MINE)!.dread).toBe(0);
    expect(mines.saidOf(MINE)).toBe('');
    // and saying it a second time is not news
    expect(mines.told(MINE, CAVE.name)).toBeNull();
  });

  it('tells them nothing worth hearing about a mine that was never cleared', () => {
    const mines = Mines.from(7, alreadyFeared(), 1);
    expect(mines.told(MINE, CAVE.name)).toBeNull();
    expect(mines.at(MINE)!.dread).toBe(0.85);
  });

  it('is worth real money to the village, and worth more for being said out loud', () => {
    // measured over three weeks, which is the window that matters: fear fades on its own inside
    // about six, so a test run over a season would find the three ending up in the same place and
    // would have nothing to say about whether any of this was worth doing
    const run = (make: (mines: Mines) => void): number => {
      const register = village();
      const mines = Mines.from(7, alreadyFeared(), 1);
      make(mines);
      mines.advance(20, [working()], (v) => register.living(v));
      return purseOf(register);
    };
    const frightened = run(() => {});
    const quiet = run((m) => cleared(m));
    const told = run((m) => { cleared(m); m.told(MINE, CAVE.name); });

    expect(quiet).toBeGreaterThan(frightened);
    expect(told).toBeGreaterThan(quiet * 1.25);
    expect(told).toBeGreaterThan(frightened * 2);
  });
});

describe('which village works which hole', () => {
  const VILLAGES = [{ name: 'Ashford', x: 0, z: 0 }, { name: 'Thinby', x: 40, z: 0 }];

  it('gives a cave to the village it is on the doorstep of', () => {
    const caves = [{ id: 'a', name: 'Bat Hollow', x: 36, z: 0 }];
    expect(claimedMines(VILLAGES, caves).get('Thinby')?.id).toBe('a');
    expect(claimedMines(VILLAGES, caves).has('Ashford')).toBe(false);
  });

  it('never lets two villages work the same seam', () => {
    // both would take a full day's gold out of it and the mine would empty at twice the rate
    // anybody watching it could account for
    const caves = [{ id: 'a', name: 'Bat Hollow', x: 20, z: 0 }];
    const claimed = claimedMines(VILLAGES, caves);
    expect([...claimed.values()].length).toBe(1);
  });

  it('tells apart two caves the world happened to give the same name', () => {
    // cave names repeat around the world; the ids do not, which is why a mine is keyed by anchor
    const caves = [{ id: 'a', name: 'Bat Hollow', x: 4, z: 0 }, { id: 'b', name: 'Bat Hollow', x: 44, z: 0 }];
    const claimed = claimedMines(VILLAGES, caves);
    expect(mineIdOf(claimed.get('Ashford')!)).not.toBe(mineIdOf(claimed.get('Thinby')!));
  });

  it('leaves a village with nothing in reach without a mine', () => {
    expect(claimedMines(VILLAGES, [{ id: 'a', name: 'Far', x: 9000, z: 0 }]).size).toBe(0);
  });

  it('does not depend on the order the world happens to list things in', () => {
    const caves = [{ id: 'a', name: 'One', x: 5, z: 0 }, { id: 'b', name: 'Two', x: 38, z: 0 }];
    const forwards = claimedMines(VILLAGES, caves);
    const backwards = claimedMines([...VILLAGES].reverse(), [...caves].reverse());
    expect([...backwards].sort()).toEqual([...forwards].sort());
  });
});

describe('a mine surviving being walked away from', () => {
  it('remembers the seam, the fear and the fighting through a save', () => {
    const register = village();
    const mines = new Mines(7, 1);
    mines.advance(30, [working()], (v) => register.living(v));
    mines.slain(MINE, 4);

    const back = Mines.from(7, JSON.parse(JSON.stringify(mines.save())));
    expect(back.at(MINE)).toEqual(mines.at(MINE));
    expect(back.perilOf(MINE)).toBe(mines.perilOf(MINE));
    expect(back.today).toBe(30);
  });

  it('keeps a cave that has been fought through but never worked', () => {
    // otherwise an afternoon spent clearing a mine out is thrown away by closing the tab, and the
    // village goes on being frightened of a hole with nothing left in it
    const mines = new Mines(7, 1);
    mines.slain(MINE, 8);
    expect(Mines.from(7, JSON.parse(JSON.stringify(mines.save()))).perilOf(MINE)).toBe(0);
  });

  it('starts today rather than owing a year of shifts, for a save from before mines existed', () => {
    const register = village();
    const mines = Mines.from(7, undefined, 300);
    expect(mines.advance(300, [working()], (v) => register.living(v))).toEqual([]);
    expect(purseOf(register)).toBe(0);
  });
});

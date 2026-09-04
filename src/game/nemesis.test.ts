import { describe, expect, it } from 'vitest';
import villain from '../../behaviours/villain.json';
import { compileAll, type BehaviourFile } from '../core/behaviourFile';
import { CREATURE_VERBS, rollSeconds } from '../entities/verbs';
import { canBeCut } from '../entities/monsters';
import { VILLAIN_KINDS } from '../entities/villain';
import { Biome } from '../world/biomes';
import { KINDS } from '../entities/animals';
import { Register } from '../world/register';
import { StructureKind, type Structure, type Village } from '../world/structures';
import type { Person } from '../world/people';
import { Jail } from './jail';
import {
  NEMESIS, Nemesis, SENDS, WANTS, heardOfHim, knocked, planFor, ruinsFor, sentBy, type Realm, type Tool,
} from './nemesis';

/** A house, in as much detail as any of this cares about: there is one, and it has a door. */
const house = (n: number): Structure => ({
  kind: StructureKind.House, tx: n * 4, tz: 0, hw: 1, hd: 1, level: 0, rot: 0, biome: Biome.Plains, path: [],
});

/** A village on paper: a name, somewhere on the road, and a station on the street. */
const village = (name: string, x: number): Village => ({
  name, board: null, x, z: 0, radius: 20, level: 0, biome: Biome.Plains,
  houses: [house(0)], shops: [], pub: null,
  station: { house: house(0), doorX: x, doorZ: 0 },
  church: null, churchDoor: null, stalls: [],
});

/** Everything he can reach: two lawful villages, and everybody who lives in them. */
function country(seed = 7) {
  const villages = [village('Oakford', 0), village('Ashmere', 60)];
  const register = new Register(seed);
  for (const v of villages) register.settle(v.name, 8, ['constable', 'farmer', 'soldier']);
  const jail = new Jail();
  const him = new Nemesis(seed);
  const realm: Realm = { register, jail, villages, hero: 'You' };
  return { villages, register, jail, him, realm };
}

type Country = ReturnType<typeof country>;

/** Wind the world on to the day he settles somewhere, and hand back what he settled on. */
function abroad(c: Country, day = NEMESIS.FIRST) {
  c.him.advance(day, c.realm);
  const scheme = c.him.scheme;
  expect(scheme, 'he should be out there by now').not.toBeNull();
  return scheme!;
}

const namesIn = (c: Country, village: string): string[] => c.register.living(village).map((p) => p.name);
const everyTool: Tool[] = ['boat', 'shovel', 'horse', 'sword'];

describe('which village he settles on', () => {
  it('rolls the same schemes in the same order from the same seed', () => {
    const places = ['Oakford', 'Ashmere', 'Farfield', 'Nether Cray']
      .map((name, i) => ({ name, biome: Biome.Plains, level: i % 3 }));
    const run = (seed: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => planFor(seed, places, n));

    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    // and every one of them is a place that exists, doing something the country has a word for
    for (const plan of run(7)) {
      expect(places.map((p) => p.name)).toContain(plan.village);
      expect(WANTS[plan.ruin]).toBeDefined();
    }
  });

  it('gives two clients of one world the same schemes without a word passing between them', () => {
    const said = (c: Country): string[] => {
      const words: string[] = [];
      for (let day = 1; day <= NEMESIS.FIRST + 8; day++) words.push(...c.him.advance(day, c.realm).map((w) => w.said));
      return words;
    };
    expect(said(country(11))).toEqual(said(country(11)));
    expect(said(country(11))).not.toEqual(said(country(12)));
  });

  it('leaves the country alone until the first scheme is due', () => {
    const c = country();
    expect(c.him.advance(NEMESIS.FIRST - 1, c.realm)).toEqual([]);
    expect(c.him.quiet).toBe(true);
    expect(c.him.scheme).toBeNull();
    expect(c.him.advance(NEMESIS.FIRST, c.realm).map((w) => w.kind)).toEqual(['scheme']);
    expect(c.him.whereabouts).toBe('abroad');
  });
});

describe('what a scheme costs the place it settles on', () => {
  it('takes a named person out of the village every couple of days', () => {
    const c = country();
    const scheme = abroad(c);
    const before = namesIn(c, scheme.village);

    const words = c.him.advance(NEMESIS.FIRST + NEMESIS.TOLL_EVERY * 3, c.realm);
    const taken = words.filter((w) => w.kind === 'taken');

    expect(taken.length).toBe(3);
    const after = namesIn(c, scheme.village);
    expect(after.length).toBe(before.length - 3);
    for (const word of taken) {
      expect(before, 'he took somebody who was never alive').toContain(word.who);
      expect(after).not.toContain(word.who);
      expect(word.village).toBe(scheme.village);
    }
  });

  it('counts the toll off the day it started, so arriving late costs exactly the same', () => {
    const steady = country();
    const scheme = abroad(steady);
    for (let day = NEMESIS.FIRST; day <= NEMESIS.FIRST + 10; day++) steady.him.advance(day, steady.realm);

    const late = country();
    abroad(late);
    late.him.advance(NEMESIS.FIRST + 10, late.realm);

    expect(namesIn(late, scheme.village)).toEqual(namesIn(steady, scheme.village));
  });
});

describe('beating him', () => {
  it('offers the choice and settles nothing whatever', () => {
    const c = country();
    const scheme = abroad(c);
    const before = namesIn(c, scheme.village);

    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, [])!;
    expect(choice).not.toBeNull();
    expect(choice.village).toBe(scheme.village);
    expect(choice.wants).toBe(WANTS[scheme.ruin]);
    expect(choice.atStake.length).toBe(NEMESIS.AT_STAKE);
    for (const name of choice.atStake) expect(before).toContain(name);

    // nobody buried, nobody held, and the question still open
    expect(namesIn(c, scheme.village)).toEqual(before);
    expect(c.jail.everyone(NEMESIS.FIRST)).toEqual([]);
    expect(c.him.whereabouts).toBe('choosing');

    // and it does not answer itself while the clock still has a second on it
    expect(c.him.tick(NEMESIS.CHOOSING - 1, c.realm, NEMESIS.FIRST)).toBeNull();
    expect(namesIn(c, scheme.village)).toEqual(before);
    expect(c.him.choice).not.toBeNull();
  });

  it('is a fight that ends short of killing him, whatever hits him', () => {
    expect(knocked(1)).toBe(true);
    expect(knocked(100)).toBe(false);

    const c = country();
    abroad(c);
    expect(c.him.beaten(c.realm, NEMESIS.FIRST, everyTool)).not.toBeNull();
    expect(c.him.alive).toBe(true);
    c.him.chase(c.realm, NEMESIS.FIRST);
    expect(c.him.alive).toBe(true);
  });

  it('cannot be beaten while he is not out there to beat', () => {
    const c = country();
    expect(c.him.beaten(c.realm, 3, everyTool)).toBeNull();
    abroad(c);
    c.him.beaten(c.realm, NEMESIS.FIRST, everyTool);
    expect(c.him.beaten(c.realm, NEMESIS.FIRST, everyTool), 'beaten twice over one fight').toBeNull();
  });
});

describe('going after him', () => {
  it('puts him behind a named door and leaves the people in the water there', () => {
    const c = country();
    const scheme = abroad(c);
    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, everyTool)!;
    const before = namesIn(c, scheme.village);

    const out = c.him.chase(c.realm, NEMESIS.FIRST)!;

    expect(out.jailed).toBe(true);
    expect(out.cell).not.toBe('');
    const held = c.jail.holds(out.cell, NEMESIS.FIRST)!;
    expect(held.who).toBe(NEMESIS.NAME);
    expect(held.hero, 'the cell is holding a name, not the player').toBe(false);
    expect(out.until).toBe(NEMESIS.FIRST + NEMESIS.HELD_DAYS);

    expect(out.saved).toEqual([]);
    expect(out.lost.sort()).toEqual([...choice.atStake].sort());
    const after = namesIn(c, scheme.village);
    for (const name of out.lost) {
      expect(before).toContain(name);
      expect(after).not.toContain(name);
    }
    expect(c.him.whereabouts).toBe('held');
  });

  it('goes quiet while the country has him', () => {
    const c = country();
    abroad(c);
    c.him.beaten(c.realm, NEMESIS.FIRST, everyTool);
    const out = c.him.chase(c.realm, NEMESIS.FIRST)!;
    const after = namesIn(c, out.cell);

    for (let day = NEMESIS.FIRST + 1; day < NEMESIS.FIRST + NEMESIS.BROKEN_AFTER; day++) {
      expect(c.him.advance(day, c.realm), `something happened on day ${day}`).toEqual([]);
    }
    expect(c.him.quiet).toBe(true);
    expect(namesIn(c, out.cell)).toEqual(after);
  });
});

describe('going to them instead', () => {
  it('saves named people who remember who came, and lets him walk away', () => {
    const c = country();
    const scheme = abroad(c);
    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, everyTool)!;

    const out = c.him.help(c.realm, NEMESIS.FIRST)!;

    expect(out.lost).toEqual([]);
    expect(out.saved.sort()).toEqual([...choice.atStake].sort());
    expect(out.jailed).toBe(false);
    expect(c.jail.everyone(NEMESIS.FIRST)).toEqual([]);

    const living = c.register.living(scheme.village);
    for (const name of out.saved) {
      const person = living.find((p: Person) => p.name === name);
      expect(person, `${name} was saved and is not alive`).toBeDefined();
      expect(person!.memories[0]).toMatchObject({ what: 'saved', who: 'You', day: NEMESIS.FIRST });
    }
    expect(c.him.whereabouts).toBe('lull');
  });

  it('reaches only some of them when the thing it wanted was at home', () => {
    const c = country();
    const scheme = abroad(c);
    // every tool but the one this ruin asks for: turning up is not the same as turning up ready
    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, everyTool.filter((t) => t !== WANTS[scheme.ruin]))!;
    expect(choice.ready).toBe(false);

    const out = c.him.help(c.realm, NEMESIS.FIRST)!;
    expect(out.saved.length).toBe(Math.floor(NEMESIS.AT_STAKE * NEMESIS.BAREHANDED));
    expect(out.lost.length).toBe(NEMESIS.AT_STAKE - out.saved.length);
    expect([...out.saved, ...out.lost].sort()).toEqual([...choice.atStake].sort());
  });

  it('gives both to somebody who paid for a sword arm before they needed one', () => {
    const c = country();
    abroad(c);
    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, everyTool, 'Greta Vos')!;
    expect(choice.holder).toBe('Greta Vos');

    const out = c.him.help(c.realm, NEMESIS.FIRST)!;
    expect(out.saved.length).toBe(NEMESIS.AT_STAKE);
    expect(out.lost).toEqual([]);
    expect(out.jailed).toBe(true);
    expect(c.jail.holds(out.cell, NEMESIS.FIRST)?.who).toBe(NEMESIS.NAME);
    expect(out.said).toContain('Greta Vos');
  });

  it('drowns them and loses him when nobody answers in time', () => {
    const c = country();
    const scheme = abroad(c);
    const choice = c.him.beaten(c.realm, NEMESIS.FIRST, everyTool)!;

    expect(c.him.tick(NEMESIS.CHOOSING / 2, c.realm, NEMESIS.FIRST)).toBeNull();
    const out = c.him.tick(NEMESIS.CHOOSING, c.realm, NEMESIS.FIRST)!;

    expect(out.jailed).toBe(false);
    expect(out.lost.sort()).toEqual([...choice.atStake].sort());
    for (const name of out.lost) expect(namesIn(c, scheme.village)).not.toContain(name);
    expect(c.him.choice).toBeNull();
  });
});

describe('the break-out', () => {
  it('comes on its day and not one before it, and takes the constable with it', () => {
    const c = country();
    abroad(c);
    c.him.beaten(c.realm, NEMESIS.FIRST, everyTool);
    const cell = c.him.chase(c.realm, NEMESIS.FIRST)!.cell;

    // one man with the keys, so there is no doubt afterwards about who was holding him
    const keeper = c.register.living(cell)[0];
    for (const person of c.register.living(cell)) person.trade = person === keeper ? 'constable' : 'farmer';

    const early = NEMESIS.FIRST + NEMESIS.BROKEN_AFTER - 1;
    expect(c.him.advance(early, c.realm)).toEqual([]);
    expect(c.him.whereabouts).toBe('held');
    expect(c.jail.holds(cell, early)?.who).toBe(NEMESIS.NAME);

    const due = NEMESIS.FIRST + NEMESIS.BROKEN_AFTER;
    const [word] = c.him.advance(due, c.realm);

    expect(word.kind).toBe('brokenOut');
    expect(word.who).toBe(keeper.name);
    expect(namesIn(c, cell), 'the constable is still walking about').not.toContain(keeper.name);
    expect(c.jail.holds(cell, due)).toBeNull();
    expect(c.jail.lawless(cell, due), 'the station should be a heap').toBe(true);
    expect(c.him.whereabouts).toBe('lull');
    // and he was out before the fortnight the court gave him was anywhere near up
    expect(NEMESIS.BROKEN_AFTER).toBeLessThan(NEMESIS.HELD_DAYS);
  });

  it('comes back to work after the quiet, whichever way the last one ended', () => {
    const paths = {
      taken: (c: Country, day: number) => c.him.chase(c.realm, day),
      helped: (c: Country, day: number) => c.him.help(c.realm, day),
      lapsed: (c: Country, day: number) => c.him.tick(NEMESIS.CHOOSING, c.realm, day),
    };

    for (const [name, resolve] of Object.entries(paths)) {
      const c = country();
      const first = abroad(c);
      c.him.beaten(c.realm, NEMESIS.FIRST, everyTool);
      resolve(c, NEMESIS.FIRST);

      // long enough for a cell to be broken open and the country to forget about him
      let day = NEMESIS.FIRST;
      for (let n = 0; n < NEMESIS.BROKEN_AFTER + NEMESIS.BETWEEN + 1; n++) c.him.advance(++day, c.realm);

      expect(c.him.alive, `${name} finished him`).toBe(true);
      expect(c.him.whereabouts, `${name} left him gone for good`).toBe('abroad');
      expect(c.him.scheme!.number).toBe(first.number + 1);
    }
  });
});

describe('what a villager already knew', () => {
  it('says he gets out, in whichever mouth you ask, before he has ever done it here', () => {
    const c = country();
    expect(c.him.whereabouts).toBe('lull');           // nothing has happened yet, and it is still sayable

    const places = c.villages.map((v) => ({ name: v.name, biome: v.biome, level: v.level }));
    const tellers = c.register.living('Oakford').map((p) => p.id);
    const said = tellers.map((who) => heardOfHim(11, who, places.map((p) => p.name)));

    for (const line of said) {
      expect(line).toContain(NEMESIS.NAME);
      expect(line.length).toBeGreaterThan(40);
    }
    expect(new Set(said).size, 'every villager tells it the same way').toBeGreaterThan(1);
    expect(heardOfHim(11, tellers[0], places.map((p) => p.name)), 'a person changed their story').toBe(said[0]);
  });
});

describe('putting him down and picking him up again', () => {
  it('remembers where he is up to, and forgets a countdown nobody was watching', () => {
    const c = country();
    abroad(c);
    c.him.beaten(c.realm, NEMESIS.FIRST, everyTool);
    expect(c.him.whereabouts).toBe('choosing');

    const back = Nemesis.from(7, JSON.parse(JSON.stringify(c.him.toJSON())));
    expect(back.whereabouts).toBe('abroad');          // the fight is still there to be won
    expect(back.choice).toBeNull();
    expect(back.scheme).toEqual(c.him.scheme);

    c.him.chase(c.realm, NEMESIS.FIRST);
    const held = Nemesis.from(7, JSON.parse(JSON.stringify(c.him.toJSON())));
    expect(held.whereabouts).toBe('held');
    expect(held.cell).toBe(c.him.cell);
  });
});

describe('the man in the field', () => {
  it('has a tree that compiles against the verbs the game already declares', () => {
    const trees = compileAll(villain as unknown as BehaviourFile, CREATURE_VERBS, rollSeconds);
    expect(Object.keys(trees)).toEqual(Object.keys(VILLAIN_KINDS));   // a kind with nothing to decide for it
    for (const tree of Object.values(trees)) expect(typeof tree).toBe('function');
    expect((JSON.stringify(villain).match(/"note"/g) ?? []).length).toBeGreaterThan(3);
  });

  it('is a fight rather than a wall, and there is never a moment to go through his coat', () => {
    const him = VILLAIN_KINDS.nettle;
    expect(canBeCut(him), 'a blade has to work on him or the choice never arrives').toBe(true);
    expect(him.runSpeed).toBeLessThan(5.5);          // the hero's own pace: he never gets away by being quicker
    expect(him.gold).toBeUndefined();
    expect(him.drop).toBeUndefined();
    expect(him.palettes.length, 'there is one of him').toBe(1);
    expect(knocked(him.hp!, him.hp), 'a full-health villain is not a beaten one').toBe(false);
  });
});

/**
 * What he sends is most of what anybody ever fights, and where he sends it has to be somewhere
 * the disaster could plausibly happen. Both were missing when the rest of him was built.
 */
describe('what he sends, and where', () => {
  it('sends more of his lot the longer a scheme is left to run', () => {
    const scheme = { village: 'Oakford', work: 'well' as const, ruin: 'beasts' as const, number: 0, began: 10 };
    const early = sentBy(scheme, 10);
    const later = sentBy(scheme, 10 + NEMESIS.SENDS_EVERY * 3);
    expect(early, 'somebody is always there').toBeGreaterThanOrEqual(1);
    expect(later, 'and more of them if nobody comes').toBeGreaterThan(early);
    expect(later, 'but never more than the work calls for').toBeLessThanOrEqual(SENDS.well.most);
  });

  it('sends a different sort of trouble for a different piece of work', () => {
    const kinds = new Set(Object.values(SENDS).map((s) => s.kind));
    expect(kinds.size, 'three works, three problems').toBe(3);
    for (const work of ['well', 'nightmen', 'fever'] as const) {
      expect(SENDS[work].most, work).toBeGreaterThan(0);
      expect(KINDS[SENDS[work].kind], `${work} sends something that exists`).toBeDefined();
    }
  });

  it('never sends a rockslide down at a village with nothing above it', () => {
    // a disaster nobody can believe is a disaster nobody minds
    const flat = { name: 'Saltings', biome: Biome.Desert, level: 0 };
    const steep = { name: 'Cragfoot', biome: Biome.Mountain, level: 3 };
    expect(ruinsFor(flat)).not.toContain('rockslide');
    expect(ruinsFor(steep)).toContain('rockslide');
    expect(ruinsFor(flat), 'nor a flood in a desert').not.toContain('flood');
    expect(ruinsFor({ name: 'Coldwick', biome: Biome.Snow, level: 0 }), 'nor a fire in the snow')
      .not.toContain('fire');
  });

  it('can always loose something on anybody, whatever the ground', () => {
    for (const biome of [Biome.Desert, Biome.Snow, Biome.Swamp, Biome.Mountain, Biome.Plains, Biome.Forest]) {
      expect(ruinsFor({ name: 'x', biome, level: 0 }).length, String(biome)).toBeGreaterThan(0);
    }
  });
});

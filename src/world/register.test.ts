import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { LIFE, ageOf, firstNameOf, stageOf, surnameOf, type Person } from './people';
import { FORTUNE } from './fortunes';

const TRADES = ['farmer', 'hunter', 'seller'];
const settle = (register: Register, houses = 6): readonly Person[] => register.settle('Ashford', houses, TRADES);

/**
 * The two things worth pinning are the ones the rest of the game leans on: two players who have
 * never spoken hold the same village, and nobody is left pointing at somebody who no longer exists.
 */
describe('the village register', () => {
  it('founds the same families from the same seed, and different ones from another', () => {
    const one = settle(new Register(1));
    const again = settle(new Register(1));
    const elsewhere = settle(new Register(2));

    expect(one.map((p) => p.name)).toEqual(again.map((p) => p.name));
    expect(one.map((p) => p.name)).not.toEqual(elsewhere.map((p) => p.name));
  });

  it('founds a village of mixed ages rather than a single cohort', () => {
    const people = settle(new Register(1), 8);
    const ages = people.map((p) => ageOf(p, 1));

    expect(Math.max(...ages) - Math.min(...ages)).toBeGreaterThan(LIFE.CHILD_UNTIL);
    expect(new Set(people.map((p) => stageOf(p, 1))).size).toBeGreaterThan(1);
  });

  it('gives children their parents by name, and parents to nobody else', () => {
    const people = settle(new Register(3), 8);
    const children = people.filter((p) => p.mother !== '');

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(people.some((p) => p.name === child.mother)).toBe(true);
      expect(stageOf(child, 1)).not.toBe('adult');
    }
  });

  it('never puts two people with the same name in one village, whatever the seed or its size', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const houses of [4, 5, 6, 8, 10]) {
        const register = new Register(seed);
        register.settle('Crossroads Town', houses, TRADES);
        const shared = (when: string): void => {
          const names = register.living('Crossroads Town').map((p) => p.name);
          expect(names.filter((n, at) => names.indexOf(n) !== at), `seed ${seed}, ${houses} houses, ${when}`).toEqual([]);
        };

        shared('as founded');                     // the founding families
        register.advance(40); shared('after 40 days');
        register.advance(120); shared('after 120 days');   // by now the founders are gone
      }
    }
  });

  it('gives each household in a village its own family name', () => {
    const register = new Register(30);
    const surnames = settle(register, 10).map(surnameOf);
    const households = new Map<string, Set<string>>();
    for (const person of settle(register, 10)) {
      households.set(surnameOf(person), (households.get(surnameOf(person)) ?? new Set()).add(firstNameOf(person)));
    }
    // as many distinct surnames as there are houses, and nobody sharing a first name under one roof
    expect(new Set(surnames).size).toBeGreaterThan(1);
    for (const [surname, given] of households) {
      const under = settle(register, 10).filter((p) => surnameOf(p) === surname);
      expect(given.size, `${surname}: ${under.map((p) => p.name).join(', ')}`).toBe(under.length);
    }
  });

  it('has nobody know more people than a person can hold in mind', () => {
    for (const person of settle(new Register(4), 10)) {
      expect(person.knows.length).toBeLessThanOrEqual(LIFE.KNOWS);
      expect(person.knows).not.toContain(person.id);
    }
  });

  it('reaches the same village from the same day, on two machines that never spoke', () => {
    const here = new Register(7); settle(here);
    const there = new Register(7); settle(there);

    here.advance(120);
    there.advance(120);
    expect(here.living('Ashford').map((p) => p.id)).toEqual(there.living('Ashford').map((p) => p.id));
  });

  it('arrives at the same village whether the days are taken one at a time or all at once', () => {
    const slowly = new Register(8); settle(slowly);
    const quickly = new Register(8); settle(quickly);

    for (let day = 2; day <= 90; day++) slowly.advance(day);
    quickly.advance(90);
    expect(slowly.living('Ashford').map((p) => p.id)).toEqual(quickly.living('Ashford').map((p) => p.id));
  });

  it('shows a latecomer the same village as somebody who was there from the start', () => {
    const early = new Register(40); settle(early);
    early.advance(50);

    const late = new Register(40);
    late.advance(50);                             // never set foot in the place until now
    settle(late);

    expect(late.living('Ashford').map((p) => `${p.name} ${p.born}`))
      .toEqual(early.living('Ashford').map((p) => `${p.name} ${p.born}`));
  });

  it('does not let a village found late die of old age on arrival', () => {
    const register = new Register(41);
    register.advance(60);                         // a lifetime has passed before anybody goes there
    expect(settle(register).length).toBeGreaterThan(0);
    expect(register.living('Ashford').every((p) => p.born > -60)).toBe(true);
  });

  it('keeps a village going instead of letting it empty out', () => {
    const register = new Register(9);
    const founded = settle(register).length;

    register.advance(400);                        // several lifetimes
    const now = register.living('Ashford').length;
    expect(now).toBeGreaterThan(founded / 2);
    expect(now).toBeLessThanOrEqual(founded);
  });

  it('replaces people killed by wolves faster than it replaces nobody', () => {
    const register = new Register(10);
    const village = settle(register);
    const founded = village.length;

    for (const victim of village.slice(0, Math.floor(founded / 3))) register.bury(victim.id, 1);
    expect(register.living('Ashford').length).toBeLessThan(founded);

    register.advance(20);
    expect(register.living('Ashford').length).toBe(founded);
  });

  it('leaves the dead in the memory of the people who knew them, and nowhere else', () => {
    const register = new Register(11);
    const village = settle(register);
    const victim = village.find((p) => register.knownTo(p.id).length > 0);
    expect(victim).toBeDefined();

    const mourners = register.knownTo(victim!.id);
    const change = register.bury(victim!.id, 5);

    expect(change).toEqual(expect.objectContaining({ kind: 'died', name: victim!.name, cause: 'violence' }));
    expect(register.find(victim!.id)).toBeUndefined();
    for (const mourner of mourners) {
      expect(mourner.knows).not.toContain(victim!.id);
      expect(mourner.memories[0]).toEqual({ what: 'died', who: victim!.name, day: 5 });
    }
  });

  it('never leaves anybody knowing somebody who is not there', () => {
    const register = new Register(12);
    settle(register);
    register.advance(300);

    const here = new Set(register.everybody().map((p) => p.id));
    for (const person of register.everybody()) {
      for (const known of person.knows) expect(here.has(known)).toBe(true);
    }
  });

  it('gives a child a trade when they come of age, and not before', () => {
    const register = new Register(20);
    settle(register);
    register.advance(200);

    for (const person of register.everybody()) {
      const grown = stageOf(person, 200) === 'adult';
      expect(person.trade === '' ? 'no trade' : 'a trade').toBe(grown ? 'a trade' : 'no trade');
      if (grown) expect(TRADES).toContain(person.trade);
    }
  });

  it('lets somebody born after their parents have died still come to know people', () => {
    const register = new Register(21);
    settle(register);
    register.advance(300);                        // long enough that nobody founding is left

    const orphans = register.everybody().filter((p) => p.born > 200);
    expect(orphans.length).toBeGreaterThan(0);
    for (const orphan of orphans) {
      if (stageOf(orphan, 300) === 'baby') continue;
      expect(orphan.knows.length).toBeGreaterThan(0);
    }
  });

  it('knows the difference between a village in trouble and one that is finished', () => {
    const register = new Register(60);
    const village = settle(register);
    expect(register.fortune('Ashford')).toBe('well');

    const kill = (n: number): void => {
      for (const victim of [...register.living('Ashford')].slice(0, n)) register.bury(victim.id, 1);
    };
    kill(Math.ceil(village.length * 0.4));
    expect(register.fortune('Ashford')).toBe('struggling');
    kill(Math.ceil(register.living('Ashford').length * 0.6));
    expect(register.fortune('Ashford')).toBe('failing');
  });

  it('will not refill a village that is past saving, however long it is left', () => {
    const register = new Register(61);
    const village = settle(register);
    for (const victim of [...village].slice(0, village.length - 1)) register.bury(victim.id, 1);
    expect(register.fortune('Ashford')).toBe('failing');

    register.advance(60);
    expect(register.living('Ashford').length, 'a failing village must not heal itself').toBeLessThan(3);
  });

  it('says so, once, on the day a village loses its last soul', () => {
    const register = new Register(62);
    const village = settle(register);
    for (const victim of [...village]) register.bury(victim.id, 1);

    const lost = register.advance(3).filter((c) => c.kind === 'lost');
    expect(lost.map((c) => c.village)).toEqual(['Ashford']);
    expect(register.fortune('Ashford')).toBe('lost');
    expect(register.advance(20).filter((c) => c.kind === 'lost')).toEqual([]);
  });

  it('lets a neighbour put people back into a ruin, but not straight away', () => {
    const register = new Register(63);
    settle(register);
    register.settle('Fernmoor', 9, TRADES);           // a bigger place, with people to spare
    for (const victim of [...register.living('Ashford')]) register.bury(victim.id, 1);
    register.advance(3);

    expect(register.resettle('Ashford', 'Fernmoor', 5), 'too soon').toEqual([]);
    const moved = register.resettle('Ashford', 'Fernmoor', 3 + FORTUNE.RESETTLE_AFTER);
    expect(moved.length).toBeGreaterThan(0);
    expect(register.living('Ashford').length).toBe(moved.length);
    expect(register.fortune('Ashford')).not.toBe('lost');
    // and it cost the neighbour the people it sent, so a region does not quietly heal itself
    for (const settler of moved) {
      expect(register.living('Fernmoor').some((p) => p.id === settler.id)).toBe(false);
    }
  });

  it('will not let a neighbour beggar itself to resettle a ruin', () => {
    const register = new Register(64);
    settle(register);
    register.settle('Thinby', 4, TRADES);
    for (const victim of [...register.living('Ashford')]) register.bury(victim.id, 1);
    // thin the neighbour out until it has nobody spare
    const thin = register.living('Thinby');
    for (const person of [...thin].slice(0, Math.floor(thin.length / 2))) register.bury(person.id, 1);
    register.advance(3);

    expect(register.resettle('Ashford', 'Thinby', 3 + FORTUNE.RESETTLE_AFTER)).toEqual([]);
  });

  it('holds only the living, so what is saved cannot grow without bound', () => {
    const register = new Register(13);
    const founded = settle(register).length;

    register.advance(1000);                       // a dozen generations
    expect(register.save()['Ashford'].length).toBeLessThanOrEqual(founded);
  });

  it('carries a death across to a player who was not there to see it', () => {
    const here = new Register(14); settle(here);
    const there = new Register(14); settle(there);

    const change = here.bury(here.living('Ashford')[0].id, 3);
    there.apply(change!);
    expect(there.find(change!.id)).toBeUndefined();
    expect(there.living('Ashford').map((p) => p.id)).toEqual(here.living('Ashford').map((p) => p.id));
  });

  it('reaches the same village as a player who saw a killing days before they heard of it', () => {
    const there = new Register(50); settle(there);
    there.advance(10);
    const killed = there.living('Ashford')[3];
    const news = there.bury(killed.id, 10)!;
    there.advance(40);

    // the other player was elsewhere, heard nothing, and only gets the news on day 40
    const here = new Register(50); settle(here);
    here.advance(40);
    here.apply(news);

    expect(here.living('Ashford').map((p) => p.id)).toEqual(there.living('Ashford').map((p) => p.id));
    expect(here.find(killed.id)).toBeUndefined();
  });

  it('takes no notice of the same death twice', () => {
    const register = new Register(51); settle(register);
    const news = register.bury(register.living('Ashford')[0].id, 1)!;
    const after = register.living('Ashford').map((p) => p.id);

    register.apply(news);
    expect(register.living('Ashford').map((p) => p.id)).toEqual(after);
  });

  it('keeps no more memories than a person can carry, newest first', () => {
    const register = new Register(15);
    const village = settle(register);
    const mourner = village.find((p) => p.knows.length >= 3)!;

    for (const [day, known] of mourner.knows.slice(0, 3).entries()) register.bury(known, day + 1);
    expect(mourner.memories.length).toBe(LIFE.REMEMBERS);
    expect(mourner.memories[0].day).toBeGreaterThan(mourner.memories[1].day);
  });
});

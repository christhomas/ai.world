import { describe, expect, it } from 'vitest';
import { fallIll, illnessEvening } from './ailments';
import { walkOver } from './movingon';
import type { Person } from './people';
import type { Settlement } from './settlement';
import { Register } from './register';

const person = (id: string, ill?: number): Person => ({
  id, name: id, village: 'Oak', sex: 'woman', trade: 'farmer', born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 20, hungry: 0, ill,
});

const rolls = (...values: number[]) => {
  let next = 0;
  return () => values[next++ % values.length];
};

describe('contact transmission', () => {
  it('spreads from a sick neighbour above the spontaneous rate, without changing the two-roll budget', () => {
    const people = [person('sick', 4), person('contact')];
    let used = 0;
    const rng = () => { used++; return used === 3 ? 0.1 : 0.99; };
    fallIll(people, rng, { baths: false, day: 2 });
    expect(people[1].ill).toBeGreaterThan(0);
    expect(used).toBe(4);

    const isolated = [person('sick', 4), person('contact')];
    fallIll(isolated, rolls(0.99, 0.99, 0.1, 0.99), { baths: false, day: 2, contacts: false });
    expect(isolated[1].ill).toBeUndefined();
  });

  it('uses yesterday’s sick snapshot, so a new case cannot infect another person in the same pass', () => {
    const people = [person('sick', 4), person('first'), person('second')];
    fallIll(people, rolls(0.99, 0.99, 0.05, 0.99, 0.2, 0.99), { baths: false, day: 2 });
    expect(people[1].ill).toBeGreaterThan(0);
    expect(people[2].ill).toBeUndefined();
  });

  it('bathhouse hygiene suppresses both spontaneous and contact infections', () => {
    const plain = [person('sick', 4), person('contact')];
    const bathed = [person('sick', 4), person('contact')];
    fallIll(plain, rolls(0.99, 0.99, 0.14, 0.99), { baths: false, day: 2 });
    fallIll(bathed, rolls(0.99, 0.99, 0.14, 0.99), { baths: true, day: 2 });
    expect(plain[1].ill).toBeGreaterThan(0);
    expect(bathed[1].ill).toBeUndefined();
  });

  it('carries an existing illness with resettlers into another village', () => {
    const people = [person('sick', 4), person('healthy'), person('third'), person('fourth'), person('fifth'), person('sixth')];
    const source = { people, founded: 4 } as Settlement;
    const destination = { people: [], founded: 6, emptied: 1 } as unknown as Settlement;
    const moved = walkOver('Pine', destination, source, 20);
    expect(moved).toHaveLength(2);
    expect(destination.people[0].ill).toBe(4);
    expect(destination.people[0].village).toBe('Pine');
    fallIll(destination.people, rolls(0.99, 0.99, 0.1, 0.99), { baths: false, day: 21 });
    expect(destination.people[1].ill).toBeGreaterThan(0);
  });

  it('lets a one-day case spend a full following workday ill before recovery', () => {
    const people = [person('contact')];
    illnessEvening(people, rolls(0, 0), { baths: false, day: 2 });
    expect(people[0].ill).toBe(1);
    illnessEvening(people, rolls(0.99, 0.99), { baths: false, day: 3 });
    expect(people[0].ill).toBeUndefined();
  });

  it('replays the same outbreak when a village is founded late from its seed', () => {
    const early = new Register(23, 1);
    early.settle('Ashford', 8, ['farmer', 'doctor']);
    early.advance(90);
    const late = new Register(23, 90);
    late.settle('Ashford', 8, ['farmer', 'doctor']);
    const health = (book: Register) => book.living('Ashford')
      .map((p) => [p.id, p.ill ?? 0, p.hurt ?? 0, p.hungry])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(health(late)).toEqual(health(early));
  });

  it('replays contact outcomes after a historical death fact is delivered late', () => {
    const early = new Register(42, 1);
    const doomed = early.settle('Ashford', 8, ['farmer', 'doctor'])[0];
    early.advance(60);
    const fact = { kind: 'died' as const, id: doomed.id, name: doomed.name,
      village: 'Ashford', day: 10, cause: 'violence' as const };
    expect(early.apply(fact)).toBe(true);

    const replay = new Register(42, 60);
    expect(replay.apply(fact)).toBe(true);
    replay.settle('Ashford', 8, ['farmer', 'doctor']);
    const shape = (book: Register) => book.living('Ashford')
      .map((p) => [p.id, p.ill ?? 0, p.purse, p.hungry])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(shape(replay)).toEqual(shape(early));
  });
});

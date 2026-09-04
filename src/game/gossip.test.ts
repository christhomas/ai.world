import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Register } from '../world/register';
import { stageOf } from '../world/people';
import { gossipFor } from './gossip';

const TRADES = ['farmer', 'hunter', 'seller'];
const village = (seed: number): Register => {
  const register = new Register(seed);
  register.settle('Ashford', 6, TRADES);
  return register;
};

/**
 * The point of this module is that a death is only ever heard about from somebody who was there,
 * so what is tested is that the news reaches you and that nobody says anything they cannot know.
 */
describe('what a villager will tell you', () => {
  it('leads with a death somebody is still carrying', () => {
    const register = village(1);
    const people = register.living('Ashford');
    const victim = people.find((p) => register.knownTo(p.id).length > 0)!;
    const mourner = register.knownTo(victim.id)[0];

    register.bury(victim.id, 3);
    const talk = gossipFor(mourner, register, 4, mulberry32(1));
    expect(talk.news).toContain(victim.name);
    expect(talk.news).toContain('died');
    expect(talk.news).toContain('yesterday');
  });

  it('only calls it a hard week when more than one person has gone', () => {
    const register = village(7);
    const people = register.living('Ashford');
    const mourner = people.find((p) => p.knows.length >= 2)!;
    const [first, second] = mourner.knows.map((id) => register.find(id)!);

    register.bury(first.id, 3);
    expect(gossipFor(mourner, register, 3, mulberry32(1)).news).not.toContain('hard week');
    register.bury(second.id, 3);
    expect(gossipFor(mourner, register, 3, mulberry32(1)).news).toContain('hard week');
  });

  it('stops leading with it once it is old news', () => {
    const register = village(2);
    const victim = register.living('Ashford').find((p) => register.knownTo(p.id).length > 0)!;
    const mourner = register.knownTo(victim.id)[0];

    register.bury(victim.id, 3);
    expect(gossipFor(mourner, register, 30, mulberry32(1)).news).toBeNull();
  });

  it('says a living mother is about the village and a dead one is not', () => {
    const register = village(3);
    const child = register.living('Ashford').find((p) => p.mother !== '')!;
    const mother = register.living('Ashford').find((p) => p.name === child.mother)!;

    expect(gossipFor(child, register, 1, mulberry32(1)).small.join(' ')).toContain('You will find her');
    register.bury(mother.id, 2);
    expect(gossipFor(child, register, 2, mulberry32(1)).small.join(' ')).toContain('She is gone now');
  });

  it('names their family, and only people who are actually there', () => {
    const register = village(4);
    for (const person of register.living('Ashford')) {
      const said = gossipFor(person, register, 1, mulberry32(7)).small.join(' ');
      const named = [...said.matchAll(/[A-Z][a-z]+ [A-Z][a-z]+/g)].map((m) => m[0]);
      for (const name of named) {
        const known = register.living('Ashford').some((p) => p.name === name) || name === person.mother;
        expect(known, `${person.name} spoke of ${name}, who is nowhere`).toBe(true);
      }
    }
  });

  it('points you at somebody worth meeting, by their trade', () => {
    const register = village(5);
    const talker = register.living('Ashford').find((p) => p.knows.length > 0)!;
    const said = gossipFor(talker, register, 1, mulberry32(3)).small.join(' ');
    expect(said).toMatch(/is your one|underfoot|keep to myself/);
  });

  it('has a child say they are a child', () => {
    const register = village(6);
    const child = register.living('Ashford').find((p) => stageOf(p, 1) === 'child')!;
    expect(gossipFor(child, register, 1, mulberry32(1)).small).toContain('I am not allowed past the fence yet.');
  });
});

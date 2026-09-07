import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '../core/config';
import { BEHAVIOUR, type Entity } from '../entities/entity';
import { createBlows, type Fighting } from './blows';

/**
 * The moment of grace a blow buys you, and the fact that it has to end.
 *
 * Being hit makes the hero briefly untouchable, because without it a pack lands every one of its
 * bites in the same instant and a hero at full health dies before the screen has finished
 * flashing. The grace is counted down each frame — and for a long time it was counted down in only
 * one of the three places the hero can be. Out of doors it expired; in a mine or a building it
 * never did, so one bite from a rat made you immortal for the rest of the visit. A mine you cannot
 * be hurt in is no more of a fight than one you cannot swing in, which was the same bug wearing
 * the other shoe.
 */

/** A wolf, close enough and facing you. */
function biter(): Entity {
  return {
    x: 1, z: 0, yaw: 0, hurt: 0, winding: 0, warned: false, dead: false, attackCooldown: 0,
    kind: { label: 'wolf', behaviour: 'prowl' },
  } as unknown as Entity;
}

/** Everything `onAttack` reaches for, and nothing else, with the blows counted as they land. */
function aFight() {
  let hp = 100;
  const landed: number[] = [];
  const hero = { x: 0, z: 0, yaw: 0, hurt: 0, blow: 'swing', walk: 0 } as unknown as Entity;
  const ctx = {
    seed: 1,
    state: { damage: (d: number) => { hp -= d; landed.push(d); return hp <= 0; } },
    player: { entity: hero, get x() { return hero.x; }, get z() { return hero.z; }, shove: () => {} },
    places: { indoors: null, underground: null },
    breath: { answer: () => 'hit' as const },
    magic: { ward: 0 },
    sailing: { sailing: false, overboard: false },
    skies: { aloft: false },
    sound: { thud: () => {}, chime: () => {}, voice: () => {}, splash: () => {} },
    director: { saw: () => {} },
    talking: () => false,
    typing: () => false,
    flash: () => {},
    hurt: () => {},
  } as unknown as Fighting;
  const blows = createBlows(ctx);
  return { blows, landed, get hp() { return hp; } };
}

describe('the grace a blow buys', () => {
  it('turns the next blow aside, and then wears off', () => {
    const fight = aFight();
    fight.blows.onAttack(biter(), 10);
    expect(fight.landed, 'the first bite lands').toEqual([10]);

    // the pack behind it swings in the same instant, and that one does not
    fight.blows.onAttack(biter(), 10);
    expect(fight.landed, 'still one').toEqual([10]);

    // half a second of frames, which is not quite long enough
    for (let i = 0; i < 5; i++) fight.blows.cooled(0.1);
    fight.blows.onAttack(biter(), 10);
    expect(fight.landed, `${GAMEPLAY.REELING}s has not passed`).toEqual([10]);

    // and now it is
    fight.blows.cooled(0.1);
    fight.blows.onAttack(biter(), 10);
    expect(fight.landed, 'the wolf gets its second bite').toEqual([10, 10]);
  });

  it('is counted down before the frame decides where the hero is standing', () => {
    // The unit above proves the clock runs. This proves it is wound in the one place that every
    // frame goes through, which is the half that was actually broken: `cooled` used to sit at the
    // bottom of the out-of-doors path, past the returns that end an indoor frame and an
    // underground one, so in a mine or a room it was never called at all. Reading the source is
    // the honest way to check that, because the bug was never in this file — it was in where this
    // file's method was called from.
    const frame = readFileSync(new URL('./frame.ts', import.meta.url), 'utf8').split('\n');
    const counted = frame.findIndex((line) => line.includes('blows.cooled(dt)'));
    const firstReturn = frame.findIndex((line, i) => i > 0 && /^\s+return;$/.test(line));
    const branch = frame.findIndex((line) => line.includes('const indoors = places.indoors'));
    expect(counted, 'the frame counts a blow down').toBeGreaterThan(-1);
    expect(counted, 'before it picks which kind of frame this is').toBeLessThan(branch);
    expect(counted, 'and before anything can return early').toBeLessThan(firstReturn);
    expect(frame.filter((line) => line.includes('blows.cooled(')).length, 'once, not once per shape').toBe(1);
  });

  it('leaves the hero facing whatever bit them', () => {
    const fight = aFight();
    const wolf = biter();
    wolf.x = 0; wolf.z = -4;   // behind, if the hero is looking down +z
    fight.blows.onAttack(wolf, 5);
    expect(fight.hp).toBe(95);
    expect(BEHAVIOUR.HURT_TIME).toBeGreaterThan(0);
  });
});

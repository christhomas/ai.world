import { describe, expect, it } from 'vitest';
import { FOOD } from './food';
import { growWorld } from './growworld';
import { aDaysTrade } from './livelihoods';
import { Register } from './register';
import { TerrainSampler } from './terrain';
import { TREES } from './biomes';
import { FIELD, farmsteadOf, fieldOfWork, foodAt } from './fields';
import { whichFieldClears } from './fieldbuilds';
import type { Village } from './structures';
import { WORLD } from '../core/config';

function livedFields(seed: number): { register: Register; sampler: TerrainSampler; village: Village } {
  const sampler = new TerrainSampler(growWorld(seed, 'road'));
  const village = sampler.structures.villages.find((place) => place.houses.length >= 6)!;
  const register = new Register(seed);
  const people = register.settle(village.name, village.houses.length, ['farmer', 'builder', 'seller']);
  register.fieldsAreSurveyedBy((name, settlement) =>
    name === village.name ? whichFieldClears(village, settlement, sampler) : null);
  for (const person of people) person.purse = 1_000;
  register.advance(20);
  return { register, sampler, village };
}

describe('bounded local field clearing', () => {
  it('replays the same nearby trees on both halves', () => {
    const page = livedFields(4321);
    const world = livedFields(4321);
    expect(page.register.worksOf(page.village.name)).toEqual(world.register.worksOf(world.village.name));

    const holdings = page.register.madeOf(page.village.name).holdings ?? [];
    const clearings = page.register.worksOf(page.village.name)
      .map(fieldOfWork)
      .filter((field): field is NonNullable<typeof field> => field !== null);
    expect(clearings.length, JSON.stringify(page.register.worksOf(page.village.name))).toBeGreaterThan(0);

    for (const clearing of clearings) {
      const holding = holdings.find((one) => one.id === clearing.holding)!;
      const home = farmsteadOf(page.village, holding, page.register.living(page.village.name));
      expect(home, `${clearing.holding} has no local farmstead`).not.toBeNull();
      expect(Math.hypot(home!.tx - clearing.x, home!.tz - clearing.z)).toBeLessThanOrEqual(FIELD.REACH);
      const side = WORLD.CHUNK_SIZE;
      const cx = Math.floor(clearing.x / side), cz = Math.floor(clearing.z / side);
      const chunk = page.sampler.generateChunk(cx, cz);
      const lx = clearing.x - cx * side, lz = clearing.z - cz * side;
      expect(TREES).toContain(chunk.prop[(lz + 1) * chunk.size + lx + 1]);
    }
  });

  it('adds only the bounded permanent crop to a worked holding', () => {
    const works = Array.from({ length: FIELD.MOST + 3 }, (_, n) => `field:farm-1:${n},0`);
    expect(foodAt(works, 'farm-1')).toBe(FIELD.MOST * FIELD.FOOD);

    const run = livedFields(4321);
    const people = run.register.living(run.village.name);
    const holdings = run.register.madeOf(run.village.name).holdings ?? [];
    const plain = aDaysTrade(people, 0, 0, { holdings, works: [] });
    const improved = aDaysTrade(people, 0, 0, {
      holdings,
      works: run.register.worksOf(run.village.name),
    });
    const gain = holdings.reduce(
      (sum, holding) => sum + (holding.kind === 'farm' ? foodAt(run.register.worksOf(run.village.name), holding.id) : 0),
      0,
    );
    expect(improved.grown - plain.grown).toBe(gain);
    expect(gain).toBeLessThanOrEqual(holdings.filter((holding) => holding.kind === 'farm').length
      * FIELD.MOST * FIELD.FOOD);
    expect(FOOD.PER_FARMER + FIELD.MOST * FIELD.FOOD).toBe(8);
  });
});

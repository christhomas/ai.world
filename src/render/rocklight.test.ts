import { describe, expect, it } from 'vitest';
import { skyGives, snowNeeds } from './mountains';

/**
 * The rock is bright enough to be rock, and the snow is where a mountain keeps it.
 *
 * Both of these are about a picture, so neither can be proved here. What can be held is the
 * arithmetic that picture turned on — the two numbers somebody would otherwise quietly put back.
 */
describe('a mountain that belongs to the country it stands in', () => {
  it('gives a wall back most of what the sun cannot reach it with', () => {
    /*
     * The massif and the ground are both `MeshLambertMaterial`. A tile faces the sky and takes the
     * whole of the sun; a rock face at sixty degrees takes about half. At midday the massif came
     * out three times darker than the field at its foot — correct, and it read as a hole cut in
     * the country.
     *
     * A vertical wall (n.y = 0) therefore gets the whole of `UPRIGHT` and a level ledge gets none
     * of it, which is roughly the shape of what the sky gives each.
     */
    const wall = 1 + skyGives(0);
    const ledge = 1 + skyGives(1);
    expect(ledge).toBe(1);
    expect(wall).toBeGreaterThan(1.4);
    expect(wall, 'brighter than the ground it stands on is not rock either').toBeLessThan(1.8);
  });

  it('lets snow lie on a summit, which is the steepest part of any mountain', () => {
    /*
     * A summit is a cone. Under the old rule a face had to be level enough to hold snow wherever it
     * stood — `n.y > 0.35` — so the one part of a mountain that should be white was the part most
     * certainly excluded. The higher it stands the less flat it has to be.
     */
    expect(snowNeeds(0.62), 'at the snow line a face still has to be a ledge').toBeGreaterThan(0.3);
    expect(snowNeeds(1), 'at the peak a wall will do').toBeCloseTo(0, 5);
    expect(snowNeeds(0.8)).toBeLessThan(snowNeeds(0.7));
    expect(snowNeeds(0.3), 'below the snow line the question does not arise').toBeGreaterThan(0.3);
  });
});

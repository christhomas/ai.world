import { describe, expect, it } from 'vitest';
import { describeResult } from '../core/commandbus';
import type { Doorway } from '../world/structures';
import { doorsNear } from './doors-near';

/** `doors` at the console (#684): the nearest doors, where to stand, and what each opens. */
describe('the doors nearest somebody', () => {
  const door = (x: number, z: number, village: string, kind: Doorway['kind'] = 'house'): Doorway =>
    ({ x, z, bx: x + 1, bz: z, kind, village });

  it('lists the nearest first, as few as asked, with the doorstep and the building', () => {
    const near = doorsNear([door(40, 0, 'Far'), door(3, 4, 'Near', 'church'), door(10, 0, 'Mid')], 0.5, 0.5, undefined, 2);
    expect(near.map((d) => d.name)).toEqual(['church in Near', 'house in Mid']);
    expect(near[0]).toEqual({ name: 'church in Near', away: 5, x: 3, z: 4, bx: 4, bz: 4 });
  });

  it('narrows to a kind of building or a village when asked', () => {
    const doors = [door(3, 4, 'Near', 'store'), door(5, 0, 'Near'), door(30, 0, 'Blackby', 'store')];
    expect(doorsNear(doors, 0, 0, 'store').map((d) => d.name)).toEqual(['store in Near', 'store in Blackby']);
    expect(doorsNear(doors, 0, 0, ' BLACK ').map((d) => d.name)).toEqual(['store in Blackby']);
    expect(doorsNear(doors, 0, 0, 'castle')).toEqual([]);
  });

  it('reads in the console as one door a line, which is what the device playtest parses', () => {
    expect(describeResult(doorsNear([door(3, 4, 'Near')], 0, 0))).toEqual(['house in Near — away 6, x 3, z 4, bx 4, bz 4']);
  });
});

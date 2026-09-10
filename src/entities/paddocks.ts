import { WORLD } from '../core/config';
import { KINDS } from './animals';
import type { Herd } from './entity';
import type { Village } from '../world/structures';
import type { SpawnCtx } from './manager';

/**
 * What is standing in a village's paddock.
 *
 * Out of the manager because a paddock is a fixture of a village rather than a thing the manager
 * decides — and because that file reached the length a person can hold in their head on the day the
 * trades were given bodies of their own. The seam is real: nothing here asks about wildlife, about
 * chunks, or about who is standing where; it asks a village what it keeps.
 */

/** What this needs of the manager: the villages, and a way to stand a herd up. */
export interface Yard {
  villages: readonly Village[];
  place: (
    ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number,
    scatter?: number, bodyFor?: (n: number) => string,
  ) => Herd;
}

  /**
   * What is standing in a village's paddock.
   *
   * With the people rather than with the wildlife, and so on both sides of a shared world: these
   * are as much a fixture of the village as the man who keeps them, decided by where the village
   * was laid out rather than by a roll of the day. Two of the country's own animal and one of the
   * other, which is enough to read as a paddock with animals in it from the road and few enough
   * that they are not walking through each other in a seven-tile yard.
   */
export function spawnPaddocks(o: Yard, ctx: SpawnCtx): void {
    const CS = WORLD.CHUNK_SIZE;
    for (const v of o.villages) {
      const yard = v.stable;
      if (!yard) continue;
      if (Math.floor(yard.x / CS) !== ctx.tiles.cx || Math.floor(yard.z / CS) !== ctx.tiles.cz) continue;
      // inside the rails, not on them: the fence blocks walking, and a goat standing in one looks
      // like a goat that has been dropped into it
      const room = Math.max(1, yard.half - 1);
      yard.stock.forEach((kindId, n) => {
        if (!KINDS[kindId]) return;
        const herd = o.place(ctx, kindId, [yard.x + 0.5, yard.z + 0.5], n === 0 ? 2 : 1, room, room);
        herd.tag = v.name;
      });
    }
  }

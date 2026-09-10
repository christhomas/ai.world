import { WORLD } from '../core/config';
import { KINDS } from './animals';
import type { Herd, TileWorld } from './entity';
import type { Village } from '../world/structures';
import type { SpawnCtx } from './manager';
import { postsOf } from './villagers';

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
  /** The ground, because where a village's field is is read off the land rather than declared. */
  world: TileWorld;
  /** How many head the register says this village keeps. Nought where nothing is known about it. */
  herdOf: (village: string) => number;
}

/** What a village's cattle look like from the road. */
export const CATTLE = {
  /**
   * The most beasts drawn at once, however many the books say.
   *
   * Ten. A village with four farmers keeps two dozen on the register, and two dozen cows in one
   * field is a feedlot rather than a farm — and it is two dozen bodies to think for beside a place
   * that already has villagers, wildlife and a road through it. Ten reads as "a lot of cattle" from
   * the distance this camera watches from, which is the whole of what the number has to buy.
   */
  MOST_SHOWN: 10,
  /** How far they spread from the middle of the field. Room to graze, close enough to read as one herd. */
  SPREAD: 5,
  /** And how far they may drift off it, which is a field rather than a fence. */
  LEASH: 9,
} as const;

/**
 * A village's cattle, standing in its field.
 *
 * The other half of item 7. `livelihoods.ts` has a herd that calves, feeds the village and pays
 * the farmers for the meat the next valley buys — all of it true, all of it written down, and none
 * of it ever drawn, which is the same fault the mines had before the crews went in: you could walk
 * out to the field a village lives off and find grass.
 *
 * The count is the register's own, so the beasts in the field are the beasts in the books. That is
 * worth being exact about: a village whose farmers have all been buried loses its herd inside a
 * fortnight, and what a player sees on the walk out there is the field emptying.
 *
 * Put at the `field` post, which is the same spot the farmer's own day sends him to at dawn —
 * read off the land by `postsOf` rather than declared, so the man and the cattle cannot end up in
 * different places. A village with no field in reach keeps no cattle anybody can see.
 */
function spawnCattle(o: Yard, ctx: SpawnCtx): void {
  const CS = WORLD.CHUNK_SIZE;
  for (const v of o.villages) {
    // filed under the chunk the village is in rather than the chunk the field is in, so the herd
    // is swept when the village is: a field can straddle a boundary and a herd on the far side of
    // one would outlive everything it belongs to
    if (Math.floor(v.x / CS) !== ctx.tiles.cx || Math.floor(v.z / CS) !== ctx.tiles.cz) continue;
    const many = Math.min(CATTLE.MOST_SHOWN, Math.round(o.herdOf(v.name)));
    if (many <= 0) continue;
    const field = postsOf(v, o.world).field;
    if (!field) continue;
    const herd = o.place(ctx, 'cow', field, many, CATTLE.LEASH, CATTLE.SPREAD);
    // whose they are, which is what makes killing one rustling rather than hunting
    herd.tag = v.name;
  }
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
function spawnPaddocks(o: Yard, ctx: SpawnCtx): void {
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

/**
 * Everything a village keeps on four legs: what is in the yard, and what is out in the field.
 *
 * One call rather than two, because they are one question asked of one village and the caller has
 * no reason to be able to do half of it. They are separate functions behind this so that each can
 * be read and tested on its own — a paddock is laid out by the village's own plan and a herd is
 * counted off the register, and neither of those has anything to say about the other.
 */
export function spawnLivestock(o: Yard, ctx: SpawnCtx): void {
  spawnPaddocks(o, ctx);
  spawnCattle(o, ctx);
}

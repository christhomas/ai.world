import { WORLD } from '../core/config';
import { doorTile, type Village } from '../world/structures';
import type { Person } from '../world/people';
import type { Herd, Post, TileWorld } from './entity';
import { SPAWN } from './spawning';
import { bodyForTrade, pickTrade } from './trades';
import { postsOf } from './villagers';
import type { SpawnCtx } from './manager';

/**
 * Who a village has out on its street today, and where each of them stands.
 *
 * Out of the manager for the same reason `paddocks.ts` came out of it, and it is the other half of
 * the same idea: what a village keeps in its yard, and who a village has out of doors. Both are
 * fixtures of the place rather than rolls of the day, decided by where the village was laid out and
 * by who the register says is alive, which is why they sit side by side in `spawnChunk`.
 *
 * They used to sit *above* the line where the wildlife starts, and be spawned whether or not a world
 * was telling this client what lives where. The argument was that a village is the seed and the
 * register and every machine already agrees about it — true right up until a villager was given
 * something of his own to remember, at which point it was two men of the same name in two different
 * moods. This runs in one place now: the world that holds the villages calls it, and everybody else
 * is told. A page with nothing behind it calls it itself and is the world, which is what playing
 * alone has always been.
 *
 * The seam is real: nothing in here asks about chunks, about wildlife, or about what is near the
 * hero. It asks a village who it has, and puts them where their day would have them. What it
 * cannot answer for itself it is handed — who is alive, not already outside and not away in
 * somebody's pay is a question about the register, and the register belongs to the manager.
 */

/** What this needs of the manager: the villages, the ground, and the few things only it can answer. */
export interface Street {
  villages: readonly Village[];
  /**
   * The ground the village stands on. A working day is read off the land — a shore only where
   * there is water, heights only where it climbs — so `postsOf` needs the world to answer at all.
   */
  world: TileWorld;
  place: (
    ctx: SpawnCtx, kindId: string, anchor: [number, number], count: number, leash: number,
    scatter?: number, bodyFor?: (n: number) => string,
  ) => Herd;
  /** The people a village would have out today, given who is alive and who is already outside. */
  residentsFor: (
    v: Village, posts: Partial<Record<Post, [number, number]>>, wanted: number,
  ) => Person[];
  /** Whether this village keeps a stable, which is what makes one of them a stablehand. */
  hasStable: (village: string) => boolean;
}

/** Villagers on the square (first one is the elder), a congregation by the church, keepers at shop doors. */
export function spawnVillageFolk(o: Street, ctx: SpawnCtx): void {
  const CS = WORLD.CHUNK_SIZE;
  const inChunk = (x: number, z: number) => Math.floor(x / CS) === ctx.tiles.cx && Math.floor(z / CS) === ctx.tiles.cz;
  for (const v of o.villages) {
    if (inChunk(v.x, v.z)) {
      // the register first, because a body is chosen before an entity exists and the trade is
      // what chooses it. The stablehand is the one the register does not name: keeping the horses
      // is a job handed out here rather than a trade somebody is born to

      const posts = postsOf(v, o.world);
      const wanted = 2 + Math.floor(ctx.rng() * 3);
      const residents = o.residentsFor(v, posts, wanted);
      const stabled = o.hasStable(v.name);
      const herd = o.place(ctx, 'villager', [v.x, v.z], wanted, Math.max(8, v.radius * 0.7),
        SPAWN.SCATTER, (n) => (n === 1 && stabled ? 'cowboy' : bodyForTrade(residents[n]?.trade)));
      herd.tag = v.name;
      if (herd.members.length > 0) herd.members[0].role = 'elder';
      // one of them keeps the horses, in the villages that have any
      if (herd.members.length > 1 && stabled) herd.members[1].role = 'stablehand';
      herd.members.forEach((e, i) => {
        const house = v.houses[i % Math.max(1, v.houses.length)];
        const home: [number, number] = house
          ? [doorTile(house)[0] + 0.5, doorTile(house)[1] + 0.5]
          : [v.x, v.z];
        const angle = (i / Math.max(1, herd.members.length)) * Math.PI * 2;
        e.posts = {
          ...posts,
          home,
          work: [v.x + Math.cos(angle) * (v.radius * 0.55), v.z + Math.sin(angle) * (v.radius * 0.55)],
        };
        // the elder and the stablehand have their own reasons to be where they are; everybody
        // else in the village keeps a trade, and their trade keeps their day
        if (e.role === 'none') {
          e.role = 'villager';
          e.trade = pickTrade(posts, ctx.rng);
        }
        // and whoever this is, they are somebody the village register knows by name
        const resident = residents[i];
        if (resident) {
          e.person = resident.id;
          e.name = resident.name;
          if (resident.trade !== '') e.trade = resident.trade;
        }
      });
    }
    if (v.churchDoor && inChunk(v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5)) {
      const herd = o.place(ctx, 'villager', [v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5], 3 + Math.floor(ctx.rng() * 2), SPAWN.CONGREGATION_LEASH);
      herd.tag = v.name;
      for (const e of herd.members) e.role = 'congregation';
    }
    // shopkeepers are inside their shops; the street outside is for villagers
  }
}

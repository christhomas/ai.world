import { WORLD } from '../core/config';
import { doorTile, type Village } from '../world/structures';
import type { Person } from '../world/people';
import type { Herd, Post, TileWorld } from './entity';
import { SPAWN } from './spawning';
import { bodyForTrade, pickTrade } from './trades';
import { postsOf } from './villagers';
import { heartsLeft } from '../world/food';
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
/**
 * How many of a village's people are out on the street at once.
 *
 * It was two to four, whatever the village. A hamlet of two houses and a town of fifteen put the
 * same crowd on the square, which is wrong in both directions at once: the hamlet is a street party
 * and the town is deserted. Reported from the small end — "there are sometimes 20 villagers walking
 * around, but the town has two houses".
 *
 * Drawn from what the place has actually built, because that is the one number that says how big it
 * is: a household is a house, so a village with four houses has four families and perhaps two of
 * them out at any hour. The bounds either side are what keep it a village rather than a diorama —
 * never nobody at all, and never a crowd, because everything else about a village square is built
 * for a handful of people rather than a market day.
 */
export function howManyAreOut(houses: number, roll: number): number {
  const OUT_PER_HOUSE = 0.55;
  const FEWEST = 1, MOST = 7;
  // a whole number of people, with the fraction settled by the roll rather than rounded away: three
  // houses is one or two out depending on the hour, which is what a village looks like
  const share = Math.max(0, houses) * OUT_PER_HOUSE;
  const some = Math.floor(share) + (roll < share - Math.floor(share) ? 1 : 0);
  return Math.max(FEWEST, Math.min(MOST, some));
}

export function spawnVillageFolk(o: Street, ctx: SpawnCtx): void {
  const CS = WORLD.CHUNK_SIZE;
  const inChunk = (x: number, z: number) => Math.floor(x / CS) === ctx.tiles.cx && Math.floor(z / CS) === ctx.tiles.cz;
  for (const v of o.villages) {
    // how many of this village are about today, asked once: the street and the church door are two
    // halves of one crowd rather than two crowds
    const wanted = howManyAreOut(v.houses.length, ctx.rng());
    if (inChunk(v.x, v.z)) {
      // the register first, because a body is chosen before an entity exists and the trade is
      // what chooses it. The stablehand is the one the register does not name: keeping the horses
      // is a job handed out here rather than a trade somebody is born to

      const posts = postsOf(v, o.world);
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
          /*
           * Whoever the register says they are, including when it says they are a child.
           *
           * It used to be `if (resident.trade !== '')`, which reads as care and was the opposite: a
           * body is given a rolled trade a few lines above so that a stranger in a street has a day
           * to follow, and a child kept it because the register had nothing to overwrite it with.
           * The Domesday Book found it within a minute of first rendering — Kees Bakker, nine years
           * old, trade "—", out hunting.
           *
           * An empty trade is the right answer and not a missing one. `treeNameFor` falls through a
           * trade it does not know to the kind's own behaviour, so a child gets the wandering day
           * every villager had before there were trades: about the village, near home, not working.
           */
          e.trade = resident.trade;
          /*
           * And as hungry as the register says he is.
           *
           * Hunger is heart loss — a day without costs one, and the last one costs him the rest —
           * so a man four days without food stands in the street with two hearts on him. Which
           * means the bar over his head is the truth about him and not a separate number, and that
           * his own tree can see it: below three he stops getting on with his day and goes looking
           * for something to eat, the same branch a wounded man takes to the surgery.
           *
           * Never nought. A villager stood up dead is a body that falls over the moment it exists,
           * and whether hunger has killed him is the register's to say at dinner, not the street's
           * to decide on the way past.
           */
          e.hp = Math.max(1, heartsLeft(resident));
        }
      });
    }
    /*
     * And whoever is at the church door — drawn from the same village, not conjured beside it.
     *
     * This was three or four bodies at every church in the world, on top of everybody on the
     * street, and it did not look at the village at all. A hamlet of two houses got a congregation
     * the size of its entire population and then some; count the doctor, the constable and a
     * traveller passing through and the square held twenty people for four families. Reported
     * exactly that way — "there are sometimes 20 villagers walking around, but the town has two
     * houses".
     *
     * Half of what is out on the street, so a church gathers a few of a big village and none at all
     * of a small one. A hamlet's chapel standing empty is right: there is nobody to spare.
     */
    const congregation = Math.min(3, Math.floor(wanted / 2));
    if (congregation > 0 && v.churchDoor && inChunk(v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5)) {
      const herd = o.place(ctx, 'villager', [v.churchDoor[0] + 0.5, v.churchDoor[1] + 0.5], congregation, SPAWN.CONGREGATION_LEASH);
      herd.tag = v.name;
      for (const e of herd.members) e.role = 'congregation';
    }
    // shopkeepers are inside their shops; the street outside is for villagers
  }
}

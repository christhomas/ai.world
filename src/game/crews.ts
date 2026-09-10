import { hash3 } from '../core/rng';
import { DTile, type DungeonMap } from '../dungeon/generate';
import { yawFor, type Entity } from '../entities/entity';
import type { Person } from '../world/people';

/**
 * The crew of a mine, standing in the mine.
 *
 * `mines.ts` has worked every village's hole every day for a long time: a crew of real people off
 * the register goes down, gold comes up and is shared among them to the coin, somebody is
 * frightened, somebody does not come back. All of it true, all of it written down, and none of it
 * ever drawn — `places.enterDungeon` spawns the monsters that make a mine dangerous and has never
 * spawned the people who make it a mine. So you could walk into the workings a village is being
 * made rich and poor by and find nobody at the face, which is the same fault as an economy with no
 * source: the model was right and nothing showed it to anybody.
 *
 * This is the showing. It answers two questions and nothing else — where in a given set of tunnels
 * a person would be standing to cut rock, and how to put the people the ledger says are down there
 * on those spots. Who they are is `Mines.whoIsDown`, because that is a question about the register
 * and belongs beside the ledger that shares out their wages.
 *
 * Nothing here is a source of truth about anybody. Every person handed in came off the register a
 * moment ago and the entity built for them holds their id, so a miner killed, buried or swallowed
 * by the mine is gone from the list the next time anybody asks. There is no roster of miners kept
 * anywhere, and there must not be one.
 */

/** Where a crew stands, and how far apart. Distances in tiles. */
export const CREW = {
  /**
   * How many of a tile's four sides must be rock before somebody would work at it.
   *
   * One is every wall in the place: a corridor is nothing but tiles with one rock side, and the
   * crew would be strung out along the passages like the torches. Three is a dead end, and a cave
   * rarely has four of those to put four men in. Two is a corner — where two walls meet is where a
   * seam is actually cut into, and there are always some.
   */
  CUT_INTO: 2,
  /**
   * How far one man stands from the next.
   *
   * Near enough that walking in you meet a crew rather than one man alone; far enough that
   * `keepBodiesApart` is not shoving them off their own faces all afternoon. Below about three
   * they end up in the same corner and the shoving starts; much above six and a small cave has
   * nowhere left that satisfies it, and men start being dropped.
   */
  APART: 5,
  /**
   * And how far the nearest of them is from the steps you come in on.
   *
   * Nobody works the tile you arrive on. Smaller and you land in the middle of the shift before
   * the place has had a chance to read as a mine at all; much larger and the smallest holes in the
   * world have no room left in them for anybody.
   */
  CLEAR_OF_STAIRS: 6,
  /**
   * How coarsely "how far in" is measured, in tiles, when choosing between faces.
   *
   * Faces are ranked by ring and then by seam, so that a crew is met rather than merely placed.
   * Wide rings and everybody stands at the door; narrow ones and the ranking becomes a plain
   * distance, which puts a man at the nearest scrap of wall whether it is worth cutting or not.
   * Twelve is about a room and a half, so the first ring is the chambers off the entrance.
   */
  RING: 12,
} as const;

/**
 * The spacings tried, in order, and the first that seats the whole crew wins.
 *
 * A cave is grown from a seed and some of them are cramped, so a single spacing means a hole that
 * cannot satisfy it quietly loses miners — and a missing man is invisible, which is the worst kind
 * of wrong. Standing two of them closer together than you would like is a much smaller lie than
 * one of them not being there, so the rule relaxes rather than gives up. The last is a body-width
 * and a bit: below that they are inside one another.
 */
const SPACINGS: readonly number[] = [CREW.APART, CREW.APART / 2, 1.5];

/** The four sides of a tile, which is what "a wall" means to somebody with a pick. */
const AROUND: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * How far into a wall is worth looking before one wall is as good as another.
 *
 * Three tiles is the difference between a partition — a wall with somebody else's room a step
 * behind it — and rock worth spending a day on. Looking only one tile in makes every wall equal,
 * and looking much further makes the whole map one answer, because a cave is mostly rock.
 */
const SEAM: number = 3;

/** How much unbroken rock lies behind one side of a tile, up to `SEAM`. */
function seamBehind(
  at: (x: number, z: number) => DTile, x: number, z: number, [dx, dz]: readonly [number, number],
): number {
  let deep = 0;
  while (deep < SEAM && at(x + dx * (deep + 1), z + dz * (deep + 1)) === DTile.Rock) deep++;
  return deep;
}

/**
 * What a miner is drawn as.
 *
 * The `miner` body: a broader man in a yellow hard hat with a pick hanging off his right arm. It
 * was `villager` until the body existed, on the reasoning that the man at the face is on the
 * register, has a family and will be in the pub tonight — all true, and none of it an argument
 * for drawing him as somebody else. He is the one person in this world whose trade is the whole
 * reason you are looking at him.
 *
 * The pick is why this matters more here than in a street. It is bound to `armR`, and `armR` is
 * what a `swing` turns, so the tool comes over the top with the stroke without anything having to
 * animate it — which means that changing this one word is the difference between a man standing
 * at a wall making a punching motion and a man cutting rock.
 */
const DIGGER = 'miner';

/**
 * The name of the day he follows, in `behaviours/villagers.json`.
 *
 * Deliberately not `miner`, which is his trade. `Entity.trade` is the name of a behaviour tree, and
 * filing this one under the trade itself would give it to every miner standing in a village street
 * as well — a man swinging a pick at the grass outside his own front door. His trade on the
 * register is still `miner` and that is what he is called and what he talks about; this is only
 * what he is doing this afternoon.
 */
export const FACEWORK = 'facework';

/**
 * Which of the manager's lists these go in.
 *
 * `dungeon` and no other name. Every other key is read as a chunk of the country and swept the
 * moment the hero walks two chunks from where it thinks it is; a place is kept for as long as
 * somebody is standing in it, and a floor is a place. A crew filed anywhere else is a crew that
 * exists until the first time you walk down a corridor.
 */
const UNDERGROUND = 'dungeon';

/** Stride between one man's seed and the next, so two at one face never roll the same. */
const APIECE = 7919;

/**
 * As much of a person as putting one at a rock face needs to know.
 *
 * A `Person` off the register satisfies it and is what actually gets handed in — the narrow type
 * is here so that the one line somebody adds to `places.ts` needs one import from this file and
 * not two, and so that a test can stand somebody up without founding a village to do it.
 */
export type Digger = Pick<Person, 'id' | 'name' | 'village'>;

/** One spot at the rock, and the way somebody working it is turned. */
export interface Face {
  /** Tile centres, which is where a body stands. */
  x: number;
  z: number;
  /** Facing the rock he is cutting, because a miner with his back to the seam is scenery. */
  yaw: number;
}

/**
 * The little of an entity manager this needs: one named body, put where it is told.
 *
 * Named as a shape rather than taken as the class so a test can hand in a counter, and so this
 * file does not have to know what a renderer is. `EntityManager` satisfies it as it stands.
 */
export interface Workings {
  spawnPack(
    kindId: string, x: number, z: number, radius: number, seed: number, key?: string, many?: number,
  ): Entity[];
}

/**
 * Where in these tunnels somebody would be cutting rock.
 *
 * Faces rather than rooms. Monsters are put at room centres because a room centre is where you
 * meet something; a miner at a room centre is a man standing about in the middle of a cave, which
 * is the opposite of what he is there for. What is wanted is the far end of a working — a corner,
 * a dead end, the head of a passage — so the tiles are scored by how much rock they touch and the
 * deepest cuts are taken first.
 *
 * Pure in (map, wanted, seed), and the map is itself pure in the anchor's seed, so the same mine
 * seats the same men in the same corners on every machine and every visit. The day is deliberately
 * not in it: a crew that moved every midnight would mean walking out to check something and coming
 * back to a mine full of strangers.
 */
export function facesIn(map: DungeonMap, wanted: number, seed: number): Face[] {
  if (wanted <= 0) return [];
  const { size, tiles } = map;
  // off the edge of the world counts as rock, which is what it is: a face on the boundary is still
  // a face, and treating the outside as open would quietly reject the whole rim of the map
  const at = (x: number, z: number): DTile =>
    (x < 0 || z < 0 || x >= size || z >= size ? DTile.Rock : tiles[z * size + x] as DTile);
  // a chest tile is solid to anything trying to stand on it, so it is not somewhere to put a man
  const barred = new Set(map.chests.map((c) => c.z * size + c.x));
  const [ex, ez] = map.entrance;

  const candidates: Array<{ face: Face; rock: number; deep: number; order: number }> = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      // plain floor only: the stairs, the way down, a doorway and a pool are all somewhere to be
      // rather than somewhere to work, and none of them is a place to leave a man standing
      if (at(x, z) !== DTile.Floor || barred.has(z * size + x)) continue;
      if (Math.hypot(x - ex, z - ez) < CREW.CLEAR_OF_STAIRS) continue;
      // the four sides, started from a different one on every tile, so a room's corners are not
      // all cut the same way round and a crew does not read as four copies of one man
      const spin = hash3(seed, x, z) % AROUND.length;
      const walls = AROUND
        .map((_, i) => AROUND[(i + spin) % AROUND.length])
        .filter(([dx, dz]) => at(x + dx, z + dz) === DTile.Rock);
      if (walls.length < CREW.CUT_INTO) continue;
      // one wall, squarely. Standing on the bisector of a corner was tried first and looked right
      // in a room; in a cave it turns a man to face a diagonal that is open floor, because an
      // inside corner is a notch rather than a corner — so he cut at thin air with a wall on
      // either side of him. He picks the side with the most rock behind it instead, which is what
      // anybody with a pick would do: a wall with a room a tile beyond it is a partition, and this
      // is a seam.
      let cut = walls[0];
      for (const wall of walls) if (seamBehind(at, x, z, wall) > seamBehind(at, x, z, cut)) cut = wall;
      candidates.push({
        face: { x: x + 0.5, z: z + 0.5, yaw: yawFor(cut[0], cut[1]) },
        rock: walls.length,
        // how far in he would be working, in rings rather than tiles — see the sort below
        deep: Math.floor(Math.hypot(x - ex, z - ez) / CREW.RING),
        // a stable shuffle, so two mines with the same shape do not put their men in the same
        // corner of it, and so the answer never depends on the order the tiles were walked in
        order: hash3(seed, x, z),
      });
    }
  }
  /*
   * The best faces, and then the ones somebody would actually walk past.
   *
   * A village keeps one or two miners — the register was tuned that way on purpose, after a version
   * that gave Fernreach five out of twelve adults and made it "a mine with a village" — so a crew
   * is one man in sixteen rooms. Ranked by rock alone he stands wherever the thickest seam happens
   * to be, which is as likely as not the far corner of the last chamber, and a player walks in,
   * meets rats, and leaves believing the workings are abandoned.
   *
   * So depth is a coarse ring rather than a distance: within a ring, the thickest seam still wins,
   * which is what a miner would choose. Between rings, nearer the way in wins, which is what a
   * player would find. Rings rather than raw distance because sorting by distance would put him at
   * the nearest scrap of wall regardless of whether it was worth cutting.
   */
  candidates.sort((a, b) => a.deep - b.deep || b.rock - a.rock || a.order - b.order);

  let best: Face[] = [];
  for (const apart of SPACINGS) {
    const taken: Face[] = [];
    for (const { face } of candidates) {
      if (taken.length === wanted) break;
      if (taken.some((t) => Math.hypot(t.x - face.x, t.z - face.z) < apart)) continue;
      taken.push(face);
    }
    if (taken.length > best.length) best = taken;
    if (best.length === wanted) break;
  }
  return best;
}

/**
 * Put the people who are working this mine today into it, at the faces, cutting.
 *
 * The one call a place has to make. Hand it whoever `Mines.whoIsDown` named and it does the rest;
 * hand it nobody and it does nothing, which is what a shrine, a thicket and a mine the village is
 * too frightened to go near all look like from here.
 *
 * The seed is the anchor's, so it is the same seed the tunnels themselves were grown from and the
 * crew cannot end up laid out for a different cave than the one they are in. Only the floor you
 * walk into is worked: a cave has exactly one — `generateDungeon` gives a descent to vaults alone —
 * so this never has to decide which of three storeys the same four men are on.
 *
 * They are spawned one at a time rather than as a band, because a band scatters round one anchor
 * and these are not a band: they are four separate men at four separate cuts, each with his own
 * patch to potter back to when something knocks him off it.
 */
export function putTheCrewToWork(
  workings: Workings, map: DungeonMap, crew: readonly Digger[], seed: number,
): Entity[] {
  const out: Entity[] = [];
  facesIn(map, crew.length, seed).forEach((face, i) => {
    const person = crew[i];
    // one, exactly: the villager kind travels in twos and threes by nature, and a crew of four
    // asked for as four bands would be a dozen people who are nobody
    const [e] = workings.spawnPack(DIGGER, face.x, face.z, 0, seed + i * APIECE, UNDERGROUND, 1);
    if (!e) return;                      // no standable ground at that cut; he is simply not there
    // stood exactly at the cut rather than scattered near it. The spawn scatters, because that is
    // what makes a herd of deer look like deer, and a man at a rock face is the one case where
    // where he is standing is the whole point
    e.x = face.x;
    e.z = face.z;
    e.yaw = face.yaw;
    e.herd.tag = person.village;         // so anything he says about "here" names the right place
    // he is somebody, and this is the only thing that says so. `talk.ts` reads the id back off the
    // register, which is what gives him a family, a purse, and a line about how the seam is going
    e.person = person.id;
    e.name = person.name;
    e.role = 'villager';
    e.trade = FACEWORK;
    // the tree walks him back to this if anything shoulders him off it, which is the whole reason
    // he has a post rather than simply being placed once and hoped for
    e.posts = { work: [face.x, face.z] };
    out.push(e);
  });
  return out;
}

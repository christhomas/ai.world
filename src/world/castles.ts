import { facing } from './civic';
import { TileType, type TileSample } from './ground';
import { StructureKind } from './kinds';
import type { Structure, Village } from './structures';
import type { TerrainSampler } from './terrain';

/**
 * Where a castle stands, and how the pieces of one are set out on the ground.
 *
 * A castle is the one thing in this world that is not a building on a tile. It is a ward — a
 * levelled, cobbled square of ground — with a wall round the edge of it, a drum tower on each
 * corner and in the middle of each side, a gatehouse in the wall that faces the road, and a keep
 * standing in the yard. Forty-odd structures, laid out here and drawn by `entities/castle.ts`.
 *
 * It is its own file rather than another arm of `structures.ts` for the reason `civic.ts` and
 * `paddock.ts` are: everything here is answered from a patch of ground and a direction, nothing
 * here knows how a village is founded or how a road is laid, and `structures.ts` is within forty
 * lines of the size at which this project stops letting you add to a file.
 *
 * How rare they are is not decided here — that is `landmarks.ts`, which is where the two ways of
 * founding a world live. What is decided here is what ground one will stand on, which turns out to
 * be the rarer of the two conditions by a long way: see `castlePlot`.
 */

/** A castle standing in the world, as everything outside this file needs it. */
export interface Castle {
  /**
   * The anchor everything inside it hangs off, for ever: `castle:<name>`.
   *
   * Named rather than placed, unlike a cave (`cave:<x>,<z>`). A cave is a hole in a particular
   * cliff and two players who find that cliff must find the same hole; a castle is a *place*, with
   * a name people say, and the floors and the treasure inside it belong to the name. It also means
   * the seam with whoever builds the inside is one string and not a coordinate convention.
   */
  id: string;
  name: string;
  /** The middle of the ward: the mark on the map, and what anybody steers for. */
  x: number;
  z: number;
  /** The tile outside the gatehouse — where you stand to go in, and where you are put coming out. */
  gateX: number;
  gateZ: number;
  level: number;
}

/**
 * How big a castle is, in tiles, and why each of these numbers is the one it is.
 *
 * `HALF` is the whole argument, and it was settled by counting rather than by taste. In the world
 * the road tree grows, land is a band about twenty-two tiles wide either side of a road; a plot
 * has to clear the carriageway on one side and stop short of the water on the other, so the window
 * a castle of half-width R can stand in is only a few tiles deep and closes entirely somewhere
 * around R = 10. Surveying every crossroads in three worlds: a plot of twenty-one tiles across
 * found four or six sites in a whole world, most of which had something already standing on them,
 * and two of the three worlds ended up with no castle in them at all. Seventeen across finds
 * twenty to seventy. So the ward is thirteen tiles and the platform under it seventeen.
 *
 * Thirteen tiles is still four cottages wide and the ward alone is nineteen cottages of ground,
 * and none of that is what makes it read as a castle from a hundred paces: the seven towers at
 * fifteen and the keep at twenty-two are. Height is what an isometric camera sells. If this ever
 * wants to be bigger, the thing to widen is the country and not this number.
 */
export const CASTLE = {
  /** Half the ward. The curtain wall runs at ±HALF, so the castle is 2·HALF+1 tiles across. */
  HALF: 6,
  /** Levelled ground outside the wall, which the drum towers overhang and the gate opens onto. */
  APRON: 2,
  /**
   * Terraces of unevenness the plot may start with before it is levelled flat.
   *
   * Two, and it was one, and the difference is a tile of the apron rather than a change of mind.
   * The whole plot is stamped to a single height, so whatever unevenness it had comes out as the
   * step round its edge — one terrace is a stride, two is a wall, and at two a castle on a slope
   * came out standing on a plinth you could not climb from three sides.
   *
   * What makes two safe now is `stampWard`, which no longer stamps the outermost ring of the apron
   * flush with the ward: it sets that ring one terrace towards the country instead, so a
   * two-terrace difference is met as two strides with a tile of standing room between them rather
   * than as one wall. The plinth is what this number used to buy, and it is bought by the doorstep
   * now.
   *
   * The cost of leaving it at one is measured rather than guessed. Once the country gained hills,
   * a nineteen-tile rim within a single terrace stopped being common: castles fell from fifteen
   * across twelve seeds to ten, and seeds 1, 9, 10 and 12 held no castle at all. At two every one
   * of those twelve worlds has one.
   */
  SLACK: 2,
  /**
   * How much rise and fall the plot itself may hold before levelling it would be an act of
   * violence, in terraces.
   *
   * Four, which is two units — the height of a cottage's eaves. Inside the walls the ground is cut
   * and filled flat whatever it was, and that is what a castle site is; what this stops is the
   * castle bulldozing a hillside. At six, one seed put a castle across the shoulder of a ridge and
   * the ward came out as a shelf with a two-storey cliff behind it and nothing to say why.
   */
  CUT: 4,
  /**
   * How far along the wall line a drum tower or the gatehouse covers, either side of its own tile.
   *
   * One, for both, and the temptation is to make it two for the gatehouse because a gatehouse is
   * four tiles wide. Doing that leaves a third of a tile of daylight between the gate's stonework
   * and the first length of curtain wall on each side — a slot you can see through and, at this
   * world's body sizes, walk through. Overlapping is right and looks right: a curtain wall butts
   * into what it meets rather than stopping politely short of it.
   */
  TOWER_REACH: 1,
  GATE_REACH: 1,
  /** How far behind the middle of the ward the keep stands, away from the gate. */
  KEEP_SET: 2,
  /** Clear of any settlement by this much beyond its own radius. */
  VILLAGE_CLEARANCE: 40,
  /**
   * How far off the road a castle is looked for, in tiles, and how big a step the search takes.
   *
   * Off the road, not on it: a castle wants the road in sight and its own walls out of it, and the
   * plot has to clear the carriageway by its whole half-width anyway or the ground test finds a
   * road running through the great hall. The near end is where the plot's own edge clears the
   * carriageway; the far end is where the band of land round a road gives out, which in a
   * road-grown world is around twenty-two tiles. Walking further only spends time discovering that
   * two thirds of the plot is sea.
   */
  OFF_THE_ROAD: 9,
  LOOK_OUT_TO: 30,
  STRIDE: 1,
} as const;

/**
 * What castles are called: a house and a hold, run together.
 *
 * Built as a cross product rather than written out as a list, and that is not laziness. A castle's
 * name *is* its anchor — everything inside one hangs off `castle:<name>`, for ever — so two castles
 * that share a name share their floors and their treasure. A hand-written list of a dozen good
 * names is a dozen ways for that to happen; a hundred and twenty-eight makes it rare. A bounded
 * world takes them without repeating; an endless country takes one from the crossroads' own name,
 * which is the only way two patches of it can agree on what a place is called without either of
 * them knowing what the other found.
 *
 * Rare and not impossible, and it is worth saying which, because how many names there are is not
 * a question that can be settled on its own. A country with no edge holds a castle about every one
 * and three quarter million tiles — eight turned up in fourteen and a half million — and at that
 * spacing two that share a name are usually thousands of tiles apart, further than anybody rides.
 * Usually is the honest word: the first stretch of country surveyed had two Blackgates in it, six
 * hundred tiles apart, and whoever visits both finds the same rooms in each. No finite list avoids
 * that; a longer one only moves the distance. It is the pair of numbers that has to hold, and the
 * other half of the pair is `CROWNED` in `landmarks.ts` — which was measured against this list and
 * left deliberately sparse because of it.
 *
 * The parts are chosen to run together without a doubled letter or a mouthful: "keep" after
 * "Black" and "fast" after "Wolf" were both in here and both had to go.
 */
const HOUSES = [
  'Raven', 'Black', 'Grey', 'Thorn', 'Wolf', 'Storm', 'Ember', 'Harrow',
  'Kestrel', 'Dun', 'Iron', 'Dawn', 'Salt', 'Bramble', 'Frost', 'Crow',
];
const HOLDS = ['gard', 'hold', 'march', 'watch', 'stone', 'reach', 'crag', 'gate'];
export const CASTLE_NAMES: readonly string[] = HOUSES.flatMap((who) => HOLDS.map((what) => `${who}${what}`));

/**
 * Will this patch of ground take a castle, and at what terrace?
 *
 * Not `footprintLevel`, and the difference is the whole of why castles exist at all. A house asks
 * for ground that is *already* flat and gets it, because three tiles by three of one terrace is
 * common. A castle wants seventeen by seventeen, and there is no such thing in this country: asked
 * the house's question, five worlds out of five hold no castle and nothing says why. That was
 * written, run, and is where this rule comes from.
 *
 * So the question is asked the way somebody choosing a site would ask it. Inside the plot the
 * ground does not matter, because the ground inside is going to be cut and filled until it is a
 * platform — what has to be true inside is only that it is dry land with no road through it, and
 * that it is not so steep that levelling it would carve a cliff (see `CUT`). What has to be flat
 * is the *rim*: the ring of untouched country one tile outside everything the ward stamps, because
 * that ring is the only place a step can appear, and a step of two terraces is a wall nobody can
 * climb. Within a terrace all the way round, and the castle meets its own country on every side.
 */
export function castlePlot(sampler: TerrainSampler, sample: TileSample, tx: number, tz: number): number | null {
  const reach = CASTLE.HALF + CASTLE.APRON;
  let inLow = Infinity, inHigh = -Infinity;
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      sampler.sampleTile(tx + dx, tz + dz, sample);
      const t = sample.type;
      if (t === TileType.Skip || t === TileType.Seabed || t === TileType.Water || t === TileType.Bridge) return null;
      // a road through the middle of a castle is a road through somebody's hall
      if (t === TileType.Road) return null;
      inLow = Math.min(inLow, sample.level);
      inHigh = Math.max(inHigh, sample.level);
      if (inHigh - inLow > CASTLE.CUT) return null;
    }
  }

  const rim = reach + 1;
  let low = Infinity, high = -Infinity;
  for (let dz = -rim; dz <= rim; dz++) {
    for (let dx = -rim; dx <= rim; dx++) {
      if (Math.abs(dx) !== rim && Math.abs(dz) !== rim) continue;
      sampler.sampleTile(tx + dx, tz + dz, sample);
      const t = sample.type;
      if (t === TileType.Skip || t === TileType.Seabed || t === TileType.Water) return null;
      low = Math.min(low, sample.level);
      high = Math.max(high, sample.level);
      if (high - low > CASTLE.SLACK) return null;
    }
  }
  // the low side of the rim, so where the platform does not meet the country level it is a step
  // down out of the gate rather than a lip in front of it
  return low;
}

/** Is anything already standing where the castle would go? */
export function plotIsClear(all: readonly Structure[], villages: readonly Village[], tx: number, tz: number): boolean {
  const reach = CASTLE.HALF + CASTLE.APRON;
  for (const v of villages) {
    if (Math.hypot(v.x - tx, v.z - tz) < v.radius + CASTLE.VILLAGE_CLEARANCE) return false;
  }
  for (const s of all) {
    if (s.kind === StructureKind.Plaza) continue;
    if (Math.abs(s.tx - tx) <= s.hw + reach + 1 && Math.abs(s.tz - tz) <= s.hd + reach + 1) return false;
    for (const [px, pz] of s.path) {
      if (Math.abs(px - tx) <= reach && Math.abs(pz - tz) <= reach) return false;
    }
  }
  return true;
}

/**
 * A crossroads that might be worth a castle, and everything finding one needs.
 *
 * Handed in as a plain object, the way `paddock.ts` and `civic.ts` take their world, so that the
 * two halves of this game that found settlements — a road tree walking its own nodes, and an
 * endless country asking each place about itself — can both ask the same question without either
 * of them learning anything about the other.
 */
export interface Seat {
  sampler: TerrainSampler;
  sample: TileSample;
  all: Structure[];
  villages: readonly Village[];
  /** The crossroads: what the castle is found from, stands off, and looks at. */
  x: number;
  z: number;
}

/**
 * Walk out from a road until the country offers ground a castle could stand on, and build it.
 *
 * The same shape as `lookAround` in `landmarks.ts`, which walks out from a crossroads looking for
 * a cliff to put a cave in, and for the same reason: what a place holds is a fact about the ground
 * near it, and the only honest way to find it is to go and look. A castle simply wants a great
 * deal more ground than a cave mouth does, and gives up further out.
 *
 * `side` is which side of the road it looks at first, which is the caller's to decide — a road tree
 * rolls for it, an endless country takes it from the crossroads' own name. Both sides are walked
 * whichever way that came out, and it is worth saying why, because the first version walked one.
 * Ground a castle will stand on is scarce enough that in one world of three there was exactly one
 * plot in the whole country that would take one, and a coin flip decided whether that world had a
 * castle in it. A rule that rare cannot also be a coin flip. The side only picks which half of the
 * road is searched first, which still matters where both would do.
 *
 * Null when there was nowhere, which will be most of the time and is the point: a castle is what a
 * rare piece of country grows.
 */
export function seatACastle(o: Seat, side: number, id: string, name: string): Castle | null {
  const probe = o.sampler.landProbe(o.x, o.z);
  if (!probe) return null;
  for (const hand of [side, -side]) {
    for (let lat = probe.roadWidth + CASTLE.OFF_THE_ROAD; lat < CASTLE.LOOK_OUT_TO; lat += CASTLE.STRIDE) {
      const tx = Math.round(o.x - probe.uz * lat * hand), tz = Math.round(o.z + probe.ux * lat * hand);
      if (!plotIsClear(o.all, o.villages, tx, tz)) continue;
      const level = castlePlot(o.sampler, o.sample, tx, tz);
      if (level === null) continue;
      return layCastle(o.all, o.sampler, tx, tz, level, o.x, o.z, id, name);
    }
  }
  return null;
}

/**
 * Set a castle out on ground that has already said it will have one, and add it to the pile.
 *
 * `roadX`/`roadZ` is whatever the castle should face — the crossroads it was found from. The gate
 * goes in the side of the wall pointing that way and the keep stands behind the middle of the
 * ward, away from it, so that walking up to a castle you see the gatehouse against the keep rather
 * than beside it. Nothing else about the layout is chosen: a castle is a square with towers on the
 * corners, and the one decision worth making is which way it looks.
 */
export function layCastle(
  all: Structure[], sampler: TerrainSampler,
  tx: number, tz: number, level: number, roadX: number, roadZ: number,
  id: string, name: string,
): Castle {
  const biome = sampler.biomeOf(tx + 0.5, tz + 0.5);
  const { rot, fx, fz } = facing(Math.atan2(roadZ - (tz + 0.5), roadX - (tx + 0.5)));
  const H = CASTLE.HALF;
  const put = (kind: StructureKind, dx: number, dz: number, turn: number, hw = 0, hd = 0): void => {
    all.push({ kind, tx: tx + dx, tz: tz + dz, hw, hd, level, rot: turn, biome, path: [] });
  };

  // the ward first: everything else stands on the flat it makes
  put(StructureKind.CastleWard, 0, 0, 0, H, H);

  // the four corners and the middle of every side that has no gate in it
  const towers: Array<[number, number]> = [[H, H], [H, -H], [-H, H], [-H, -H]];
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (ux === fx && uz === fz) continue;
    towers.push([ux * H, uz * H]);
  }
  for (const [dx, dz] of towers) put(StructureKind.CastleTower, dx, dz, 0);

  // the gatehouse, in the middle of the side that faces the road, looking out of it
  const gateX = tx + fx * H, gateZ = tz + fz * H;
  put(StructureKind.CastleGate, fx * H, fz * H, rot);

  // and the wall, a tile at a time, wherever a tower or the gate has not already taken the line
  const taken = (dx: number, dz: number): boolean => {
    for (const [ox, oz] of towers) {
      if (Math.abs(dx - ox) <= CASTLE.TOWER_REACH && Math.abs(dz - oz) <= CASTLE.TOWER_REACH) return true;
    }
    return Math.abs(dx - fx * H) <= CASTLE.GATE_REACH && Math.abs(dz - fz * H) <= CASTLE.GATE_REACH;
  };
  for (let dz = -H; dz <= H; dz++) {
    for (let dx = -H; dx <= H; dx++) {
      const onX = Math.abs(dx) === H, onZ = Math.abs(dz) === H;
      if ((!onX && !onZ) || taken(dx, dz)) continue;
      // the wall is built lying along z, so a run going across x is turned a quarter to meet it
      put(StructureKind.CastleWall, dx, dz, onZ && !onX ? Math.PI / 2 : 0);
    }
  }

  // the keep, set back from the gate, facing it — and the ward's well between the two, which is
  // what says the place could be shut up for a winter and still have people in it
  put(StructureKind.CastleKeep, -fx * CASTLE.KEEP_SET, -fz * CASTLE.KEEP_SET, rot, 2, 2);
  put(StructureKind.Well, fx * (CASTLE.KEEP_SET + 1), fz * (CASTLE.KEEP_SET + 1), 0);

  return {
    id, name, level,
    x: tx + 0.5, z: tz + 0.5,
    /*
     * Where you stand to go in: two tiles out from the gatehouse's own tile.
     *
     * Two and not one. The gatehouse is three tiles deep, so its outer face lands exactly on the
     * near edge of the next tile along — put here, the hero would come back out of the castle
     * standing inside its own gate stonework, which is a thing you cannot walk out of. Two tiles
     * out is the first tile whose whole width is clear of it, and it is still on the levelled
     * apron, half a tile from the door.
     */
    gateX: gateX + fx * 2 + 0.5, gateZ: gateZ + fz * 2 + 0.5,
  };
}

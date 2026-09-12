/**
 * What sort of thing is standing on a tile.
 *
 * On its own, and not inside `structures.ts`, because the tables of names want it too and a module
 * that imports its own importer is a module that is half-built when somebody reads it — which shows
 * up as an enum that is undefined at the moment a table is laid out, and nowhere else.
 */
export const enum StructureKind {
  House = 1,
  Well = 2,
  Shrine = 3,
  Ruins = 4,
  Tower = 5,
  Campfire = 6,
  GiantTree = 7,
  Plaza = 8,   // town square: flattened disc, no prop of its own
  Stall = 9,
  Sign = 10,
  Church = 11,
  Pier = 12,   // wooden jetty; tiles listed in `path`
  Signpost = 13, // fingerpost at a junction, naming the nearest settlements
  NoticeBoard = 16, // village board: errands posted where anyone can read them
  CaveMouth = 14, // way into a cave anchor
  Shipwreck = 15, // broken hull on a beach with one hold to loot
  Fence = 17,  // one tile of paddock rail, facing along the run it belongs to
  Paddock = 18, // the ground inside the rails: levelled and cleared, still grass
  /**
   * The two buildings a village raises for itself rather than for a trade: the hall where the roll
   * is kept and the watch house where the charge sheet is. Both stand on the square, both are
   * walked into, and both are new kinds rather than a house with a sign on it — a village that has
   * grown enough to write things down has grown enough to build somewhere to write them.
   */
  TownHall = 19,
  WatchHouse = 20,
  /**
   * The five pieces a castle is set out as. See `world/castles.ts`, which lays them out.
   *
   * Everything above this line is one building on one tile. A castle is not a building — it is a
   * levelled ward with a wall round it, and the wall alone is forty of these — so it is the first
   * thing here that is a *plan* rather than a thing. The ward is the ground: flattened, cobbled
   * inside the walls, and drawn as nothing at all, exactly as a town square is.
   */
  CastleWard = 21,
  CastleWall = 22,
  CastleTower = 23,
  CastleGate = 24,
  CastleKeep = 25,
  /**
   * The thing in the crater: a craft that came down here a long time before anybody was watching.
   *
   * One to a world, on ordinary open ground well away from the villages — which is most of what
   * makes it findable rather than given. See `landmarks.ts` for where it lands and `game/craft.ts`
   * for what it is like to fly.
   */
  Derelict = 26,
}

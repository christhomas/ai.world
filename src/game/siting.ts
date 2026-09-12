import { BUILD, buildable, isFinished, owed, type Buildable, type Commission } from './building';

/**
 * Where a thing a builder has been paid for may actually go.
 *
 * Out of `building.ts` because it is a subject of its own and that file had run out of room. What
 * is left there is what a commission *is* — the catalogue, the price, the days, how far along it is
 * this morning. What is here is the question asked once, on one key press, when somebody is standing
 * somewhere with a builder in tow: may it go *here*?
 *
 * Every function below is pure in numbers and plain records. None of them takes a world, a sampler
 * or a chunk: the caller measures the ground and hands the measurements in. That is deliberate and
 * it is what lets a coast be described to them in a test — `canBuildOnShore` is the whole of the
 * jetty-and-boat rule, and it is asked here rather than in the interaction file so that the rule
 * and the sentence a builder says when it fails live together.
 */

/**
 * Is this somewhere a house could go?
 *
 * `flat` is whether the ground itself will take a building, which the world already knows how to
 * answer. `clear` is whether anything is growing on it — an oak is not a structure and so is not
 * in `standing`, but a house built round one has a tree through the roof, which was the first
 * thing that looked wrong when this was played. The rest is about not putting one on top of
 * something else, or so far out that nobody would walk to it.
 *
 * `clear` is last and defaults to true because it was added after the rest: everything that only
 * cares about ground and neighbours can go on calling this the way it always did.
 */
export function canBuildAt(
  x: number, z: number, flat: boolean,
  village: { x: number; z: number } | null,
  standing: ReadonlyArray<{ x: number; z: number }>,
  clear = true,
): { ok: true } | { ok: false; why: string } {
  if (!flat) return { ok: false, why: 'The ground here will not take a house.' };
  if (!clear) return { ok: false, why: 'There is something growing on that. Clear it or pick another spot.' };
  if (!village) return { ok: false, why: 'No village near enough to send a builder.' };
  if (Math.hypot(village.x - x, village.z - z) > BUILD.WITHIN) {
    return { ok: false, why: 'That is too far out. No builder is walking that every morning.' };
  }
  for (const thing of standing) {
    if (Math.hypot(thing.x - x, thing.z - z) < BUILD.CLEAR_OF) {
      return { ok: false, why: 'Too close to what is already standing there.' };
    }
  }
  return { ok: true };
}

/**
 * Is this somewhere a thing that wants a coast could be put — a keel, or the jetty itself?
 *
 * The ground half is `canBuildAt`'s, unchanged and asked first: a yard is a flat, clear patch of
 * ground with nothing standing on it and a village near enough to walk a builder out from, exactly
 * like a house's plot. What a shore adds is what makes it a shore rather than a field, and it is
 * handed in as distances rather than as a world, so this stays a function of numbers a test can ask
 * anything of.
 *
 * ## The small tech tree, and why it does not eat its own tail
 *
 * Two things are built on a shore and they are not the same case. A boat wants somewhere to be tied
 * up when nobody is aboard her, so she wants a jetty within reach; a jetty *is* that somewhere, so
 * requiring one of it would be a rule that no coast in the world could ever satisfy — the first
 * jetty could never be built, and nor could the first boat.
 *
 * The thing that tells them apart is already on the table and needs no new field: `moves`. A thing
 * that will float away needs a mooring. A thing that is the mooring does not. So a village with no
 * harbour can raise a jetty and then build boats off it, which is the first ordering in this game
 * where one thing a player pays for is the gate on another — and it is one word in a condition.
 *
 * `shore` is the three things only a world can answer, gathered into one record because a function
 * of ten arguments is a function nobody calls correctly twice.
 */
export interface Shore {
  /** How far the nearest navigable water is, in tiles. Infinity where there is none. */
  toWater: number;
  /** And the nearest jetty, seeded or paid for, measured the same way. */
  toJetty: number;
  /** Which terrace the site stands on, which is the whole of what tells a harbour from a cliff. */
  level: number;
}

export function canBuildOnShore(
  wants: Buildable,
  x: number, z: number, flat: boolean,
  village: { x: number; z: number } | null,
  standing: ReadonlyArray<{ x: number; z: number }>,
  clear: boolean,
  shore: Shore,
): { ok: true } | { ok: false; why: string } {
  const ground = canBuildAt(x, z, flat, village, standing, clear);
  if (!ground.ok) return ground;
  if (shore.toWater > BUILD.SHORE_WITHIN) {
    return {
      ok: false,
      why: wants.moves
        ? 'A boat wants building where she can be slid into the water, not carried to it.'
        : 'A jetty wants the water at the end of it. There is none within reach of here.',
    };
  }
  if (wants.moves && shore.toJetty > BUILD.PIER_WITHIN) {
    return { ok: false, why: 'There is nowhere hereabouts to tie her up. Build a jetty first, or build her by one.' };
  }
  /*
   * And the bank has to be low, which is asked of the jetty alone.
   *
   * A hull is built on the shore and slid down whatever is there; a deck has to leave the land
   * level with it and stand over the water at the far end, so a bank six terraces up gives a wall
   * of planks with a staircase down it and a boat at the bottom. `piers.ts` refuses exactly this
   * when it lays the country's own, and the sentence there is worth reading: it is not a port, and
   * there is no arithmetic that makes it one.
   */
  if (!wants.moves && shore.level > BUILD.HARBOUR_LEVEL) {
    return { ok: false, why: 'That bank is too high for a jetty. It wants a beach or a low shore, not a cliff.' };
  }
  return { ok: true };
}

/**
 * Where an addition stands, given the house it belongs to and where its owner was standing.
 *
 * The side of the house you are on is the side it goes, which is the same statement of intent the
 * house's own facing is taken from — you walked round to the side you wanted and pressed Enter.
 * A storey is the exception and sits exactly on the house, because it *is* the house.
 */
export function beside(
  parent: { x: number; z: number }, what: string, fromX: number, fromZ: number,
): { x: number; z: number } {
  if (buildable(what).changes) return { x: parent.x, z: parent.z };
  const dx = fromX - parent.x, dz = fromZ - parent.z;
  const away = Math.hypot(dx, dz);
  // standing in the doorway is not a direction, so the yard goes out the front by default
  if (away < 0.5) return { x: parent.x + BUILD.BESIDE_AT, z: parent.z };
  return {
    x: parent.x + (dx / away) * BUILD.BESIDE_AT,
    z: parent.z + (dz / away) * BUILD.BESIDE_AT,
  };
}

/**
 * Can this be added to that house?
 *
 * Four refusals, and each of them is a sentence somebody would actually say. The building has to
 * be yours and finished — a builder will not start a pool beside a frame — it has to be paid for,
 * because a man owed four hundred gold for the house does not begin the next job on credit, and a
 * house can only have one second storey.
 */
export function canAttachTo(
  parent: Commission | null, what: string, day: number, already: readonly Commission[],
): { ok: true } | { ok: false; why: string } {
  const wants = buildable(what);
  if (!parent) return { ok: false, why: `Stand by a house of your own. ${wants.name} has to go on something.` };
  if (!isFinished(parent, day)) return { ok: false, why: 'That one is not finished. One thing at a time.' };
  if (owed(parent, day) > 0) return { ok: false, why: 'Settle up for that one first. I do not start the next on credit.' };
  if (wants.changes && already.some((job) => job.to === parent.id && job.what === what)) {
    return { ok: false, why: 'It has one of those already.' };
  }
  return { ok: true };
}

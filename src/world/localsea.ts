import { faceOf, facesIn, onTheHalfwayLine, siteOf, type Corner, type Face } from './localmesh';
import type { Land } from './localroads';

/**
 * Where the roads stop, and what carries you on from there.
 *
 * A border between two dry faces is a road. A border between dry land and open water is a *shore*,
 * and if the water is worth crossing there is a port on it — which is the same rule as a road, asked
 * of a different pair, and settled the same way by both sides. That much falls out of B2 and B3 for
 * nothing.
 *
 * The ferries are the interesting half. Today the world finds them by looking at every island it
 * has, pairing each with the shortest clear crossing to the mainland — a search over everything,
 * which is exactly what an endless world cannot do. The local rule is mutual choice: a port looks
 * across the water as far as a ferry would go, picks the port it would rather serve, and a crossing
 * exists only where the two of them pick each other.
 *
 * That is symmetric by construction, which is the property this whole world is built on. Nobody has
 * to know what other crossings exist elsewhere; two ports agree about the water between them because
 * each asked the same bounded question and got the same answer.
 */

/** A port: where a dry face meets open water, on the dry side of the line. */
export interface Port {
  /** The two faces the shore lies between, sorted — the port's name, the same from either side. */
  id: string;
  /** The dry face it belongs to. */
  land: string;
  /** The water it looks out on. */
  water: string;
  /** Where the jetty stands: the middle of the shore. */
  x: number;
  z: number;
}

/** A crossing: two ports that chose each other. */
export interface Crossing {
  /** The two ports, sorted, which is the crossing's name from either shore. */
  between: [string, string];
  from: Port;
  to: Port;
  length: number;
}

/**
 * How far a ferry will go, in tiles.
 *
 * The bound that makes the rule local. A crossing longer than this is a voyage rather than a ferry,
 * and voyages are somebody else's problem — a scheduled sailing between named ports, which is a
 * thing a world can keep a list of because there are few of them, rather than a thing it must
 * discover by looking at all the water there is.
 *
 * In tiles rather than in face-widths, which is what it used to be, and the difference is not
 * cosmetic. Fourteen faces is a sensible ferry in a country of small faces and eight hundred and
 * sixty tiles in the country this game actually draws — three times the length of the longest
 * river, and a search over three million tiles of water per port to find it. A ferry is a distance,
 * not a number of fields, and two hundred tiles is about a minute and a half of sailing.
 */
const FERRY_ACROSS = 196;

/** How much of a crossing has to be water. A ferry that runs over a sandbank is a road. */
const SOUNDINGS = [0.2, 0.35, 0.5, 0.65, 0.8] as const;
const DEEP_ENOUGH = 4;

/** The name of a shore, from the two faces it lies between: the same either way round. */
function shoreName(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

/**
 * The ports of one face.
 *
 * A dry face has one wherever it borders water. A wet face has none of its own — the port belongs to
 * the shore it is built on, which is the land side, so that a port is somewhere you can stand.
 */
export function portsOf(world: Land, face: Face): Port[] {
  if (!world.land(face.x, face.z)) return [];
  const out: Port[] = [];
  for (const id of face.neighbours) {
    const other = siteOf(world, id, face);
    if (!other || world.land(other.x, other.z)) continue;

    const shore = onTheHalfwayLine(face.corners, { x: face.x, z: face.z, claim: 0, id: face.id }, other);
    if (shore.length < 2) continue;
    const [from, to] = ends(shore);
    out.push({
      id: shoreName(face.id, id),
      land: face.id,
      water: id,
      x: (from.x + to.x) / 2,
      z: (from.z + to.z) / 2,
    });
  }
  return out;
}

/**
 * The crossing from a port, if the port at the other end agrees.
 *
 * Each looks as far as a ferry runs, keeps the ports whose water is deep the whole way, and prefers
 * the nearest — ties broken by name, so two crossings of exactly equal length cannot be decided
 * differently at the two ends. A crossing exists where each is the other's choice, and only there.
 *
 * That mutual step is the whole of it. "The nearest port across the water" on its own is not
 * symmetric: a lonely island's only port may choose a busy shore that has three better options, and
 * a ferry with one end is a ferry that appears when you sail towards it and not when you sail away.
 */
export function crossingFrom(world: Land, port: Port): Crossing | null {
  const chosen = choiceOf(world, port);
  if (!chosen) return null;
  const back = choiceOf(world, chosen);
  if (!back || back.id !== port.id) return null;
  return {
    between: port.id < chosen.id ? [port.id, chosen.id] : [chosen.id, port.id],
    from: port,
    to: chosen,
    length: Math.hypot(chosen.x - port.x, chosen.z - port.z),
  };
}

/** The port this one would serve: nearest across open water, name deciding a tie. */
function choiceOf(world: Land, port: Port): Port | null {
  const reach = FERRY_ACROSS;
  const near = world.scatter.sitesIn({
    x0: port.x - reach, z0: port.z - reach, x1: port.x + reach, z1: port.z + reach,
  });

  let best: Port | null = null, nearest = Infinity;
  for (const site of near) {
    if (!world.land(site.x, site.z)) continue;
    for (const other of portsOf(world, faceOf(world, site))) {
      if (other.id === port.id || other.land === port.land) continue;
      const away = Math.hypot(other.x - port.x, other.z - port.z);
      if (away > reach || away < 2) continue;             // two jetties on one beach are not a ferry
      if (!wetAllTheWay(world, port, other)) continue;
      if (away < nearest - 1e-9 || (Math.abs(away - nearest) <= 1e-9 && best !== null && other.id < best.id)) {
        nearest = away; best = other;
      }
    }
  }
  return best;
}

/** Is there water the whole way between two ports? Sounded along the crossing, not at its ends. */
function wetAllTheWay(world: Land, from: Port, to: Port): boolean {
  let wet = 0;
  for (const t of SOUNDINGS) {
    if (!world.land(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) wet++;
  }
  return wet >= DEEP_ENOUGH;
}

/**
 * Every crossing that touches a patch.
 *
 * Gathered wider than the patch by a ferry's own length, because a crossing with one end outside it
 * still puts a jetty inside it — and both ends have to be surveyed for either to exist, since a
 * crossing is only a crossing where two ports choose each other. Named by the pair, so the two
 * patches that share it find the same one and it is built once.
 */
export function crossingsIn(world: Land, within: { x0: number; z0: number; x1: number; z1: number }): Crossing[] {
  const wider = {
    x0: within.x0 - FERRY_ACROSS, z0: within.z0 - FERRY_ACROSS,
    x1: within.x1 + FERRY_ACROSS, z1: within.z1 + FERRY_ACROSS,
  };
  const found = new Map<string, Crossing>();
  for (const face of facesIn(world, wider)) {
    if (!world.land(face.x, face.z)) continue;
    for (const port of portsOf(world, face)) {
      const crossing = crossingFrom(world, port);
      if (!crossing) continue;
      // one of its two ends has to be in the patch, or it belongs to a neighbour entirely
      const ours = [crossing.from, crossing.to].some((end) =>
        end.x >= within.x0 && end.x <= within.x1 && end.z >= within.z0 && end.z <= within.z1);
      if (ours) found.set(crossing.between.join('~'), crossing);
    }
  }
  return [...found.values()].sort((a, b) => (a.between.join() < b.between.join() ? -1 : 1));
}

/** The two corners furthest apart, which are the ends of a shore. */
function ends(corners: Corner[]): [Corner, Corner] {
  let best: [Corner, Corner] = [corners[0], corners[1] ?? corners[0]], most = -1;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const away = Math.hypot(corners[i].x - corners[j].x, corners[i].z - corners[j].z);
      if (away > most) { most = away; best = [corners[i], corners[j]]; }
    }
  }
  return best;
}

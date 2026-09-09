import { Scatter, type CellDials, type Site } from './scattercells';

/**
 * The faces of a country with no edge to it.
 *
 * The world is built on faces: a face is a patch of land or sea, its borders are where roads run,
 * its corners are crossroads, and a town stands where enough of them meet. `weldPolygons` makes
 * them today by triangulating every point in the world and then growing faces out of the triangles
 * in a shuffled order — which is a second reason, after the dart-throwing, that this country has to
 * be made all at once from the middle. Shuffle the triangles differently and you get different
 * faces.
 *
 * So the welding goes, and the faces are Voronoi cells instead: the ground closer to this site than
 * to any other. That is not a compromise, it is the better shape for what the welding was reaching
 * for — a jittered point set gives cells of four to seven sides at several scales, which is what all
 * that growing and refusing was for — and it has the one property the welding could never have: a
 * cell is settled by the sites around it and by nothing else.
 *
 * Which means the face under your feet is the same face whether the country was made from here,
 * from a hundred tiles east, or from the far side of the sea, and neighbouring faces agree about the
 * border between them because both computed the same bisector. That is the whole of B2, and
 * everything else an endless world needs stands on it.
 */

/** A corner of a face, where three or more of them meet. */
export interface Corner {
  x: number;
  z: number;
}

/** One face: the ground nearer this site than any other. */
export interface Face {
  /** The site's own name, which is the face's name and is stable for ever. */
  id: string;
  /** Where the site stands, which is the middle of the face for every purpose that wants one. */
  x: number;
  z: number;
  /** Its corners, going round. */
  corners: Corner[];
  /** The faces it shares a border with, by name — which is where roads go. */
  neighbours: string[];
}

/**
 * How far out to look for sites that could cut this face.
 *
 * A bisector with a site further away than this cannot touch the cell, because a nearer site has
 * already cut the ground off. Three claims is generous — two would do for a well-spaced set — and
 * generous is right: the cost is a handful of extra bisectors, and the price of being wrong is a
 * face that is subtly different depending on how wide a window it was asked for in, which is the
 * one fault this whole approach exists to make impossible.
 */
const LOOK_OUT = 3;

/**
 * Everything the mesher needs about the world it is meshing.
 *
 * The scatter is held rather than made per question, and that is not tidiness: every face asks about
 * the ground around it, every junction asks again about the ground around itself, and a world with
 * no memory of the cells it has already worked out does that arithmetic over and over. With one, the
 * second question about a patch is free.
 */
export interface Country {
  seed: number;
  /** How fine-grained the ground is here, nought to one, as the world's own noise says. */
  spacing: (x: number, z: number) => number;
  dials: CellDials;
  scatter: Scatter;
  /**
   * The faces already worked out, by the name of the site each belongs to.
   *
   * A face is a pure function of the sites around it, and everything asks for the same faces over
   * and over: a road asks for the face on the other side, a junction asks for all three of its
   * faces, the thing walking asks for the face under its feet every step. Without this the same
   * clipping is done dozens of times a frame; with it, once.
   */
  faces: Map<string, Face>;
}

/** A country, with its own memory of the cells it has worked out. */
export function countryOf(seed: number, spacing: (x: number, z: number) => number, dials: CellDials): Country {
  return { seed, spacing, dials, scatter: new Scatter(seed, spacing, dials), faces: new Map() };
}

/** The sites of a patch, with the ring around it a face needs to be sure of its own borders. */
function sitesAround(country: Country, x: number, z: number, reach: number): Site[] {
  return country.scatter.sitesIn({ x0: x - reach, z0: z - reach, x1: x + reach, z1: z + reach });
}

/**
 * The face a point stands on.
 *
 * The nearest site, which is what a Voronoi cell means. Looks over a window wide enough that the
 * nearest site cannot possibly be outside it.
 */
export function faceAt(country: Country, x: number, z: number): Face | null {
  const reach = country.dials.far * LOOK_OUT;
  const around = sitesAround(country, x, z, reach);
  let owner: Site | null = null, nearest = Infinity;
  for (const site of around) {
    const away = (site.x - x) ** 2 + (site.z - z) ** 2;
    if (away < nearest) { nearest = away; owner = site; }
  }
  return owner ? faceOf(country, owner) : null;
}

/**
 * One site by name, looked for around a face that already knows the name.
 *
 * A face names its neighbours rather than pointing at them, because a name is stable and an index
 * into an array of everything is not something an endless world has. Finding one again is a search
 * of the ground round the face that mentioned it, which is bounded and cheap: the sites of that
 * patch are already worked out.
 */
export function siteOf(country: Country, id: string, near: { x: number; z: number }): Site | null {
  const reach = country.dials.far * LOOK_OUT;
  return sitesAround(country, near.x, near.z, reach).find((site) => site.id === id) ?? null;
}

/**
 * The face belonging to one site.
 *
 * Built by taking a square of ground round the site and cutting away everything closer to a
 * neighbour: for each other site, the half of the plane beyond the line halfway between them. What
 * is left is the cell. Sutherland and Hodgman again, as with the overlap measure in the collision
 * bench, because clipping a convex shape by a half-plane is the same job wherever it turns up.
 */
export function faceOf(country: Country, site: Site): Face {
  const known = country.faces.get(site.id);
  if (known) return known;
  const reach = country.dials.far * LOOK_OUT;
  const around = sitesAround(country, site.x, site.z, reach);

  // a square certain to be bigger than the cell, which the bisectors then cut down
  let shape: Corner[] = [
    { x: site.x - reach, z: site.z - reach },
    { x: site.x + reach, z: site.z - reach },
    { x: site.x + reach, z: site.z + reach },
    { x: site.x - reach, z: site.z + reach },
  ];
  for (const other of around) {
    if (other.id === site.id) continue;
    shape = cut(shape, site, other);
    if (shape.length === 0) break;
  }

  /*
   * Who it actually borders, decided after all the cutting rather than during it.
   *
   * A bisector that took ground away is not proof of a border: a third site can cut that ground
   * away again, leaving a neighbour recorded with nothing shared. Sharing a border means having an
   * *edge* on the halfway line — two corners of the finished cell — and that is the same answer
   * computed from either side, which is what makes a road built from the east meet the one built
   * from the west.
   */
  const neighbours: string[] = [];
  for (const other of around) {
    if (other.id === site.id) continue;
    if (onTheHalfwayLine(shape, site, other).length >= 2) neighbours.push(other.id);
  }

  const face: Face = {
    id: site.id,
    x: site.x,
    z: site.z,
    corners: shape,
    // sorted so that two runs of the same face cannot differ by the order sites happened to arrive
    neighbours: neighbours.sort(),
  };
  // a face is worked out once; a country a player walks out of is forgotten with the country
  if (country.faces.size < FACES_KEPT) country.faces.set(site.id, face);
  return face;
}

/**
 * How many faces a country keeps worked out.
 *
 * Enough for the country a player can see and a good deal further, small enough that walking for an
 * hour does not carry the whole journey. Beyond it faces are worked out again, which costs the
 * clipping and nothing else.
 */
const FACES_KEPT = 20_000;

/** Everything in the shape that is nearer `mine` than `theirs`. */
function cut(shape: Corner[], mine: Site, theirs: Site): Corner[] {
  // the bisector, as a line every point is measured against: positive is my side
  const dx = theirs.x - mine.x, dz = theirs.z - mine.z;
  const midX = (mine.x + theirs.x) / 2, midZ = (mine.z + theirs.z) / 2;
  const side = (p: Corner): number => -((p.x - midX) * dx + (p.z - midZ) * dz);

  const kept: Corner[] = [];
  for (let i = 0; i < shape.length; i++) {
    const here = shape[i], next = shape[(i + 1) % shape.length];
    const a = side(here), b = side(next);
    if (a >= 0) kept.push(here);
    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      kept.push({ x: here.x + (next.x - here.x) * t, z: here.z + (next.z - here.z) * t });
    }
  }
  return kept;
}

/**
 * The corners of a cell that lie on the halfway line to another site: the border they share.
 *
 * Measured as a distance rather than as a dot product, so the tolerance means the same thing
 * wherever in an endless world it is asked — a hundred tiles out or a hundred thousand, a corner is
 * on the line if it is within a thousandth of a tile of it.
 */
export function onTheHalfwayLine(shape: Corner[], mine: Site, theirs: Site): Corner[] {
  const dx = theirs.x - mine.x, dz = theirs.z - mine.z;
  const apart = Math.hypot(dx, dz) || 1;
  const midX = (mine.x + theirs.x) / 2, midZ = (mine.z + theirs.z) / 2;
  return shape.filter((p) => Math.abs(((p.x - midX) * dx + (p.z - midZ) * dz) / apart) < 1e-3);
}

/** Every face whose site falls in a patch of country, for drawing or for walking over. */
export function facesIn(country: Country, window: { x0: number; z0: number; x1: number; z1: number }): Face[] {
  return country.scatter.sitesIn(window).map((site) => faceOf(country, site));
}

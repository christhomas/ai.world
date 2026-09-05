/**
 * The loft, and why anybody makes the climb twice.
 *
 * A village in the clouds that sells bread and beds is a village with a good view, and a good view
 * is not worth a hundred and fifty gold and a walk to a mountain. So the thing up here is the one
 * thing that could only ever be up here: the birds themselves.
 *
 * Down on the ground an eagle is a crag and a partner crag, and it will carry you over one range
 * and no further. That is the deal because a bird waiting on a rock has one journey in it. The
 * cloud village keeps a loft of them — dozens, fed off the spring, with no mountain in the way of
 * anywhere — and its keeper will send you wherever you have already been. Not anywhere: a bird
 * flies to somewhere it has been shown, and you have to have been there first, which is what keeps
 * this a way of going back rather than a way of skipping the country entirely.
 *
 * It is the only fast travel in the game, it is one-way, and using it again means paying an eagle
 * to bring you back up. That is deliberate — the loft is a decision each time, not a menu you
 * live in.
 */

/** What the loft charges and how much of the country it will show you at once. */
export const LOFT = {
  /** A flight costs this, plus this much for every hundred tiles. */
  FARE_BASE: 18,
  FARE_PER_HUNDRED: 7,
  /**
   * How many destinations the keeper offers.
   *
   * A dialogue is a list somebody reads, and a list of thirty villages is a spreadsheet. Six is
   * about as many as anybody weighs before picking, and they are the six furthest away — the near
   * ones are a walk, and paying a bird to take you somewhere you can see from here is what makes
   * fast travel feel like cheating.
   */
  SHOWN: 6,
  /**
   * How far away somewhere has to be before the keeper will send a bird at all.
   *
   * Under this and the birds are simply not interested, which saves the player from buying a
   * flight to the island they are standing over.
   */
  WORTH_FLYING: 120,
} as const;

/** Somewhere the loft could send you: a village or a landmark, and where it is. */
export interface Destination {
  name: string;
  x: number;
  z: number;
}

/** One offer on the keeper's board. */
export interface Flight {
  name: string;
  x: number;
  z: number;
  /** How far it is, in tiles, so the offer can say so. */
  tiles: number;
  fare: number;
}

/** What a bird asks to carry somebody `tiles` across the country. */
export function loftFare(tiles: number): number {
  return Math.round(LOFT.FARE_BASE + (tiles / 100) * LOFT.FARE_PER_HUNDRED);
}

/**
 * What the keeper will offer, given where the hero is standing and where they have already been.
 *
 * Only places the hero has been, which is what `been` answers: a bird has to have been shown a
 * roof before it can find it again, and — the real reason — a loft that flies you to villages you
 * have never heard of would hand the player the whole map for money and leave nothing on it to
 * discover.
 *
 * Furthest first, and duplicates by name dropped, because a village and the shrine beside it are
 * the same journey and offering both wastes one of six lines.
 */
export function loftFlights(
  from: { x: number; z: number },
  places: Iterable<Destination>,
  been: (place: Destination) => boolean,
): Flight[] {
  const seen = new Set<string>();
  const out: Flight[] = [];
  for (const place of places) {
    if (seen.has(place.name) || !been(place)) continue;
    const tiles = Math.hypot(place.x - from.x, place.z - from.z);
    if (tiles < LOFT.WORTH_FLYING) continue;
    seen.add(place.name);
    out.push({ name: place.name, x: place.x, z: place.z, tiles: Math.round(tiles), fare: loftFare(tiles) });
  }
  out.sort((a, b) => b.tiles - a.tiles);
  return out.slice(0, LOFT.SHOWN);
}

/** What the keeper says when the hero has not been anywhere far enough to be flown back to. */
export const NOWHERE_TO_SEND = 'A bird has to have seen a place before it can find it again. Walk the country first, and then come back and tell me where you have been.';

import { WORKS } from './hall';
import { PropKind } from './biomes';

/**
 * Where the things a village buys actually stand.
 *
 * A hall spends its treasury on six things — a well, a second storey, a watchtower, a bath house, a
 * market hall, an aqueduct — and until this file existed exactly one of them appeared in the world.
 * `raisedRoofs` turned `works` entries into buildings and filtered `isARoof`, so a village could
 * save four thousand gold, pay for a watchtower, carry a watchman's wage from that day forward, and
 * a player walking in would see a field.
 *
 * Every part of it worked. The purchase is priced, ordered cheapest-first *so that a player can
 * watch a village change*, argued about in the economy bench, and written into the books the
 * morning it is paid for. The bench reports "eight villages raised a bath house" and the bench is
 * reading the books correctly. The join is what was missing, which is this codebase's signature
 * fault and the seventh time it has been found.
 *
 * ## Why the rule is per-work and not one rule for all of them
 *
 * A well goes on the square, because a well is what a square is *for* and a well at the edge of a
 * village is a well nobody carries water from. A watchtower goes at the rim with a view, because a
 * tower in the middle of the roofs can see roofs. A bath house is an ordinary building on an
 * ordinary plot. One rule would have put all three on the next spare plot, which is the answer for
 * one of them and wrong for the other two in a way anybody would notice from the road.
 *
 * ## And the two that are deliberately not drawn
 *
 * A market hall and an aqueduct have no model. Drawing them as something else is the lie
 * `raisedRoofs` already refuses to tell about house sizes — "drawing a great house as a cottage
 * would be a lie about a thing a player can walk up to" — and it would be a worse lie here, because
 * an aqueduct is the thing at the top of the ladder and the whole point of it is that nobody has
 * seen one. They are named in `NOT_DRAWN_YET` rather than left out, so the test below can tell the
 * difference between a work nobody has got to and a work somebody forgot.
 */

/** What a bought work looks like when it is standing, and how to find the ground it stands on. */
export interface Civic {
  /** The `works` id, as `hall.ts` spells it. */
  id: string;
  /** The prop to put up. */
  prop: PropKind;
  /**
   * Where it goes, and this is the whole of the per-work part.
   *
   * - `square` — on the square, which is where a village gathers and where a well belongs.
   * - `rim` — out at the edge of the village with something to look at, for a tower.
   * - `plot` — the next spare plot, like any other building.
   */
  stands: 'square' | 'rim' | 'plot';
}

export const CIVICS: readonly Civic[] = [
  { id: 'well', prop: PropKind.Well, stands: 'square' },
  { id: 'watchtower', prop: PropKind.Tower, stands: 'rim' },
  { id: 'bathhouse', prop: PropKind.Sauna, stands: 'plot' },
];

/**
 * Works that are bought and not yet drawn, and why.
 *
 * A storey is here for a different reason from the other two: it is not a building at all, it is a
 * second floor on the houses that are already standing, so its home is `Raised.storeys` rather than
 * a prop of its own. It is listed so that "not drawn" is a statement somebody made rather than a
 * gap somebody left.
 */
export const NOT_DRAWN_YET: Readonly<Record<string, string>> = {
  storey: 'not a building — a second floor on roofs that already stand, which is `Raised.storeys`',
  markethall: 'no model, and drawing it as a house would be a lie about a thing a player can walk up to',
  aqueduct: 'no model, and it is the thing at the top of the ladder that nobody has seen yet',
};

/** What a village bought that can be stood somewhere, in the order `WORKS` prices them. */
export function civicFor(work: string): Civic | null {
  return CIVICS.find((c) => c.id === work) ?? null;
}

/** Every id in `WORKS` that is neither drawn nor written down as undrawn. Empty, or a bug. */
export function worksNobodyPlaced(): string[] {
  return WORKS.map((w) => w.id).filter((id) => !civicFor(id) && !(id in NOT_DRAWN_YET));
}

/**
 * Where on the ground one of these goes.
 *
 * `at` is the village's own middle, `spare` its unbuilt plots and `taken` how many of them the
 * roofs have already had — a civic building queues behind the houses rather than in front of them,
 * because a village that built a bath house on the plot its next family was going to live on has
 * spent its money twice.
 */
export function whereItStands(
  civic: Civic,
  village: { x: number; z: number; radius: number; board: readonly [number, number] | null },
  spare: ReadonlyArray<{ tx: number; tz: number; rot: number }>,
  taken: number,
): { x: number; z: number; rot: number } | null {
  if (civic.stands === 'square') {
    // the board marks the square when the square had room for one; the middle is the fallback, and
    // it is the same place a village without a board gathers anyway
    const [bx, bz] = village.board ?? [village.x, village.z];
    return { x: bx + 1.5, z: bz + 1.5, rot: 0 };
  }
  if (civic.stands === 'rim') {
    // out at the edge, and always the same edge for the same village: a tower that moved when the
    // village grew would be a landmark that walked
    const angle = (village.x * 31 + village.z * 17) % 360 * (Math.PI / 180);
    return {
      x: village.x + Math.cos(angle) * village.radius,
      z: village.z + Math.sin(angle) * village.radius,
      rot: -angle,
    };
  }
  const plot = spare[taken];
  return plot ? { x: plot.tx + 0.5, z: plot.tz + 0.5, rot: plot.rot } : null;
}

import { SHAFT, overAShaft, type Shaft } from '../world/shafts';
import type { GameState } from './state';
import type { Places } from './places';

/**
 * Standing over a hole in the ground, and what happens next.
 *
 * The rule is one sentence: step into the mouth of a shaft carrying folded silk and you go down;
 * step into it without and you look at it. That is deliberately not a dialogue, a prompt or a
 * choice — the hole is plainly a hole, walking into it is plainly walking into it, and a game that
 * asked "are you sure?" at the edge would be asking whether the player meant to do the thing they
 * had just done.
 *
 * What makes it worth having is the *without*. Every other way into the ground in this world opens
 * to persistence: walk far enough, fight hard enough, find the cave mouth. A shaft opens to
 * equipment, and nothing else — so the hundred and forty gold is a decision about where the map is
 * open to you rather than a number on a sheet.
 *
 * The refusal is said once and then held, because a player walking the rim of one would otherwise
 * be told about the drop sixty times a second.
 */

/** How long after being told about a drop before it will say so again, in seconds. */
const HOLD_YOUR_TONGUE = 8;

/**
 * Whether a spot is the kind of ground a shaft could be standing open in.
 *
 * Land, not a road, and not built on. The lattice is arithmetic on a cell number and half of what
 * it produces lands in the sea or in the middle of a village square — and a hole in a market place
 * would be either a joke or a lawsuit. Here rather than in the renderer or the walker, because both
 * of them have to agree about it exactly: a hole drawn where nothing takes you is worse than no
 * hole at all.
 */
export function openCountry(
  world: {
    heightAt: (x: number, z: number) => number | null;
    isRoad: (x: number, z: number) => boolean;
    peopled?: (x: number, z: number) => boolean;
    blocked: (x: number, z: number) => boolean;
  },
  x: number,
  z: number,
): boolean {
  /*
   * Asked across the whole mouth rather than at its middle.
   *
   * A point is not a hole. Checked at the middle alone, the first shaft photographed had a fir tree
   * growing dead centre out of the pit — the trunk misses the exact spot by a foot and the tree is
   * plainly standing in mid-air over a drop. Five points is the middle and the four sides, which is
   * enough to catch anything with a trunk in this world and cheap enough to ask of every shaft
   * every frame.
   */
  const r = SHAFT.MOUTH * 0.8;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]] as const) {
    const ax = x + dx, az = z + dz;
    if (world.heightAt(ax, az) === null) return false;
    if (world.isRoad(ax, az)) return false;
    if (world.peopled?.(ax, az)) return false;
    // and nothing standing on it: a shaft under a cottage is a cottage with no floor
    if (world.blocked(ax, az)) return false;
  }
  return true;
}

export function createShafts(o: {
  seed: number;
  state: GameState;
  places: Places;
  hero: () => { x: number; z: number };
  /** Whether the hero is standing on the surface at all: a cellar has no shafts in its floor. */
  outdoors: () => boolean;
  /**
   * Whether a spot could really have a shaft in it.
   *
   * The lattice is arithmetic on a cell number and knows nothing about the country, so half of what
   * it produces lands in the sea, in a village square or under somebody's house. Asked of whoever
   * has the country to hand — the same seam the whirlpools use, and for the same reason.
   */
  couldBe: (x: number, z: number) => boolean;
  say: (line: string) => void;
  discover: (name: string) => void;
}) {
  /** What is left of holding our tongue about a drop we have already explained. */
  let quiet = 0;
  /**
   * The shaft he came up out of, while he is still standing on it.
   *
   * Coming out of a hollow puts him at the mouth he went in by, and without this that is a hole he
   * is standing in the middle of — so he would drop straight back down it, for ever, which is the
   * same fault the whirlpools had and is worth naming in both places.
   */
  let justOut: Shaft | null = null;

  return {
    /** Once a frame, after the hero has moved. */
    step(dt: number): void {
      if (quiet > 0) quiet = Math.max(0, quiet - dt);
      if (!o.outdoors()) return;
      const { x, z } = o.hero();
      const over = overAShaft(x, z, o.seed);
      if (!over || !o.couldBe(over.x, over.z)) { justOut = null; return; }
      // he has just climbed out of this one: it is a hole in the ground again once he is off it
      if (justOut && justOut.id === over.id) return;

      if (!o.state.can('float')) {
        if (quiet <= 0) {
          quiet = HOLD_YOUR_TONGUE;
          o.say(`${over.name} goes straight down further than you can see. You would need something to slow the fall.`);
        }
        return;
      }
      justOut = over;
      o.discover(over.name);
      o.say(`The silk cracks open above you and you come down easy, in the dark.`);
      o.places.enterDungeon(
        { name: over.name, x: over.x, z: over.z, out: [over.x, over.z] },
        'cave', over.id,
      );
    },

    /** How wide the mouth is, for whatever draws it. */
    get mouth(): number { return SHAFT.MOUTH; },
  };
}

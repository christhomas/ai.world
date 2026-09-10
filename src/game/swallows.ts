import { MAELSTROM, swallowing, tollOf, type Maelstrom } from '../world/maelstroms';
import type { GameState } from './state';
import type { Places } from './places';
import type { Sailing } from './sailing';

/**
 * Sailing into water that is going down, and coming back out of it.
 *
 * The whirlpools themselves are a field — `world/maelstroms.ts` — and this is what the game does
 * about one: takes half your hearts or all of them, puts you in the cavern underneath, and, when
 * you climb back out, sets you on the deck of the boat you left turning at the rim.
 *
 * That last part is the whole reason this is a file and not four lines in the frame loop. Surfacing
 * is not a place the rest of the game can cope with: the hole you came up out of is open sea, and a
 * hero standing in open sea has no ground under him, cannot be settled, and cannot walk anywhere.
 * So going down remembers the boat, and coming up puts him back in it.
 */

export function createSwallows(o: {
  seed: number;
  state: GameState;
  places: Places;
  sailing: Sailing;
  /** Where the hull is this moment, which is what gets caught. */
  hull: () => { x: number; z: number };
  say: (line: string) => void;
  /** Carried to the nearest town, purse lighter: the same door a wolf pack uses. */
  knockOut: (cause: string) => void;
}) {
  /** The whirlpool he went down, while he is still below it. */
  let below: Maelstrom | null = null;

  return {
    /**
     * Once a frame while he is at sea, and once a frame after that until he is back.
     *
     * Two questions in one call, which is why it is not two methods: the first frame after a
     * cavern is left looks exactly like an ordinary frame at sea, and the answer to "is he back"
     * has to be asked before the answer to "has he sailed into one".
     */
    check(): void {
      if (below) {
        // still down there: nothing to do until the floor is left
        if (o.places.underground) return;
        // up: he surfaces in the turning water, which is no place to stand, so he surfaces aboard
        o.sailing.board();
        o.say(`You come up in the swell off ${below.name}, and haul yourself over the gunwale.`);
        below = null;
        return;
      }
      if (!o.sailing.sailing || o.places.underground) return;
      const { x, z } = o.hull();
      const caught = swallowing(x, z, o.seed);
      if (!caught) return;

      /*
       * What it costs, and the fact that nobody can know it beforehand.
       *
       * Between half your hearts and every one of them — of the most you *could* have rather than
       * of what you have left, so sailing into one already hurt is exactly as reckless as it
       * sounds. Rolled off the whirlpool and the day rather than off a random number, so that two
       * people in one world cannot disagree about whether somebody survived it.
       */
      const toll = Math.ceil(o.state.maxHpTotal * tollOf(caught, o.seed, o.state.day));
      o.state.hp = Math.max(0, o.state.hp - toll);
      o.state.version++;
      /*
       * The boat is put out at the rim rather than taken.
       *
       * Two reasons and the second one is the one that bites. There has to be something up there to
       * climb back into, or a single bad roll ends sailing altogether. And it must not be left in
       * the *middle*: surfacing where you went down means surfacing inside the mouth, which takes
       * you again on the next frame and again on the frame after — a hole in the sea that eats a
       * player's whole afternoon a heart at a time. Found by a test that passed for the wrong
       * reason: it swallowed him twice and the second one only failed to show because it had
       * already knocked him out.
       */
      const rim = { x: caught.x + MAELSTROM.RADIUS + 2, z: caught.z };
      o.sailing.x = rim.x;
      o.sailing.z = rim.z;
      o.sailing.abandon();
      if (o.state.hp <= 0) {
        o.knockOut(`${caught.name} took the boat down, and you with it. The water`);
        return;
      }
      below = caught;
      o.say(`${caught.name} takes the boat down. You come to in the dark, half drowned.`);
      o.places.enterDungeon(
        // and he comes up beside the boat rather than in the middle of the water that took him
        { name: caught.name, x: caught.x, z: caught.z, out: [rim.x, rim.z] },
        'sunken', caught.id,
      );
    },

    /** Which whirlpool he is under, if any: for the map, and for a test. */
    get under(): Maelstrom | null { return below; },
  };
}

/** How wide the turning water is drawn, which the water shader and the minimap both ask. */
export const SWALLOW_WIDTH = MAELSTROM.RADIUS;

import { claimsFor } from './predicted';

/**
 * A door you have already walked through, until the world says otherwise.
 *
 * The page does not wait for permission to open a door. It grows the room, puts the hero on its
 * floor and frames the camera on the spot, because a door that waits a round trip makes every
 * building in the country feel stuck — `predicted.ts` settles a door as `hand` and that is the
 * reason it gives. This is the other two thirds of that bargain: the number, and the undo.
 *
 * ## What the world is actually judging
 *
 * Two things, and they refuse two different lies.
 *
 * **Could he have been standing there?** The world has been walking the hero, so a step claimed on
 * the far side of the county is not a door, it is a way of travelling. `server/messages.ts` has
 * always made that judgement and always kept it to itself — it quietly substituted its own position
 * for the door and the page found out on the way back out, hauled across the county after a shop
 * visit. Now it answers, and the page can put it right at once.
 *
 * **And is there a door there at all?** A hero standing in an empty field can report a doorway at
 * his own feet, and nothing about the distance is wrong. The world grows the same villages from the
 * same seed as this page does, so it has the doorways of every one it has laid out and can say that
 * this is not one of them — `GroundWorld.atADoor`, against the tile this page sends as `at`, which
 * is a `Doorway` record copied out of the very list the world grows its own copy of.
 *
 * Neither is a judgement about the room. The world has never grown a shop floor and does not
 * intend to; what it owns is the country outside the door.
 *
 * ## What is kept, and why it is the step
 *
 * `claims.ts`: *what was given is kept, not recomputed.* The undo is "step back out onto the
 * step", and which step that is cannot be worked out when the answer arrives — two doors along a
 * street is a second or two of walking and a round trip is less, so by then the hero may be
 * standing in the next shop. So the doorstep goes into the claim, and the undo does nothing at all
 * unless he is still in the room it was made for.
 */

/** A doorstep, in the world's own tiles rather than the room's. */
export interface Step {
  x: number;
  z: number;
}

/** Everything undoing a door has to reach. */
export interface BackOut {
  /** The step of the room the hero is standing in now, or nothing when he is out of doors. */
  step: () => Step | null;
  /** Put him back on it, which is what `Places.leaveBuilding` does. */
  out: () => void;
  flash: (message: string) => void;
}

/**
 * Why he is suddenly on the step again, in the words somebody standing on it would want.
 *
 * One line for both refusals, because `stepped` carries `ok` and nothing else, and widening the
 * wire to tell a player *which* way the world disagreed would be telling them something they
 * cannot act on either way. It used to name the reach — "a door you could have reached" — which
 * stopped being the whole truth the moment the world could also refuse one for not being there.
 */
const REFUSED = 'You did not come through that door.';

export class Enterings {
  /** The keeping and the numbering, which is the same in every one of these. See `claims.ts`. */
  private readonly claims = claimsFor<Step>('door');

  /** How many answers are still owed. Nothing needs it but a probe and a test. */
  get pending(): number { return this.claims.pending; }

  /** The page has walked him in. Keep the step he came in by, and take a number for the answer. */
  ask(step: Step): number {
    return this.claims.ask(step);
  }

  /**
   * The world has answered.
   *
   * Agreement costs nothing, which is the case that happens: the claim is forgotten and the hero
   * goes on standing in the room. A refusal steps him back out onto the step he came in by — and
   * only if that is still the room he is in, because an answer that arrives after he has walked
   * out by himself has nothing to undo, and one that arrives after he has walked into the *next*
   * shop would throw him out of a room the world never said a word about.
   */
  answered(seq: number, ok: boolean, o: BackOut): void {
    const given = this.claims.answered(seq);
    if (!given || ok) return;                // agreed, answered twice, or somebody else's number
    const here = o.step();
    if (!here || here.x !== given.x || here.z !== given.z) return;
    o.out();
    o.flash(REFUSED);
  }
}

import { DUEL_RANGE, type Presence } from '../../server/protocol';
import { claimsFor } from './predicted';

/**
 * A blow of our own, as it actually fell, kept so it can be put back exactly.
 *
 * `took` rather than the damage swung, because `landed` floors at nought: a blow against somebody
 * on his last heart takes one and not the six that were thrown, and an undo that worked it out
 * again would invent five. That is `claims.ts`'s rule — *what was given is kept, not recomputed* —
 * and this is the whole of what it means here.
 */
interface Blow {
  took: number;
  /** Whether that blow was the one that emptied them, which is the only reason to stand them up. */
  felled: boolean;
}

/**
 * A friendly bout between two players. Nothing real is at stake: each side keeps a separate pool
 * of duel health, so a hero who loses walks away with the same hearts, gear and gold they came
 * with. Blows are reported to the other client, which decides what they do to it, exactly as a
 * dungeon floor's owner decides what a guest's blow does to a monster.
 */
export class Duel {
  /** Who we are fighting, or empty when nobody. */
  opponent = '';
  opponentName = '';
  /** Health in this bout only, never the hero's own. */
  mine = 0;
  theirs = 0;
  private full = 0;
  /** Blows thrown and not yet answered for. See `claims.ts`; the undo is `answered` below. */
  private readonly blows = claimsFor<Blow>('swing');

  get active(): boolean { return this.opponent !== ''; }

  /** How many blows are still owed an answer. Nothing in the game needs it; a probe and a test do. */
  get owed(): number { return this.blows.pending; }

  /** Step into the ring against somebody, both sides starting on the same footing. */
  begin(id: string, name: string, health: number): void {
    this.opponent = id;
    this.opponentName = name;
    this.full = health;
    this.mine = health;
    this.theirs = health;
  }

  /**
   * Take a blow the other side says it landed.
   * @returns true when that was the blow that finished it
   */
  struck(damage: number): boolean {
    if (!this.active) return false;
    this.mine = Math.max(0, this.mine - damage);
    return this.mine === 0;
  }

  /**
   * Note a blow of our own, so the readout moves before their next word reaches us.
   *
   * @returns the number the world will answer this blow by. The page throws first — a blow that
   * waits for a round trip is the letterbox #235 is against, and `predicted.ts` settles a swing as
   * `hand` — and keeps what it took until the answer arrives.
   */
  landed(damage: number): number {
    if (!this.active) return 0;
    const was = this.theirs;
    this.theirs = Math.max(0, was - damage);
    return this.blows.ask({ took: was - this.theirs, felled: this.theirs === 0 });
  }

  /**
   * The world did not carry that blow, so neither do we.
   *
   * `server/messages.ts` used to drop a `duel-hit` without a word whenever the bout had already
   * ended on its side — somebody yields, and a blow already thrown arrives a moment later — and
   * the page went on showing health it had taken off the readout in the corner of the screen.
   *
   * Only what this blow took, and only onto somebody it left standing: answers do not arrive in
   * the order blows were thrown, so undoing an earlier one after a later one finished the bout
   * would stand back up a man the whole ring watched go down. `felled` says whether this was the
   * blow that did it, which is the one case where nought is the right thing to come back from.
   */
  answered(seq: number, stood: boolean): void {
    const blow = this.blows.answered(seq);
    if (!blow || stood || !this.active) return;
    if (blow.took <= 0 || (this.theirs === 0 && !blow.felled)) return;
    this.theirs = Math.min(this.full, this.theirs + blow.took);
  }

  /** Whether somebody is close enough and near enough in front to be struck. */
  inReach(them: Presence, x: number, z: number, yaw: number, arc: number): boolean {
    const dx = them.x - x, dz = them.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance > DUEL_RANGE || distance === 0) return false;
    const facing = (dx / distance) * Math.cos(yaw) + (dz / distance) * -Math.sin(yaw);
    return facing >= Math.cos(arc);
  }

  end(): void {
    this.opponent = '';
    this.opponentName = '';
    this.mine = 0;
    this.theirs = 0;
  }

  /** The bout as one line, for the corner of the screen. */
  readout(): string {
    return this.active ? `Duel with ${this.opponentName} — you ${this.mine}/${this.full}, them ${this.theirs}/${this.full}` : '';
  }
}

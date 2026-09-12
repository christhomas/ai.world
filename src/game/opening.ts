import { Claims } from './claims';

/**
 * A chest you have already opened, until the world says otherwise.
 *
 * The page does not wait for permission to open a chest. It lifts the lid, puts the gold in your
 * purse and tells you what was in it, and *then* asks — because a chest that waits a round trip
 * before it opens does not feel like a chest, it feels like a form being submitted. That is the
 * same bargain walking has made since the world started holding the hero: act now, be put right
 * later.
 *
 * Being put right is what this file is. It keeps what the page gave itself, numbered, until the
 * world's answer arrives; then it either forgets it, or takes it all back.
 *
 * Two things make the bargain a safe one here. The gold and the prize are worked out from the
 * vault's seed by a rule both halves run, so they agree by construction and a correction is rare.
 * And what the world actually decides is not what was inside but whether you could open it at all —
 * standing on that floor, within reach, and first — which is the sort of thing a client is wrong
 * about roughly never and lying about occasionally.
 */

/** What the page handed itself when it lifted the lid. */
export interface Opened {
  /** The chest, so it can be shut again. */
  id: string;
  gold: number;
  prize: string | null;
  /** The treasure-room lock this chest's key opened, if it held one. */
  lock: string | null;
}

/** What the world said was in it. */
export interface Told {
  ok: boolean;
  gold: number;
  key: boolean;
  prize: string | null;
}

/** Everything undoing an opened chest has to reach. */
export interface PutBack {
  /** Coin in or out of the purse: negative takes it away again. */
  gold: (by: number) => void;
  /** An item in or out of the pack, by the same sign. */
  carry: (item: string, by: number) => void;
  /** Shut the lid again, and draw it shut. */
  shut: (id: string) => void;
  /** Bar the treasure-room door again. */
  bar: (lock: string) => void;
  flash: (message: string) => void;
}

/** Why the world said no, in the words somebody standing in a vault would want. */
export const REFUSED = 'Somebody had already been through that chest.';

export class Openings {
  /** The keeping and the numbering, which is the same in every one of these. See `claims.ts`. */
  private readonly claims = new Claims<Opened>();

  /** How many answers are still owed. Nothing needs it but a probe and a test. */
  get pending(): number { return this.claims.pending; }

  /** The page has opened one. Keep what it gave itself, and take a number for the answer. */
  ask(given: Opened): number {
    return this.claims.ask(given);
  }

  /**
   * The world has answered.
   *
   * A refusal takes back everything: the gold, the prize and the key, and the chest is shut so the
   * next person to walk past it — including you — sees it as it is. An answer that agrees costs
   * nothing, which is the case that happens. An answer that differs is settled in the world's
   * favour item by item rather than by undoing and redoing the whole thing, because the player is
   * standing there watching the corner of the screen and a chest that opens twice is worse than a
   * purse that quietly settles on the right number.
   */
  answered(seq: number, told: Told, o: PutBack): void {
    const given = this.claims.answered(seq);
    if (!given) return;                      // an answer to something else, or answered twice

    if (!told.ok) {
      o.gold(-given.gold);
      if (given.prize) o.carry(given.prize, -1);
      if (given.lock) o.bar(given.lock);
      o.shut(given.id);
      o.flash(REFUSED);
      return;
    }

    if (told.gold !== given.gold) o.gold(told.gold - given.gold);
    if (told.prize !== given.prize) {
      if (given.prize) o.carry(given.prize, -1);
      if (told.prize) o.carry(told.prize, 1);
    }
    // a key the world says was not there is a door that has to bar itself again, which is the one
    // correction a player can walk into: the room beyond it was open a moment ago
    if (!told.key && given.lock) o.bar(given.lock);
  }

  /*
   * There is deliberately no way to forget what is owed.
   *
   * A hero who opens a chest and walks up two flights of stairs before the answer arrives still has
   * the gold in his purse, so the answer still has somewhere to land. What cannot follow him is the
   * *drawing* of it — shutting a lid on a floor he is no longer standing on — and that is checked
   * by whoever holds the floor rather than here.
   */
}

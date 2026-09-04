import type { GameState } from './state';

/**
 * Goods and gold handed over to the server but not yet answered for: an item put on a stall, the
 * rent for a pitch, a parcel left at an inn. They leave the pack at once, so the game feels
 * immediate, and come back if the server refuses.
 *
 * Only one thing is ever in the air at a time, because a player can only be at one counter.
 */
export class Handover {
  private item: string | null = null;
  private gold = 0;

  /** Take something out of the pack in the hope the server takes it. */
  offer(state: GameState, item: string | null, gold = 0): void {
    if (item) state.take(item, 1);
    if (gold > 0) state.inventory.gold = Math.max(0, state.inventory.gold - gold);
    this.item = item;
    this.gold = gold;
    state.version++;
  }

  /** The server took it. Nothing to give back. */
  settle(): void {
    this.item = null;
    this.gold = 0;
  }

  /**
   * The server would not take it, so it is the player's again.
   * @returns whether anything came back
   */
  giveBack(state: GameState): boolean {
    if (!this.item && this.gold === 0) return false;
    if (this.item) state.give(this.item, 1);
    state.inventory.gold += this.gold;
    state.version++;
    this.settle();
    return true;
  }

  get pending(): boolean { return this.item !== null || this.gold > 0; }
}

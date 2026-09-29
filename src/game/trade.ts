import type { TradeOffer } from '../../server/protocol';
import { ITEMS } from './items';
import type { GameState } from './state';

/**
 * Apply a finished trade to your own state. The sender loses what they offered; the receiver
 * gains it. Nothing is created: the server never touches anyone's purse, each side does its half.
 */
export function applyTrade(state: GameState, offer: TradeOffer, iSent: boolean): string {
  const names: string[] = [];
  if (iSent) {
    state.inventory.gold = Math.max(0, state.inventory.gold - offer.gold);
    for (const [id, n] of offer.items) state.take(id, n);
  } else {
    state.inventory.gold += offer.gold;
    for (const [id, n] of offer.items) state.give(id, n);
  }
  if (offer.gold > 0) names.push(`${offer.gold} gold`);
  for (const [id, n] of offer.items) names.push(`${n}× ${ITEMS[id]?.name ?? id}`);
  state.version++;
  return names.join(', ') || 'nothing';
}

/** Everything you are carrying that could be handed over, most valuable first. */
export function tradableItems(state: GameState): Array<[string, number]> {
  return [...state.inventory.items.entries()]
    .filter(([id]) => ITEMS[id])
    .sort((a, b) => (ITEMS[b[0]].price * b[1]) - (ITEMS[a[0]].price * a[1]));
}

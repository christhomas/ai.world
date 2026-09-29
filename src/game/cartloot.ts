import type { CarrierFact } from '../world/carrierbook';
import type { GameState } from './state';

/** Put a recorded robbery's whole meals in the named hero's pack at most once. */
export function claimCartCargo(state: GameState, name: string, facts: readonly CarrierFact[]): number {
  let taken = 0;
  for (const finish of facts) {
    if (finish.kind !== 'cart-finished' || finish.outcome !== 'robbed'
      || (finish.robberId ? finish.robberId !== state.playerId : finish.robber !== name)
      || state.claimedCarts.has(finish.loadedOn)) continue;
    const load = facts.find((fact) => fact.kind === 'cart-loaded' && fact.day === finish.loadedOn);
    if (!load || load.kind !== 'cart-loaded') continue;
    const meals = Math.floor(load.meals);
    if (meals > 0) state.give('apple', meals);
    state.claimedCarts.add(finish.loadedOn);
    taken += meals;
  }
  if (taken > 0) state.version++;
  return taken;
}

import { cartPosition, type CartLoaded } from '../../world/carrierbook';
import type { Surroundings } from './context';

/** Inspect the load and choose how to meet the person walking it. */
export function carrierInteractions(ctx: Surroundings) {
  const { player, state, structures, sampler, register, online, dialogue } = ctx;
  const tryCarrier = (preview = false): boolean => {
    if (!online.connected) return false;
    const facts = register.carrierFacts();
    const load = facts.find((fact): fact is CartLoaded => fact.kind === 'cart-loaded'
      && fact.day === state.day && !facts.some((end) => end.kind === 'cart-finished' && end.loadedOn === fact.day));
    if (!load) return false;
    const at = cartPosition(load, state.time, structures.villages, sampler.graph);
    if (!at || Math.hypot(at.x - player.x, at.z - player.z) > 3) return false;
    if (preview) return true;
    dialogue.start({ speaker: `Carrier to ${load.to}`, emoji: '🧺',
      pages: [`A traveller is taking ${load.meals.toFixed(1)} meals from ${load.from} to ${load.to}. The buyers' money waits until it arrives.`],
      choices: [
        { label: 'Guard the load (choose again to stop)', next: () => { online.cartAction('escort-cart', load.day); return null; } },
        { label: 'Rob the load', next: () => { online.cartAction('rob-cart', load.day); return null; } },
        { label: 'Let them pass', next: () => null },
      ] });
    return true;
  };
  return { tryCarrier };
}

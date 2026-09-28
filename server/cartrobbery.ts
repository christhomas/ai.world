import type { Register } from '../src/world/register';
import { cartPosition, type CartFinished, type CartLoaded } from '../src/world/carrierbook';

/** A cart can be intercepted only while the loaded journey is the world's current day. */
export function robLoadedCart(
  register: Register,
  day: number,
  time: number,
  robber: { x: number; z: number },
  villages: readonly { name: string; x: number; z: number }[],
  loadedOn: number,
  persist: (fact: CartFinished) => boolean,
): CartFinished | null {
  if (!Number.isInteger(day) || day !== register.today || !Number.isInteger(loadedOn)
    || loadedOn !== day || !Number.isFinite(time) || time < 0 || time >= 1
    || !Number.isFinite(robber.x) || !Number.isFinite(robber.z)) return null;
  const facts = register.carrierFacts();
  const load = facts.find((fact): fact is CartLoaded => fact.kind === 'cart-loaded' && fact.day === loadedOn);
  if (!load || facts.some((fact) => fact.kind === 'cart-finished' && fact.loadedOn === loadedOn)) return null;
  const at = cartPosition(load, time, villages);
  if (!at || Math.hypot(robber.x - at.x, robber.z - at.z) > 4) return null;
  const fact = register.finishCarrier(loadedOn, 'robbed');
  if (!fact || !persist(fact) || !register.recordCarrier(fact)) return null;
  return fact;
}

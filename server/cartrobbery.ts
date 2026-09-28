import type { Register } from '../src/world/register';
import { cartPosition, type CartFinished, type CartLoaded } from '../src/world/carrierbook';
import type { RoadGraph } from '../src/world/graph';

/** An enlisted escort only protects a cart while physically beside it. */
export function cartGuarded<T extends { escortingCart: number | null; standingIn: string;
  hero: { x: number; z: number } | null }>(
  clients: Iterable<T>, robber: T, loadedOn: number, at: { x: number; z: number } | null,
): boolean {
  if (!at) return false;
  for (const client of clients) {
    if (client !== robber && client.escortingCart === loadedOn && client.standingIn === 'surface'
      && client.hero && Math.hypot(client.hero.x - at.x, client.hero.z - at.z) <= 4) return true;
  }
  return false;
}

/** A cart can be intercepted only while the loaded journey is the world's current day. */
export function robLoadedCart(
  register: Register,
  day: number,
  time: number,
  robber: { x: number; z: number },
  villages: readonly { name: string; x: number; z: number }[],
  loadedOn: number,
  persist: (fact: CartFinished) => boolean,
  graph?: RoadGraph,
  robberName?: string,
): CartFinished | null {
  if (!Number.isInteger(day) || day !== register.today || !Number.isInteger(loadedOn)
    || loadedOn !== day || !Number.isFinite(time) || time < 0 || time >= 1
    || !Number.isFinite(robber.x) || !Number.isFinite(robber.z)) return null;
  const facts = register.carrierFacts();
  const load = facts.find((fact): fact is CartLoaded => fact.kind === 'cart-loaded' && fact.day === loadedOn);
  if (!load || facts.some((fact) => fact.kind === 'cart-finished' && fact.loadedOn === loadedOn)) return null;
  const at = cartPosition(load, time, villages, graph);
  if (!at || Math.hypot(robber.x - at.x, robber.z - at.z) > 4) return null;
  const prepared = register.finishCarrier(loadedOn, 'robbed');
  const fact = prepared && robberName ? { ...prepared, robber: robberName } : prepared;
  if (!fact || !persist(fact) || !register.recordCarrier(fact)) return null;
  return fact;
}

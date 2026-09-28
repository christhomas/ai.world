import type { GroundWorld } from '../src/world/groundworld';
import type { Register } from '../src/world/register';
import type { Village } from '../src/world/structures';
import { cartPosition, type CartLoaded } from '../src/world/carrierbook';
import type { CreatureSnap } from './protocol';

/**
 * A cart is drawn as one named carrier, with its cargo in the description players can inspect.
 * This is a view of a dated load, not a village-bound behaviour tree: its unwatched and replayed
 * counterpart is CarrierBook plus advanceWorldCarriers, rather than an entry in entity LONG_RUN.
 * Both paths read the same load and finish facts, so watching cannot make a second delivery.
 */
export function carrierOnRoad(
  register: Register, villages: readonly Village[], ground: GroundWorld,
  day: number, time: number,
): CreatureSnap | null {
  const facts = register.carrierFacts();
  const load = facts.find((fact): fact is CartLoaded => fact.kind === 'cart-loaded' && fact.day === day);
  if (!load || facts.some((fact) => fact.kind === 'cart-finished' && fact.loadedOn === day)) return null;
  const from = villages.find((village) => village.name === load.from);
  if (!from) return null;
  const graph = ground.roadGraphAt(from.x, from.z);
  const at = cartPosition(load, time, villages, graph);
  if (!at) return null;
  const ahead = cartPosition(load, Math.min(1, time + 0.001), villages, graph) ?? at;
  const y = ground.heightAt(at.x, at.z);
  if (y === null) return null;
  return {
    id: -day, kind: 'villager', x: at.x, z: at.z, y,
    yaw: Math.atan2(ahead.z - at.z, ahead.x - at.x), walk: 1, state: 'idle', hp: 1,
    who: { person: '', name: `Carrier to ${load.to}`, trade: 'carrier', role: 'villager',
      village: load.from, doing: `carrying ${load.meals} meals`, trades: [],
      mind: { memories: [], opinions: [] } },
  };
}

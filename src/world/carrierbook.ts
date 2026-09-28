import { ownedBy, ownerFromSave, type Owner } from './holdings';
import { payAndSweep } from './purses';
import { cellarCap } from './food';
import type { Carrying, CarryingOutcome } from './carriers';
import type { Settlement } from './settlement';
import type { RoadGraph } from './graph';

/** A cart's immutable load, including the exact owners and sums agreed at departure. */
export interface CartLoaded {
  kind: 'cart-loaded';
  day: number;
  from: string;
  to: string;
  meals: number;
  price: number;
  paying: [string, number][];
  paid: [string, number][];
}

/** Its later outcome. A robbed load disappears; nobody pays and nobody receives it. */
export interface CartFinished {
  kind: 'cart-finished';
  day: number;
  loadedOn: number;
  outcome: CarryingOutcome;
  /** Where the held buyer money went: sender on delivery, buyer (or its hall) on robbery. */
  receiving: [string, number][];
  /** A robbed load's taker; the loaded fact carries the exact meals lost. */
  robber?: string;
}

export type CarrierFact = CartLoaded | CartFinished;

/** Where a loaded cart is between its two markets during its one day in flight. */
const routes = new WeakMap<RoadGraph, Map<string, { x: number; z: number }[]>>();

/** Follow the shortest connected road between the two village crossroads. */
function roadRoute(graph: RoadGraph, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] | null {
  const key = `${from.x},${from.z}:${to.x},${to.z}`;
  let cache = routes.get(graph);
  if (!cache) { cache = new Map(); routes.set(graph, cache); }
  const known = cache.get(key);
  if (known) return known;
  const nearest = (point: { x: number; z: number }): number => graph.nodes.reduce((best, node, i) =>
    Math.hypot(node.x - point.x, node.z - point.z) < Math.hypot(graph.nodes[best].x - point.x, graph.nodes[best].z - point.z) ? i : best, 0);
  if (graph.nodes.length === 0) return null;
  const start = nearest(from), end = nearest(to);
  const neighbours: Array<Array<[number, number]>> = graph.nodes.map(() => []);
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a], b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const length = Math.hypot(a.x - b.x, a.z - b.z);
    neighbours[edge.a].push([edge.b, length]);
    neighbours[edge.b].push([edge.a, length]);
  }
  const distance = graph.nodes.map(() => Infinity), previous = graph.nodes.map(() => -1);
  const open = new Set<number>([start]);
  distance[start] = 0;
  while (open.size) {
    let current = -1;
    for (const node of open) if (current < 0 || distance[node] < distance[current]) current = node;
    if (current === end) break;
    open.delete(current);
    for (const [next, length] of neighbours[current]) {
      const candidate = distance[current] + length;
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      previous[next] = current;
      open.add(next);
    }
  }
  if (!Number.isFinite(distance[end])) return null;
  const points = [to];
  for (let node = end; node >= 0; node = previous[node]) {
    points.push(graph.nodes[node]);
    if (node === start) break;
  }
  points.push(from);
  points.reverse();
  cache.set(key, points);
  return points;
}

export function cartPosition(
  load: CartLoaded, time: number,
  villages: readonly { name: string; x: number; z: number }[],
  graph?: RoadGraph,
): { x: number; z: number } | null {
  const from = villages.find((village) => village.name === load.from);
  const to = villages.find((village) => village.name === load.to);
  if (!from || !to || !Number.isFinite(time)) return null;
  const progress = Math.max(0, Math.min(1, time));
  const points = graph ? roadRoute(graph, from, to) : null;
  if (!points) return { x: from.x + (to.x - from.x) * progress,
    z: from.z + (to.z - from.z) * progress };
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.z - points[i].z));
  let left = lengths.reduce((sum, length) => sum + length, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const part = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * part,
        z: points[i].z + (points[i + 1].z - points[i].z) * part };
    }
    left -= lengths[i];
  }
  return points[0];
}

export function cartLoaded(day: number, cart: Carrying): CartLoaded {
  return {
    kind: 'cart-loaded', day, from: cart.from, to: cart.to,
    meals: cart.meals, price: cart.price,
    paying: [...cart.paying], paid: [...cart.paid],
  };
}

/** Fix the final recipient while the world can still see who is alive at the destination. */
export function cartFinished(
  day: number, load: CartLoaded, outcome: CarryingOutcome,
  villages: ReadonlyMap<string, Settlement>,
): CartFinished {
  const here = villages.get(outcome === 'delivered' ? load.from : load.to);
  if (!here) throw new Error('A cart cannot finish without its receiving village.');
  const alive = new Set([...here.people.map((person) => person.id), here.hall.id]);
  const quote = outcome === 'delivered' ? load.paid : load.paying.map(
    ([id, amount]) => [id, -amount] as [string, number],
  );
  const receiving = new Map<string, number>();
  for (const [id, amount] of quote) {
    const recipient = alive.has(id) ? id : here.hall.id;
    receiving.set(recipient, (receiving.get(recipient) ?? 0) + amount);
  }
  return { kind: 'cart-finished', day, loadedOn: load.day, outcome, receiving: [...receiving] };
}

const sum = (entries: readonly [string, number][]): number =>
  entries.reduce((total, [, amount]) => total + amount, 0);

function validLoad(load: CartLoaded): boolean {
  if (!Array.isArray(load.paying) || !Array.isArray(load.paid)) return false;
  const entries = [...load.paying, ...load.paid];
  return Number.isInteger(load.day) && load.day >= 2
    && typeof load.from === 'string' && typeof load.to === 'string'
    && load.from.length > 0 && load.to.length > 0 && load.from !== load.to
    && Number.isFinite(load.meals) && load.meals > 0
    && Number.isFinite(load.price) && load.price > 0
    && load.paying.length > 0 && load.paid.length > 0
    && entries.every((entry) => Array.isArray(entry) && entry.length === 2
      && typeof entry[0] === 'string' && entry[0].length > 0 && Number.isFinite(entry[1]))
    && load.paying.every(([, amount]) => amount < 0)
    && load.paid.every(([, amount]) => amount > 0)
    && new Set(load.paying.map(([id]) => id)).size === load.paying.length
    && new Set(load.paid.map(([id]) => id)).size === load.paid.length
    && Math.abs(sum(load.paying) + sum(load.paid)) < 1e-6
    && Math.abs(-sum(load.paying) - load.meals * load.price) < 1e-6;
}

/**
 * Dated, serializable carrier facts. Applying one village at a time lets a late settlement and a
 * relived village see the same evening's cart without asking their neighbour to live again.
 */
export class CarrierBook {
  private readonly loads = new Map<number, CartLoaded>();
  private readonly finishes = new Map<number, CartFinished>();

  record(fact: CarrierFact): boolean {
    if (fact.kind === 'cart-loaded') {
      if (!validLoad(fact) || this.loads.has(fact.day)) return false;
      const finish = this.finishes.get(fact.day);
      if (finish && !this.validFinish(finish, fact)) return false;
      this.loads.set(fact.day, {
        ...fact, paying: fact.paying.map(([id, amount]) => [id, amount]),
        paid: fact.paid.map(([id, amount]) => [id, amount]),
      });
      return true;
    }
    if (!Number.isInteger(fact.day) || !Number.isInteger(fact.loadedOn)
      || fact.loadedOn < 2 || fact.day < fact.loadedOn
      || (fact.outcome !== 'delivered' && fact.outcome !== 'robbed')
      || (fact.robber !== undefined && (fact.outcome !== 'robbed'
        || typeof fact.robber !== 'string' || fact.robber.length === 0 || fact.robber.length > 64))
      || this.finishes.has(fact.loadedOn)
      || !this.validFinish(fact, this.loads.get(fact.loadedOn))) return false;
    this.finishes.set(fact.loadedOn, {
      ...fact, receiving: fact.receiving.map(([id, amount]) => [id, amount]),
    });
    return true;
  }

  private validFinish(finish: CartFinished, load?: CartLoaded): boolean {
    if (!Array.isArray(finish.receiving) || finish.receiving.length === 0
      || !finish.receiving.every((entry) => Array.isArray(entry) && entry.length === 2
        && typeof entry[0] === 'string' && entry[0].length > 0
        && Number.isFinite(entry[1]) && entry[1] > 0)
      || new Set(finish.receiving.map(([id]) => id)).size !== finish.receiving.length) return false;
    return !load || Math.abs(sum(finish.receiving) + sum(load.paying)) < 1e-6;
  }

  load(on: number): CartLoaded | undefined { return this.loads.get(on); }
  finish(loadedOn: number): CartFinished | undefined { return this.finishes.get(loadedOn); }

  facts(): CarrierFact[] {
    return [...this.loads.values(), ...this.finishes.values()]
      .sort((a, b) => a.day - b.day
        || (a.kind === b.kind ? ('loadedOn' in a && 'loadedOn' in b ? a.loadedOn - b.loadedOn : 0)
          : a.kind === 'cart-loaded' ? -1 : 1));
  }

  /** Villages whose past must be rebuilt after this newly recorded fact. */
  affectedBy(fact: CarrierFact, today: number): string[] {
    const load = fact.kind === 'cart-loaded' ? fact : this.load(fact.loadedOn);
    if (!load) return [];
    const finish = fact.kind === 'cart-finished' ? fact : this.finish(fact.day);
    const affected = new Set<string>();
    if (fact.kind === 'cart-loaded' && load.day <= today) {
      affected.add(load.from);
      affected.add(load.to);
    }
    if (finish && finish.day <= today) {
      affected.add(finish.outcome === 'delivered' ? load.from : load.to);
      if (finish.outcome === 'delivered') affected.add(load.to);
    }
    return [...affected];
  }

  /** Apply this village's share of facts after its ordinary day, on either clock path. */
  applyOn(village: string, here: Settlement, day: number): void {
    const load = this.loads.get(day);
    if (load) this.applyFactOn(load, village, here);
    for (const [loadedOn, finish] of this.finishes) {
      if (finish.day === day && this.loads.has(loadedOn)) this.applyFactOn(finish, village, here);
    }
  }

  /** Apply only a newly authored fact on the current evening, without reliving all past days. */
  applyFactOn(fact: CarrierFact, village: string, here: Settlement): void {
    if (fact.kind === 'cart-loaded') {
      if (fact.from === village) {
        if (here.food + 1e-8 < fact.meals) throw new Error('A cart cannot load absent food.');
        here.food -= fact.meals;
      }
      if (fact.to === village) {
        const owners = new Map<Owner, number>(here.people.map((person) => [ownedBy(person), person.purse]));
        owners.set(here.hall.id, here.hall.purse);
        if (fact.paying.some(([id, amount]) => !owners.has(ownerFromSave(id))
          || owners.get(ownerFromSave(id))! + amount < -1e-8)) {
          throw new Error('A cart cannot reserve money absent from its buyer.');
        }
        payAndSweep(here, new Map(fact.paying.map(([id, amount]) => [ownerFromSave(id), amount])));
      }
      return;
    }
    const load = this.loads.get(fact.loadedOn);
    if (!load) return;
    if (fact.outcome === 'delivered' && load.to === village) {
      if (here.food + load.meals > cellarCap(here.people) + 1e-8) {
        throw new Error('A delivered cart exceeds its buyer\'s cellar.');
      }
      here.food += load.meals;
    }
    const creditedVillage = fact.outcome === 'delivered' ? load.from : load.to;
    if (creditedVillage !== village) return;
    const owners = new Set<Owner>([...here.people.map(ownedBy), here.hall.id]);
    if (fact.receiving.some(([id]) => !owners.has(ownerFromSave(id)))) {
      throw new Error('A cart cannot settle against a missing recipient.');
    }
    payAndSweep(here, new Map(fact.receiving.map(([id, amount]) => [ownerFromSave(id), amount])));
  }

  /** The cart's per-owner ledger on the current day, reconstructed rather than accumulated. */
  carriedBy(day: number, id: string): number {
    let amount = 0;
    const load = this.loads.get(day);
    if (load) amount += load.paying
      .filter(([owner]) => owner === id).reduce((total, [, much]) => total + much, 0);
    for (const [loadedOn, finish] of this.finishes) {
      if (finish.day !== day) continue;
      const cart = this.loads.get(loadedOn);
      if (cart) amount += finish.receiving
        .filter(([owner]) => owner === id).reduce((total, [, much]) => total + much, 0);
    }
    return amount;
  }
}

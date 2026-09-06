import type * as THREE from 'three';
import type { Entity } from './entity';

/**
 * What the entity manager needs from whatever is showing its creatures.
 *
 * The game's answer is `EntityRenderer`, which puts them in instanced meshes and hands back the one
 * a mouse is pointing at. The server's answer is a list. Naming the surface between them is what
 * lets the same manager run in both places — the herds, the trades, the fights and the burials are
 * the game's rules, and rules should not have to be written twice because one of the two machines
 * has a screen.
 */
export interface EntityView {
  /** Take this creature. False when there is no room, which stops a spawn mid-herd. */
  add(e: Entity): boolean;
  remove(e: Entity): void;
  /** What a mouse could be pointing at. Empty where there is no mouse. */
  pickables(): THREE.Object3D[];
  entityAt(hit: THREE.Intersection): Entity | null;
  readonly count: number;
}

/**
 * Everything alive, as a server sees it: a list, and no more than that.
 *
 * There is a cap because a simulation with no screen has no natural limit — the renderer's pools
 * are what stops the game drawing ten thousand rabbits, and without something in its place a bug in
 * spawning would be found as a memory graph rather than as a wrong picture.
 */
export class Roster implements EntityView {
  private readonly alive = new Set<Entity>();

  constructor(private readonly most = 4_000) {}

  add(e: Entity): boolean {
    if (this.alive.size >= this.most) return false;
    this.alive.add(e);
    return true;
  }

  remove(e: Entity): void {
    this.alive.delete(e);
  }

  /** Nothing to point at with no mouse in the room. */
  pickables(): THREE.Object3D[] { return []; }

  entityAt(): Entity | null { return null; }

  get count(): number { return this.alive.size; }

  /** Everything alive, for whoever has to tell the players about it. */
  all(): Iterable<Entity> { return this.alive; }
}

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

  /**
   * The most a world will hold at once — a backstop, and no longer a policy.
   *
   * C1 called this "the threshold that is obviously wrong" and it was right: four thousand is a
   * per-world cap that happened to match what one laptop could tick, so the cap and the hardware
   * agreed by coincidence. On a Pi the hardware would have said four hundred while this went on
   * saying four thousand.
   *
   * What answers that now is `pace.ts`, and it answers a different question. **How many creatures
   * exist is the world's business and how many are thought for is the machine's** — so the budget
   * sheds *thinking*, by distance, and never population, because two players standing in one field
   * must see the same deer. This number stays as what it should always have been: a ceiling that
   * says a world holding four thousand creatures has gone wrong somewhere, not a decision about
   * how busy a world ought to be.
   *
   * The old complaint against it stands and is not fixed here: refusing a spawn part way through a
   * herd leaves a flock of two where the world meant eight. It is left because at four thousand it
   * is unreachable in play — nothing measured has come within a factor of two of it — and because
   * the honest fix is for a herd to be admitted or refused whole, which is a change to how a herd
   * is placed rather than to what it is counted against.
   */
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

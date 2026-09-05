import { hash3, hashString } from '../core/rng';
import { SALT } from '../core/salts';

/**
 * The seed tree. The root seed makes the mainland; every expansion (an island, a dungeon under
 * a shrine, ...) is an anchor with its own seed, attached at a location. Seeds are derived from the
 * parent by default, so the tree is reproducible from the root alone, but the manifest is persisted:
 * a stored anchor can be overridden, keeps its generator version, and new kinds can be appended
 * later without disturbing anything already there.
 */
export type AnchorKind = 'island' | 'dungeon' | 'cave' | 'wreck' | 'thicket';

export interface Anchor {
  id: string;
  kind: AnchorKind;
  /** Where the anchor attaches to its parent's world, in tiles. */
  x: number;
  z: number;
  seed: number;
  parent: string | null;
  /** Generator version that produced this anchor's content. */
  version: number;
}

export interface ManifestJson {
  rootSeed: number;
  anchors: Anchor[];
}

const KIND_SALT: Record<AnchorKind, number> = { island: SALT.ISLAND, dungeon: SALT.DUNGEON, cave: SALT.CAVE, wreck: SALT.WRECK, thicket: SALT.FOREST };

/** Current generator version per kind; bump when a generator changes so old anchors stay pinned. */
export const ANCHOR_VERSION: Record<AnchorKind, number> = { island: 1, dungeon: 1, cave: 1, wreck: 1, thicket: 1 };

export class Manifest {
  readonly anchors = new Map<string, Anchor>();

  constructor(readonly rootSeed: number, saved?: ManifestJson) {
    if (saved && saved.rootSeed === rootSeed) for (const a of saved.anchors) this.anchors.set(a.id, a);
  }

  get(id: string): Anchor | undefined { return this.anchors.get(id); }

  byKind(kind: AnchorKind): Anchor[] {
    return [...this.anchors.values()].filter((a) => a.kind === kind);
  }

  /** Default seed for an anchor: parent's seed, the id, and the kind's salt. Order-independent. */
  deriveSeed(id: string, kind: AnchorKind, parent: string | null): number {
    const parentSeed = parent ? this.anchors.get(parent)?.seed ?? this.rootSeed : this.rootSeed;
    return hash3(parentSeed, hashString(id), 0, KIND_SALT[kind]);
  }

  /** Return the stored anchor, or create it with a derived seed. */
  ensure(id: string, kind: AnchorKind, x: number, z: number, parent: string | null = null): Anchor {
    let a = this.anchors.get(id);
    if (!a) {
      a = { id, kind, x, z, seed: this.deriveSeed(id, kind, parent), parent, version: ANCHOR_VERSION[kind] };
      this.anchors.set(id, a);
    }
    return a;
  }

  /** Hand-pick a seed for one anchor without touching the rest of the world. */
  override(id: string, seed: number): void {
    const a = this.anchors.get(id);
    if (a) a.seed = seed >>> 0;
  }

  toJSON(): ManifestJson {
    return { rootSeed: this.rootSeed, anchors: [...this.anchors.values()] };
  }
}

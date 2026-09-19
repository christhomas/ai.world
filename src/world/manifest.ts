import { hash3, hashString } from '../core/rng';
import { SALT } from '../core/salts';

/**
 * The seed tree. The root seed makes the mainland; every expansion (an island, a dungeon under
 * a shrine, ...) is an anchor with its own seed, attached at a location. Seeds are derived from the
 * parent by default, so the tree is reproducible from the root alone, but the manifest is persisted:
 * a stored anchor can be overridden, keeps its generator version, and new kinds can be appended
 * later without disturbing anything already there.
 *
 * `eyrie` is the odd one and the reason is worth knowing, because #324 makes a rule of it for
 * everything that follows. Every other kind here is a place the *seed* implied and the manifest
 * merely pinned. An eyrie is a place a **player** made: somebody carried a carcass up a mountain,
 * an eagle came, and no seed can be asked about that. So the anchor is not a pin on a derived
 * fact, it is the record of the fact itself — the dice were thrown once when the carcass went
 * down, and this entry is what they gave. See `game/baiting.ts`.
 */
export type AnchorKind = 'island' | 'dungeon' | 'cave' | 'wreck' | 'thicket' | 'skyisle' | 'eyrie' | 'highland';

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
  /**
   * What this anchor does to the height of the ground, for the kinds of anchor that are a layer
   * of it rather than a place on it. How far the lift reaches in tiles, and how high it lifts in
   * terraces.
   *
   * Absent on every other kind, and on every world saved before there were any — which is why it
   * is optional rather than defaulted. A `highland` anchor without it is a place somebody pinned
   * and not a shape, and `elevationFor` reads it as no layer at all rather than as a flat one.
   *
   * Two numbers rather than a seed, because tuning by eye needs parameters that mean something
   * separately: with `[location, seed]` alone, "make it wider" has no handle and an editor is a
   * slot machine. `version` above is what keeps an old anchor pinned when the generator that reads
   * these changes. #322, #324.
   */
  layer?: { reach: number; lift: number };
}

export interface ManifestJson {
  rootSeed: number;
  anchors: Anchor[];
}

const KIND_SALT: Record<AnchorKind, number> = { island: SALT.ISLAND, dungeon: SALT.DUNGEON, cave: SALT.CAVE, wreck: SALT.WRECK, thicket: SALT.FOREST, skyisle: SALT.SKY, eyrie: SALT.EYRIE, highland: SALT.HIGHLAND };

/** Current generator version per kind; bump when a generator changes so old anchors stay pinned. */
export const ANCHOR_VERSION: Record<AnchorKind, number> = { island: 1, dungeon: 1, cave: 1, wreck: 1, thicket: 1, skyisle: 1, eyrie: 1, highland: 1 };

/**
 * Whether an anchor is one of a world's elevation layers rather than a place on it.
 *
 * A `highland` anchor with no shape on it is a place somebody pinned and not a layer — `layer`
 * above says so, and `elevationFor` reads it as no layer at all rather than as a flat one. Written
 * once and asked in both directions: it is what a world hands over on a join, and it is therefore
 * also exactly what a page joining that world gives up in exchange.
 */
function isLayer(anchor: Anchor): boolean {
  return anchor.kind === 'highland' && anchor.layer !== undefined;
}

/**
 * The manifest a page grows a named world from: the world's list, and the page's own everything
 * else.
 *
 * ## Why the world's list wins
 *
 * The decision this is, stated where it is made. A page joining a named world used to grow its
 * country from whatever its own IndexedDB held, and a browser that had never opened the world held
 * nothing — so it grew the seed flat while the server grew the range, and #377 gave the two halves
 * a fingerprint so they would at least be *told*. Being told is not agreeing.
 *
 * The server is the authority and the asymmetry is not a matter of rank. It decides where a hero
 * may stand, where a creature walks and what the ground under a village is, and **nothing in a
 * shared world was ever built on the page's copy of the list**: the villages, the holdings, the
 * houses and the fields are the world's state, standing on the world's ground. So the page's copy
 * is a cache of a fact, and a cache that disagrees with the fact is simply stale.
 *
 * That is the whole of why this does not read like the rule `anchors` is famous for — *"a world
 * saved before that code existed has them somewhere else, and moving them would move the ground
 * out from under a house somebody built on one."* That rule is about a **generator** changing what
 * it derives underneath a world nobody re-authored, and it still holds: the list is still
 * write-once per world, and a page playing alone still keeps its own, because in that world the
 * page's copy *is* the fact. What changes is only who holds the original for a world somebody else
 * is serving.
 *
 * The two alternatives were weighed and are worth saying out loud. Refusing the join would lock a
 * player out of a world they can reach, over a fact the server can simply hand them, and it would
 * make every authored change to a shared world an eviction notice. Keeping both lists and letting
 * the stamp complain is what the game does today, and the issue is precisely that it is the right
 * failure and not a fix.
 *
 * ## And why only the list
 *
 * Everything else the page's manifest holds stays. An eyrie is the one anchor in this game that no
 * seed can be asked about — somebody carried a carcass up a mountain and the dice were thrown once
 * — and a join is no reason to throw that away. A `highland` anchor with no shape on it is a place
 * the page pinned rather than a layer, so it survives for the same reason.
 *
 * Islands go, as they always have here: a named world is grown by the server's generator, which
 * plans its islands per square from the seed, so an island anchor under this key is a leftover from
 * a world of another kind saved under the same name.
 *
 * `invited` absent is an older server saying nothing, and silence is not an instruction to forget:
 * the page keeps what it had, exactly as `whyCountriesDiffer` reads an empty stamp as silence
 * rather than as disagreement. An *empty* list is a world saying it has none, which is a fact, and
 * a page holding a layer against it is holding it wrongly.
 */
export function joinedManifest(
  seed: number, saved: ManifestJson | undefined, invited: readonly Anchor[] | undefined,
): ManifestJson {
  const mine = (saved?.anchors ?? []).filter((a) => a.kind !== 'island');
  if (!invited) return { rootSeed: seed, anchors: mine };
  return { rootSeed: seed, anchors: [...mine.filter((a) => !isLayer(a)), ...invited] };
}

export class Manifest {
  readonly anchors = new Map<string, Anchor>();

  constructor(readonly rootSeed: number, saved?: ManifestJson) {
    if (saved && saved.rootSeed === rootSeed) for (const a of saved.anchors) this.anchors.set(a.id, a);
  }

  get(id: string): Anchor | undefined { return this.anchors.get(id); }

  byKind(kind: AnchorKind): Anchor[] {
    return [...this.anchors.values()].filter((a) => a.kind === kind);
  }

  /**
   * The elevation layers this world was authored with, in the manifest's own words.
   *
   * `elevationFor` turns these into the `Highland` list the ground is grown from, and this is what
   * travels to a page joining a named world. One method for both, because what a server *sends*
   * and what either half *grows* have to be the same list — a wire that carried a slightly
   * different selection than the generator reads would be two halves disagreeing about the one
   * fact this whole seam exists to keep them agreeing about.
   */
  layers(): Anchor[] {
    return this.byKind('highland').filter(isLayer);
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

import { swellAt, type Highland } from './highland';

/**
 * The elevation layers a world carries: summed components that lift its ground.
 *
 * A country stops being one function of a seed and becomes a stack — #322 — and this is the layer
 * kind whose shape was already understood, which is why it is the first one built. Each component
 * is a centre, a reach and a lift, exactly what `highlandNear` has produced per face all along, and
 * it is a pure function of where it is and of nothing else. So a world is a seed and a short list,
 * and the ground it describes is the same ground on every machine and in every year.
 *
 * ## Summed, where the high country of a range takes the largest
 *
 * `highlandAt` maxes over the swells it is given and its comment is right to: two shoulders of two
 * different ranges overlapping make a saddle at the height of the higher one, and summing there
 * would pile two ranges into one impossible mountain. Components of the *same* mountain are the
 * other case entirely. One smoothstep basis function, maxed with its neighbours, can only ever make
 * a mesa however high it is pushed — which is precisely what the spike on `task/mountains-are-ground`
 * photographed when the height went up: a vast snowy tableland with no peaks in it anywhere. A peak
 * is a sum. So the derived high country goes on taking the largest and the layers add on top of it.
 *
 * ## Why the list is written down rather than derived
 *
 * A saved world whose layer list changes is a world where the ground moves under everything built
 * on it, which is the failure `manifest.anchors` exists to prevent and says so: *"a world saved
 * before that code existed has them somewhere else, and moving them would move the ground out from
 * under a house somebody built on one."* The list is therefore write-once per world — read from the
 * manifest by `elevationFor`, never a setting — and it travels with the join, because a page and a
 * server holding different lists would grow different countries while both believing they agreed.
 */

/**
 * How wide one cell of the index is, in tiles.
 *
 * A quarter of a patch. Big enough that a layer of ordinary reach — a few hundred tiles — covers a
 * handful of cells rather than a hundred, and small enough that a tile's question is answered by
 * the layers that could actually reach it rather than by a quarter of the world's.
 */
const CELL = 128;

/**
 * How many layers are worth indexing at all.
 *
 * Measured rather than assumed, and measured because #322 asked for the number rather than the
 * assertion. Three hundred thousand lifts on the machine this was written on, best of three, the
 * list held straight against the same list indexed, in nanoseconds per question:
 *
 *     layers   |   1 |   4 |   8 |   16 |   64 |    200 |    1000
 *     straight | 134 | 447 | 936 | 1621 | 7804 |  35847 | 205636
 *     indexed  | 129 | 509 | 968 |  926 | 1813 |   7861 |  49088
 *
 * So the crossover is at about sixteen: below it a map lookup costs more than simply testing every
 * layer, above it the straight loop grows without limit and the indexed one barely moves. Eight is
 * that crossover with room under it.
 *
 * The index is built with the feature rather than after the first slow patch, which is what #322
 * argued for — and the in-situ figures say why. Painting a tile of ordinary ground costs about
 * 13µs here; four layers make it 22µs and two hundred indexed make it 94µs, because every tile
 * asks this several times over. Two hundred *un*-indexed would be something like 300µs a tile —
 * twenty times the cost of the ground itself — and nobody would find that by reading the code.
 *
 * The other thing those numbers say, and it is worth saying out loud: a long authored list is
 * expensive whatever is done to it. The index buys a factor of four or five, not permission.
 */
const FEW = 8;

/**
 * How far a layer may reach before it stops being worth a cell of its own, in tiles.
 *
 * A layer reaching further than this covers more than sixteen cells on a side, so writing it into
 * every one of them costs more memory than testing it on every question costs time. There are
 * never many of these — a layer this wide is a subcontinent — so they are simply kept aside and
 * added to every answer.
 */
const WIDE = CELL * 16;

/**
 * One cell of the grid, as a single number, so that a query allocates nothing.
 *
 * A pair rather than a hash: two cells can never share a key, because a collision here would not
 * be a slow answer, it would be a *different country* — ground lifted by a layer half a world
 * away. Exact for any cell within about 134 million tiles of the origin, which is a long way past
 * where a float stops being able to tell one tile from the next anyway.
 */
function cellKey(cx: number, cz: number): number {
  return cx * 0x200000 + cz;
}

/**
 * The layers of a world in the one order everything reads them in.
 *
 * A list restored from a save and a list built from a seed need not arrive in the same order, and
 * two orders are two different floating-point sums of the same numbers — a difference of one part
 * in 2^52, which is nothing until it falls either side of a `Math.round` and moves a terrace. The
 * ground and the fingerprint both read the ordered list, so neither can have an opinion about which
 * order it was handed.
 */
export function inOrder(layers: readonly Highland[]): Highland[] {
  return [...layers].sort((a, b) => a.x - b.x || a.z - b.z || a.reach - b.reach || a.lift - b.lift);
}

/** A world's elevation layers, and a grid to find the few of them that reach a given tile. */
export class Elevations {
  /** A world with no layers, which is every world saved before there were any. */
  static readonly none = new Elevations([]);

  /** The list itself, canonically ordered, as it travels and as it is fingerprinted. */
  readonly layers: readonly Highland[];

  /** Which layers cover each cell, or nothing at all when there are few enough to simply loop. */
  private readonly cells: Map<number, Highland[]> | null = null;

  /** The layers too wide to index, which every answer has to consider. */
  private readonly wide: Highland[] = [];

  constructor(layers: readonly Highland[]) {
    this.layers = inOrder(layers);
    if (this.layers.length <= FEW) return;
    this.cells = new Map();
    for (const layer of this.layers) {
      if (layer.reach > WIDE) { this.wide.push(layer); continue; }
      // written into every cell its reach touches, so a query is one lookup rather than a search
      const x0 = Math.floor((layer.x - layer.reach) / CELL), x1 = Math.floor((layer.x + layer.reach) / CELL);
      const z0 = Math.floor((layer.z - layer.reach) / CELL), z1 = Math.floor((layer.z + layer.reach) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cellKey(cx, cz);
          const already = this.cells.get(key);
          if (already) already.push(layer); else this.cells.set(key, [layer]);
        }
      }
    }
  }

  /** How much this world's layers lift the ground at a point, in terraces. */
  liftAt(x: number, z: number): number {
    let lift = 0;
    const near = this.cells
      ? this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
      : this.layers;
    if (near) for (const layer of near) lift += swellAt(layer, x, z);
    for (const layer of this.wide) lift += swellAt(layer, x, z);
    return lift;
  }
}

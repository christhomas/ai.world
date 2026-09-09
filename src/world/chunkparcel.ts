import { WORLD } from '../core/config';
import type { ChunkTiles } from './tiles';

/**
 * A chunk of country as bytes: what the world sends, and what a page keeps.
 *
 * Both halves grow the landscape from the seed today, which is why they can be in different
 * countries — and the answer is for one of them to grow it and the other to be told. This is the
 * shape it travels in.
 *
 * Bytes rather than words because a chunk is three and a third kilobytes of heights and tile kinds,
 * and written out as JSON numbers it is four times that, unreadable at both ends and slower to parse
 * than to generate. As the arrays it already is, it packs and unpacks by copying.
 *
 * Deliberately the *tiles* and the *props*, not the mesh. Turning tiles into geometry is the
 * expensive half and the page is already good at it — that stays where it is. What comes over the
 * wire is what the two halves could disagree about, which is the ground itself.
 */

/** What a chunk is worth keeping: its tiles, and what stands on them. */
export interface Parcel {
  cx: number;
  cz: number;
  /** Nine numbers per prop, as `chunkManager` already reads them. */
  props: Float32Array;
  tiles: ChunkTiles;
}

/**
 * A stamp of what made this country, so a chunk kept from an older world is never read as a new one.
 *
 * The trap in keeping chunks is silent staleness: generation changes, a page reads back the ground
 * it saved last week, and the two halves are in different countries again — which is the very fault
 * the sending was meant to end, arriving through the back door.
 *
 * So the key is derived from the generator rather than from a number somebody remembers to bump. One
 * chunk of the world is hashed at boot; if anything about generation moves, the hash moves, every
 * kept chunk becomes unreachable, and the page asks for fresh ones. There is no invalidation to get
 * wrong because there is no invalidation.
 */
export function worldStamp(tiles: ChunkTiles, props: Float32Array): string {
  let h = 0x811c9dc5;
  const eat = (n: number): void => { h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0; };
  for (const v of tiles.types) eat(v);
  for (const v of tiles.biomes) eat(v);
  for (const v of tiles.heights) eat(Math.round(v * 1000));
  for (const v of tiles.waters) eat(Math.round(v * 1000));
  for (const v of props) eat(Math.round(v * 1000));
  return h.toString(16).padStart(8, '0');
}

/** Where a kept chunk lives: the world it belongs to, what made it, and where it is. */
export function parcelKey(seed: number, kind: string, stamp: string, cx: number, cz: number): string {
  return `${seed}:${kind}:${stamp}:${cx},${cz}`;
}

/**
 * How the bytes are laid out.
 *
 * A header of longs, then the four tile arrays at their natural widths, then the props. Everything
 * is aligned to four bytes because a `Float32Array` cannot be made over an odd offset, and the tile
 * counts are fixed by the chunk size so only the prop count has to be written down.
 */
const HEADER = 4;                                  // cx, cz, prop count, and a version
const VERSION = 1;

export function packChunk(parcel: Parcel): ArrayBuffer {
  const n = WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE;
  const bytes = HEADER * 4                          // header
    + n * 4 * 2                                     // heights and waters
    + n * 2                                         // types and biomes, a byte each
    + parcel.props.length * 4;
  const buffer = new ArrayBuffer(bytes);
  const head = new Int32Array(buffer, 0, HEADER);
  head[0] = VERSION;
  head[1] = parcel.cx;
  head[2] = parcel.cz;
  head[3] = parcel.props.length;

  let at = HEADER * 4;
  new Float32Array(buffer, at, n).set(parcel.tiles.heights); at += n * 4;
  new Float32Array(buffer, at, n).set(parcel.tiles.waters); at += n * 4;
  new Uint8Array(buffer, at, n).set(parcel.tiles.types); at += n;
  new Uint8Array(buffer, at, n).set(parcel.tiles.biomes); at += n;
  new Float32Array(buffer, at, parcel.props.length).set(parcel.props);
  return buffer;
}

/**
 * The same chunk back out of the bytes.
 *
 * Returns null rather than throwing on anything it does not recognise: bytes come off a disk that
 * was written by an older version of this game or off a wire that has been meddled with, and the
 * right answer to both is to generate the chunk instead of dying.
 */
export function unpackChunk(bytes: ArrayBuffer): Parcel | null {
  const n = WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE;
  if (bytes.byteLength < HEADER * 4 + n * 10) return null;
  const head = new Int32Array(bytes, 0, HEADER);
  if (head[0] !== VERSION) return null;
  const props = head[3];
  if (props < 0 || bytes.byteLength !== HEADER * 4 + n * 10 + props * 4) return null;

  let at = HEADER * 4;
  const heights = new Float32Array(bytes.slice(at, at + n * 4)); at += n * 4;
  const waters = new Float32Array(bytes.slice(at, at + n * 4)); at += n * 4;
  const types = new Uint8Array(bytes.slice(at, at + n)); at += n;
  const biomes = new Uint8Array(bytes.slice(at, at + n)); at += n;
  return {
    cx: head[1],
    cz: head[2],
    props: new Float32Array(bytes.slice(at, at + props * 4)),
    tiles: { cx: head[1], cz: head[2], heights, waters, types, biomes },
  };
}

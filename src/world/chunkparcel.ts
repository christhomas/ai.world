import { WORLD } from '../core/config';
import type { ChunkData } from './terrain';

/**
 * A chunk of country as bytes: what the world sends, and what a page keeps.
 *
 * Both halves grow the landscape from the seed today, which is why they can be in different
 * countries — and the answer is for one of them to grow it and the other to be told. This is the
 * shape it travels in.
 *
 * It is the chunk itself, apron and all, rather than a summary of it. The first version of this
 * carried the packed tiles and a list of props, which is everything a walker needs and not quite
 * everything a *drawing* needs: a chunk is meshed with a tile of margin on every side so that its
 * edges meet its neighbours', and a page given the middle without the margin would draw a seam
 * round every chunk in the world. Since the margin has to travel anyway, what travels is the chunk,
 * and both the tiles and the props are worked out from it at the far end by the same two functions
 * that work them out here — so there is one description of what a chunk means rather than two.
 *
 * Bytes rather than words because it is five kilobytes of heights and tile kinds; written out as
 * JSON numbers it is four times that, unreadable at both ends, and slower to parse than to generate
 * — which would make sending it worse than not.
 *
 * Deliberately not the mesh. Turning tiles into geometry is the expensive half and the page is
 * already good at it; what crosses the wire is only what the two halves could disagree about.
 */

/** What a chunk is worth keeping, which is all of it. */
export type Parcel = ChunkData;

/**
 * How long a page waits for the world before it draws a chunk itself, in milliseconds.
 *
 * Long enough for the world in the next thread, which answers in a frame or two, and for a server
 * on the far side of a room. Short enough that a player never sees the wait: a fifth of a second of
 * ground that is not there yet is ground at the edge of what is drawn, arriving as they walk toward
 * it.
 *
 * It lives here rather than beside the page's chunk manager because it is not only the page's
 * business any more. It is the world's deadline: everything the world does to have a first view
 * ready before it is asked for one — growing it at the join, keeping the chunks it grew — is
 * arithmetic against this number, and `server/sim.test.ts` measures a whole view against it. Two
 * copies of it would agree right up until the day somebody changed one.
 */
export const WAIT_FOR_THE_WORLD = 200;

/**
 * A stamp of what made this country, so a chunk kept from an older world is never read as a new one.
 *
 * The trap in keeping chunks is silent staleness: generation changes, a page reads back the ground
 * it saved last week, and the two halves are in different countries again — which is the very fault
 * the sending was meant to end, arriving through the back door.
 *
 * So the key is derived from the generator rather than from a number somebody remembers to bump. One
 * chunk of the world is hashed; if anything about generation moves, the hash moves, every kept chunk
 * becomes unreachable, and the page asks for fresh ones. There is no invalidation to get wrong
 * because there is no invalidation.
 */
export function worldStamp(chunk: ChunkData): string {
  let h = 0x811c9dc5;
  const eat = (n: number): void => { h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0; };
  for (const v of chunk.type) eat(v);
  for (const v of chunk.biome) eat(v);
  for (const v of chunk.prop) eat(v);
  for (const v of chunk.height) eat(Math.round(v * 1000));
  for (const v of chunk.water) eat(Math.round(v * 1000));
  return h.toString(16).padStart(8, '0');
}

/** Where a kept chunk lives: the world it belongs to, what made it, and where it is. */
export function parcelKey(seed: number, kind: string, stamp: string, cx: number, cz: number): string {
  return `${seed}:${kind}:${stamp}:${cx},${cz}`;
}

/**
 * How the bytes are laid out.
 *
 * A header of longs, then the wide arrays, then the narrow ones. Floats first because a
 * `Float32Array` cannot be made over an offset that is not a multiple of four, and putting the bytes
 * last means never having to pad.
 *
 * `size` is written down rather than assumed. It is `CHUNK_SIZE + 2` today and a page reading bytes
 * from a world that thinks a chunk is a different size should say so and generate its own, rather
 * than reading somebody else's country as if it were this one.
 */
const HEADER = 5;                                   // version, cx, cz, size, empty
const VERSION = 2;

/** Every array a chunk is made of, in the order they are written. */
const WIDE = ['height', 'propRot', 'shore', 'corners', 'water'] as const;
const NARROW = ['type', 'biome', 'prop', 'sloped'] as const;

/** How many numbers each array holds, given the chunk's own size. */
function lengths(size: number): { wide: Record<string, number>; narrow: Record<string, number> } {
  const tiles = size * size;
  return {
    // the corners are four to a tile: that is what makes a terrace a terrace
    wide: { height: tiles, propRot: tiles, shore: tiles, corners: tiles * 4, water: tiles },
    narrow: { type: tiles, biome: tiles, prop: tiles, sloped: tiles },
  };
}

export function packChunk(chunk: Parcel): ArrayBuffer {
  const { wide, narrow } = lengths(chunk.size);
  const floats = WIDE.reduce((sum, name) => sum + wide[name], 0);
  const bytes = NARROW.reduce((sum, name) => sum + narrow[name], 0);
  const buffer = new ArrayBuffer(HEADER * 4 + floats * 4 + bytes);

  const head = new Int32Array(buffer, 0, HEADER);
  head[0] = VERSION;
  head[1] = chunk.cx;
  head[2] = chunk.cz;
  head[3] = chunk.size;
  head[4] = chunk.empty ? 1 : 0;

  let at = HEADER * 4;
  for (const name of WIDE) {
    new Float32Array(buffer, at, wide[name]).set(chunk[name]);
    at += wide[name] * 4;
  }
  for (const name of NARROW) {
    new Uint8Array(buffer, at, narrow[name]).set(chunk[name]);
    at += narrow[name];
  }
  return buffer;
}

/**
 * The same chunk back out of the bytes.
 *
 * Returns null rather than throwing on anything it does not recognise: bytes come off a disk that
 * was written by an older version of this game, or off a wire, and the right answer to both is to
 * generate the chunk instead of dying.
 */
export function unpackChunk(bytes: ArrayBuffer): Parcel | null {
  if (bytes.byteLength < HEADER * 4) return null;
  const head = new Int32Array(bytes, 0, HEADER);
  if (head[0] !== VERSION) return null;
  const size = head[3];
  if (size !== WORLD.CHUNK_SIZE + 2) return null;         // a chunk of a world with different bones

  const { wide, narrow } = lengths(size);
  const floats = WIDE.reduce((sum, name) => sum + wide[name], 0);
  const bytesWanted = NARROW.reduce((sum, name) => sum + narrow[name], 0);
  if (bytes.byteLength !== HEADER * 4 + floats * 4 + bytesWanted) return null;

  const out: Record<string, unknown> = { cx: head[1], cz: head[2], size, empty: head[4] === 1 };
  let at = HEADER * 4;
  for (const name of WIDE) {
    out[name] = new Float32Array(bytes.slice(at, at + wide[name] * 4));
    at += wide[name] * 4;
  }
  for (const name of NARROW) {
    out[name] = new Uint8Array(bytes.slice(at, at + narrow[name]));
    at += narrow[name];
  }
  return out as unknown as Parcel;
}

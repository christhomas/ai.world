import type { ChunkManager } from '../world/chunkManager';
import { ChunkStore, browserKeep } from '../world/chunkstore';
import { packChunk, unpackChunk, worldStamp } from '../world/chunkparcel';
import type { TerrainSampler } from '../world/terrain';
import { GAME } from '../core/version';

/**
 * Getting the country: from what this page kept, or by asking the world for it.
 *
 * Both halves of this game grow the landscape from the seed, which is why they can be standing in
 * different countries — and the cure is for the world to grow it and the page to be told. This is
 * the page's half of that: what it is missing, where it looks first, and what it does with what
 * arrives.
 *
 * What it kept comes first, always. The world is the same every time it is grown, so a chunk is
 * worth exactly one journey down the wire — ever — and a page walking country it has walked before
 * asks for nothing at all. That is what makes streaming an endless world affordable: the cost is per
 * acre of new country rather than per hour of play.
 *
 * The page's own generator is still there and still runs when nothing has arrived yet, because a
 * page whose world has not answered should draw the country rather than stand in the dark. It has
 * simply stopped being the authority on what the ground is.
 */
export interface Streaming {
  /** Called once a frame: fetch whatever the chunk manager is waiting on. */
  streamCountry: () => void;
  /** A piece of the world, arriving as bytes. */
  onParcel: (bytes: ArrayBuffer) => void;
  /** What it has done: waiting on, asked for, read back, arrived. */
  tally: { asked: number; kept: number; arrived: number; wanted: number };
}

export interface StreamingCtx {
  chunks: ChunkManager;
  sampler: TerrainSampler;
  seed: number;
  world: string;
  /**
   * Ask the world for these chunks.
   *
   * @returns whether there was anybody to ask. False is not a failure — it is the ordinary state of
   * the first moments of a game, before the world has said hello — but it must be *said*, because a
   * chunk nobody heard about is a chunk this page will draw for itself and never put right.
   */
  want: (chunks: Array<[number, number]>) => boolean;
}

export function streamTheCountry(ctx: StreamingCtx): Streaming {
  /** What this has actually done, for `__stream`: invisible plumbing is plumbing nobody can fix. */
  const tally = { asked: 0, kept: 0, arrived: 0, wanted: 0 };
  /*
   * The country this page has already been sent, stamped with what made it.
   *
   * A stamp rather than a version number: one chunk is hashed, and if generation ever moves the
   * stamp moves with it and everything kept becomes unreachable at once. Ground kept from an older
   * generator, drawn beside ground the world grew today, is the two halves in different countries —
   * which is the fault all of this exists to end, arriving by the back door.
   */
  /*
   * What made this country: the shape of it, and the build that shaped it.
   *
   * The hash is one chunk of ground at the origin, which catches anything that moves the whole
   * country and is blind to everything rare — a jetty, a bridge, the mouth of a cave. A pier was
   * made to step down to the water, every test agreed, and a page that had walked that coast last
   * week went on drawing the old one, because nothing about chunk nought moved. So the version goes
   * in beside it: a release drops what was kept and the country is fetched once more, which is a
   * few hundred kilobytes against never being able to fix the shape of anything small.
   */
  const kept = new ChunkStore(
    browserKeep(), ctx.seed, ctx.world,
    `${GAME.version}:${worldStamp(ctx.sampler.generateChunk(0, 0))}`,
  );
  void kept.sweep();

  /**
   * Chunks asked for and not yet arrived.
   *
   * So that a chunk is asked for once rather than once a frame while it is in flight. A view is a
   * hundred and twenty-one chunks and a frame is a sixtieth of a second, which without this is
   * seven thousand askings a second for ground that is already on its way.
   */
  const asked = new Set<string>();

  /**
   * Chunks the store did not have and the world could not be told about, waiting for a world.
   *
   * The bug this exists to stop was a race between two promises and it cost a whole first view.
   * Looking in the store is asynchronous; so is a world saying hello. When the store answered first
   * — which is a coin toss on every page load — the page asked a world that was not listening yet,
   * the message went nowhere, and the chunk had already been written down as asked for. It was
   * never asked for again. The page drew its own ground for all of them and nothing ever put it
   * right: a hundred and ten of a hundred and twenty-one chunks of a country the world does not
   * agree with, for the whole of that visit.
   *
   * So an ask that nobody heard is remembered rather than lost, and offered again on the next
   * frame. It is pruned to what is still wanted, because a page walking away from country it never
   * got is a page that should stop asking for it.
   */
  const unheard = new Map<string, [number, number]>();

  return {
    tally,
    streamCountry: (): void => {
      const waiting = ctx.chunks.wanted();
      tally.wanted = waiting.length;

      // whatever nobody heard last time, before anything new. Pruned first: the hero walks, and
      // ground he has left behind is ground the chunk manager has already stopped waiting for.
      if (unheard.size > 0) {
        const still = new Set(waiting.map(([cx, cz]) => `${cx},${cz}`));
        for (const key of [...unheard.keys()]) if (!still.has(key)) unheard.delete(key);
        if (unheard.size > 0 && ctx.want([...unheard.values()])) {
          tally.asked += unheard.size;
          unheard.clear();
        }
      }

      for (const [cx, cz] of waiting) {
        const key = `${cx},${cz}`;
        if (asked.has(key)) continue;
        asked.add(key);
        void kept.get(cx, cz).then((have) => {
          if (!have) {
            if (ctx.want([[cx, cz]])) tally.asked++;
            else unheard.set(key, [cx, cz]);
            return;
          }
          asked.delete(key);
          tally.kept++;
          ctx.chunks.deliver(cx, cz, packChunk(have));
        });
      }
      /*
       * Asked for one at a time as the store answers, rather than gathered into one message.
       *
       * The gathering was written first and asked for nothing at all: looking in the store is a
       * promise, so the list of what is missing was still empty when the breath was taken. Either
       * wait for all of them or send as they come, and sending as they come is what a page walking
       * into new country is doing anyway.
       */
    },

    onParcel: (bytes: ArrayBuffer): void => {
      // read far enough to know where it belongs; the drawing is a worker's business and the
      // keeping is the store's
      const parcel = unpackChunk(bytes.slice(0));
      if (!parcel) return;
      asked.delete(`${parcel.cx},${parcel.cz}`);
      tally.arrived++;
      ctx.chunks.deliver(parcel.cx, parcel.cz, bytes);
      void kept.put(parcel);
    },
  };
}

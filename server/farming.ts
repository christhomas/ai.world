import { CROPS, isRipe } from '../src/game/farming';
import type { ClientMessage, ServerMessage, WorldDelta } from './protocol';

/**
 * The world's answer to somebody lifting a crop.
 *
 * The second thing a page asks rather than reports, and the same shape as the first (`chests.ts`):
 * what comes up is not a decision — a crop yields what a crop yields — so the page can put it in
 * the pack the moment the button is pressed, and what the world settles is whether there was
 * anything there to lift.
 *
 * Which it can settle properly, because a sowing is already one of the facts that travels. It is in
 * the log with the day it went in, and the world keeps the clock, so "is it ripe" is arithmetic the
 * world can do better than the page can: a page can be wound forward, and a world with other people
 * in it cannot.
 *
 * The three things checked:
 *
 *  - something was sown on that tile, and is still there,
 *  - it is ripe by the world's own day rather than by the asker's,
 *  - and the hero the world has been walking is standing on it.
 *
 * The last one is a real check out of doors, which is where fields are: the server walks the hero
 * over ground it grew, so where he is standing is not the client's to choose.
 */

export interface Field {
  /** What the world has growing on that tile, from its own log. */
  sown: Extract<WorldDelta, { kind: 'sow' }> | null;
  /** The world's day, with the fraction, which is what a growing thing measures. */
  day: number;
  /** Where the world has this hero standing. */
  hero: { x: number; z: number } | null;
  /** Take the sowing out of the log. False when it was not there to take. */
  apply: (delta: WorldDelta) => boolean;
  broadcast: (delta: WorldDelta) => void;
  send: (message: ServerMessage) => void;
}

export function cropLifted(o: Field, message: Extract<ClientMessage, { type: 'harvest' }>): void {
  const seq = Math.floor(Number(message.seq) || 0);
  const tile = String(message.tile).slice(0, 32);
  const no = (): void => o.send({ type: 'harvested', seq, tile, ok: false, crop: '', amount: 0 });

  const sown = o.sown;
  if (!sown || !o.hero) { no(); return; }
  const crop = CROPS[sown.crop];
  if (!crop) { no(); return; }
  if (!isRipe({ crop: sown.crop, planted: sown.day }, o.day)) { no(); return; }

  // the tile he is standing on, worked out the way the page works it out: a field is a square, and
  // being in it is what reaching it means
  const [x, z] = tile.split(',').map(Number);
  if (Math.floor(o.hero.x) !== x || Math.floor(o.hero.z) !== z) { no(); return; }

  // and the log settles who got there first, exactly as it does for a chest
  if (!o.apply({ kind: 'reap', tile })) { no(); return; }
  o.broadcast({ kind: 'reap', tile });
  o.send({ type: 'harvested', seq, tile, ok: true, crop: crop.id, amount: crop.yield });
}

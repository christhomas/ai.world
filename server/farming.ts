import { CROPS, canPlant, isRipe } from '../src/game/farming';
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

export interface Ground {
  /** What is already growing on that tile, if anything. */
  sown: Extract<WorldDelta, { kind: 'sow' }> | null;
  /** The world's day, whole, which is the unit a season is measured in. */
  day: number;
  hero: { x: number; z: number } | null;
  /** Will anything grow on that tile? The world's own answer, off its own ground. */
  plantable: (x: number, z: number) => boolean;
  apply: (delta: WorldDelta) => boolean;
  broadcast: (delta: WorldDelta) => void;
  send: (message: ServerMessage) => void;
}

/**
 * The world's answer to somebody putting a seed in the ground.
 *
 * The counterpart to lifting one, and the world holds all three things worth checking: what the
 * ground is made of, what day it is, and whether anything is already growing there. A page can be
 * wrong about the first (it walks ahead of the ground it has been sent) and wound forward about the
 * second, and cannot know the third at all in a world with other people in it.
 *
 * What it does not check is the seed leaving the pack, because the world does not keep anybody's
 * pack. That is the same gap `chests.ts` names, and it closes in the same place.
 */
export function seedSown(o: Ground, message: Extract<ClientMessage, { type: 'sow' }>): void {
  const seq = Math.floor(Number(message.seq) || 0);
  const tile = String(message.tile).slice(0, 32);
  const cropId = String(message.crop).slice(0, 32);
  const no = (): void => o.send({ type: 'sown', seq, tile, ok: false });

  const crop = CROPS[cropId];
  if (!crop || !o.hero) { no(); return; }
  // in season by the world's day. A page wound forward to midsummer cannot put winter wheat in
  if (!canPlant(crop, Math.floor(o.day))) { no(); return; }
  if (o.sown) { no(); return; }                  // somebody is already growing something there

  const [x, z] = tile.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(z)) { no(); return; }
  if (Math.floor(o.hero.x) !== x || Math.floor(o.hero.z) !== z) { no(); return; }
  if (!o.plantable(x + 0.5, z + 0.5)) { no(); return; }

  const delta: WorldDelta = { kind: 'sow', tile, crop: crop.id, day: Math.floor(o.day) };
  if (!o.apply(delta)) { no(); return; }
  o.broadcast(delta);
  o.send({ type: 'sown', seq, tile, ok: true });
}

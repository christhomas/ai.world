import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
import { Forgetful } from './vault';

/**
 * Every door gets an answer, including the ones the world did not believe.
 *
 * `putThere` has always had an opinion about a doorway. It compares the step claimed against the
 * hero it has been walking, and where the two disagree it keeps its own position as the door —
 * because taking the claim outright would be a way of travelling: say you stepped through a door
 * at the far side of the county, come back out, and the world puts you there.
 *
 * What it never did was *say* so. The page had already drawn the room, put the hero on its floor
 * and framed the camera, and it went on believing all of that until the hero walked back out —
 * at which point the world's `youAre` hauled him across the county to the door it had. That is a
 * correction arriving a shop visit late, which is the letterbox argument of #235 in reverse: the
 * prediction was right to happen, and there was nothing to reconcile it against.
 *
 * ## Where the doorstep comes from
 *
 * A room has coordinates of its own — `places.enterBuilding` teleports the hero onto an interior
 * map a few tiles across — so the `x`/`z` of a `stood` sent from indoors is not a position in the
 * world at all and never was. The world was therefore comparing a room coordinate against a county
 * one, which agrees only by accident. `at` is the doorstep in the world's own tiles, sent
 * separately, and it is what makes the judgement mean anything.
 *
 * Optional, because a page that has not upgraded still walks through doors; it sends no number, is
 * never refused, and gets exactly the behaviour it had before.
 */

/** A player made of a list, as `sim.test.ts` and `blowanswer.test.ts` have one. */
class Pretend {
  readonly heard: ServerMessage[] = [];
  open = true;
  readonly wire: Wire;
  private readonly attached;

  constructor(sim: Simulation) {
    const player = this;
    this.wire = {
      send: (parcel) => {
        if (typeof parcel !== 'string') throw new Error('the world sent bytes to a test that expects words');
        player.heard.push(JSON.parse(parcel) as ServerMessage);
      },
      get open(): boolean { return player.open; },
      close: () => { player.open = false; },
    };
    this.attached = sim.attach(this.wire);
  }

  join(seed: number, name: string): this {
    this.say({ type: 'join', seed, name, version: PROTOCOL_VERSION, day: 2, time: 0.4 });
    return this;
  }

  say(message: ClientMessage): void { this.attached.receive(JSON.stringify(message)); }

  of<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.heard.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

/** Clear ground in the world of seed 3 with a run to the east, taken from `sim.test.ts`. */
const CLEAR_RUN = { x: 0.5, z: -13.5 };

/** Somewhere inside a shop: a few tiles across, and no relation at all to a county coordinate. */
const ON_THE_SHOP_FLOOR = { x: 5.5, z: 3.5 };

/** A world walking a hero, and where it has got him to. Nothing below is about a hero it never had. */
function walking() {
  const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
  const rowan = new Pretend(sim).join(3, 'Rowan');
  rowan.say({ type: 'move', x: CLEAR_RUN.x, z: CLEAR_RUN.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  sim.tick(Date.now() + 100);
  rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
  const at = rowan.of('youAre')[0];
  if (!at) throw new Error('the world never walked him, so there is nothing to disagree with');
  return { sim, rowan, at: { x: at.x, z: at.z } };
}

describe('what the world says about a door', () => {
  it('believes a door the hero was standing at, and says so', () => {
    const { rowan, at } = walking();
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 7, at });
    expect(rowan.of('stepped')).toEqual([{ type: 'stepped', seq: 7, ok: true }]);
  });

  it('refuses a door on the far side of the county, which is the whole of the check', () => {
    const { rowan, at } = walking();
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 8, at: { x: at.x + 400, z: at.z } });
    expect(rowan.of('stepped')[0]).toMatchObject({ seq: 8, ok: false });
  });

  it('answers a door it has no hero to judge, rather than leaving the claim standing', () => {
    // a page that has joined and not yet walked has no hero on the world's side, so there is
    // nothing to disagree with. `Claims` times nothing out, so silence here would leave an entry
    // in the page's map for the rest of the session
    const sim = new Simulation({ vault: new Forgetful() });
    const ash = new Pretend(sim).join(3, 'Ash');
    ash.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 2, at: { x: 0, z: 0 } });
    expect(ash.of('stepped')).toEqual([{ type: 'stepped', seq: 2, ok: true }]);
  });

  it('says nothing to a page that did not number its step, as it always did', () => {
    const { rowan, at } = walking();
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', at });
    expect(rowan.of('stepped'), 'an old page gets the old behaviour').toHaveLength(0);
  });

  it('never refuses a page that does not say where the door was', () => {
    // the room coordinate is all an old page sends, and it is not a county position — refusing on
    // it would throw every player of an old build out of every shop in the world
    const { rowan } = walking();
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 3 });
    expect(rowan.of('stepped')[0]).toMatchObject({ seq: 3, ok: true });
  });

  it('lets him back out at the door it believed, not at where it happened to have him', () => {
    // three tiles from the world's hero: a doorstep within the slack, and far enough that using
    // one rather than the other is visible. Before `at` existed the world compared the *room*
    // coordinate, which never agrees, so it always fell back to its own position and the step was
    // remembered three tiles from the door actually walked through
    const { rowan, at } = walking();
    const step = { x: at.x + 3, z: at.z };
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 1, at: step });
    expect(rowan.of('stepped')[0], 'three tiles is a doorstep, not a journey').toMatchObject({ ok: true });
    // and now the world learns he is indoors, which is what `move` carries
    rowan.say({ type: 'move', ...ON_THE_SHOP_FLOOR, yaw: 0, walk: 0, place: 'the shop', riding: 'foot', gear: [] });
    rowan.say({ type: 'stood', x: step.x, z: step.z, why: 'place' });
    const out = rowan.of('youAre').at(-1)!;
    expect(out.x, 'he came out of the door he went in by').toBeCloseTo(step.x, 5);
    expect(out.z).toBeCloseTo(step.z, 5);
  });
});

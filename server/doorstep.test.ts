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
 *
 * ## And whether there is a door there at all
 *
 * The reach rule has nothing to say to a hero standing in an empty field who reports a doorway at
 * his own feet: nothing about *that* distance is wrong. So the world asks its own country — it
 * grows the same villages from the same seed, and `generateStructures` has always laid their
 * doorways out because the game walks a hero into them — and refuses a step with no doorway near
 * it.
 *
 * The two tests that matter are the pair that keep the rules apart. One claims a step at the
 * hero's own feet on clear ground: reachable, and not a door. The other claims a doorway of a real
 * village four hundred tiles off: a door, and not reachable. A single test using a wild coordinate
 * is refused by both and would go on passing with either one deleted, which is what the old
 * far-side-of-the-county test had become.
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

/**
 * Two doorsteps of Blackby, which is the village of seed 3 nearest the origin.
 *
 * Read off the world rather than chosen: `structures.doors` of the patch at the origin holds
 * eleven of them for this village, and these are the two nearest each other — four tiles apart,
 * which is inside `SAME_DOOR` and is two doors along a street. Every test below that uses one
 * asserts first that the world still has a doorway there, so a generator that moved Blackby fails
 * saying so rather than failing as a refusal nobody can explain.
 */
const A_BLACKBY_DOOR = { x: 45.5, z: 83.5 };
const THE_DOOR_NEXT_TO_IT = { x: 45.5, z: 87.5 };

/**
 * The church door of Marshwell, four hundred and twenty tiles up the same patch.
 *
 * A real doorway, and that is the whole of why it is here: refusing it cannot be the new check
 * finding no door, so what refuses it is the reachability rule this work was told to keep.
 */
const A_DOOR_IN_THE_NEXT_COUNTY = { x: 95.5, z: 507.5 };

/** Somewhere inside a shop: a few tiles across, and no relation at all to a county coordinate. */
const ON_THE_SHOP_FLOOR = { x: 5.5, z: 3.5 };

/**
 * A world walking a hero, and where it has got him to. Nothing below is about a hero it never had.
 *
 * Where he is standing is the argument because it is now half of what is being judged: on clear
 * ground there is no doorway within a county of him, and on a village street there is one under
 * his feet.
 */
function walking(from: { x: number; z: number } = CLEAR_RUN) {
  const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
  const rowan = new Pretend(sim).join(3, 'Rowan');
  rowan.say({ type: 'move', x: from.x, z: from.z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  sim.tick(Date.now() + 100);
  rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
  const at = rowan.of('youAre')[0];
  if (!at) throw new Error('the world never walked him, so there is nothing to disagree with');
  return { sim, rowan, at: { x: at.x, z: at.z } };
}

describe('what the world says about a door', () => {
  it('believes a door the hero was standing at, and says so', () => {
    const { sim, rowan } = walking(A_BLACKBY_DOOR);
    expect(sim.groundOf(3)!.atADoor(A_BLACKBY_DOOR.x, A_BLACKBY_DOOR.z, 2), 'the shop is still there').toBe(true);
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 7, at: A_BLACKBY_DOOR });
    expect(rowan.of('stepped')).toEqual([{ type: 'stepped', seq: 7, ok: true }]);
  });

  it('refuses a door because there is no door there', () => {
    // The lie `SAME_DOOR` cannot catch: a hero in an empty field says he has stepped through a
    // doorway at his own feet. Nothing about the distance is wrong — the step is nought tiles from
    // the hero the world has been walking — so the reachability rule believes it, and the only
    // thing that can refuse it is the world knowing where the doorways of its villages are.
    const { sim, rowan, at } = walking();
    const ground = sim.groundOf(3)!;
    // the precondition, and it is the one that matters: this world *does* hold doorways, so a
    // refusal below is about this spot rather than about an empty index
    expect(ground.atADoor(A_BLACKBY_DOOR.x, A_BLACKBY_DOOR.z, 2), 'Blackby still has its doors').toBe(true);
    expect(ground.atADoor(at.x, at.z, 2), 'and the run east of the origin still has none').toBe(false);
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 9, at });
    expect(rowan.of('stepped')[0], 'a field is not a doorway').toMatchObject({ seq: 9, ok: false });
  });

  it('refuses a real doorway the hero could not have been standing at', () => {
    // The other lie, and the two are separated on purpose: there *is* a door where this one
    // claims, so nothing about the doorways of this world can refuse it. It is refused because a
    // step four hundred tiles away is a way of travelling, which is what `SAME_DOOR` is for — and
    // this is the test that fails if the new check is ever allowed to replace the old one.
    const { sim, rowan } = walking(A_BLACKBY_DOOR);
    const ground = sim.groundOf(3)!;
    expect(ground.atADoor(A_DOOR_IN_THE_NEXT_COUNTY.x, A_DOOR_IN_THE_NEXT_COUNTY.z, 2),
      'Marshwell is a real village with a real door').toBe(true);
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 10, at: A_DOOR_IN_THE_NEXT_COUNTY });
    expect(rowan.of('stepped')[0]).toMatchObject({ seq: 10, ok: false });
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
    // the house next door to the one he is standing at: four tiles off, which is a doorstep within
    // the slack and far enough that using one rather than the other is visible. Before `at` existed
    // the world compared the *room* coordinate, which never agrees, so it always fell back to its
    // own position and the step was remembered four tiles from the door actually walked through
    const { rowan } = walking(A_BLACKBY_DOOR);
    const step = THE_DOOR_NEXT_TO_IT;
    rowan.say({ type: 'stood', ...ON_THE_SHOP_FLOOR, why: 'place', seq: 1, at: step });
    expect(rowan.of('stepped')[0], 'two doors along a street is not a journey').toMatchObject({ ok: true });
    // and now the world learns he is indoors, which is what `move` carries
    rowan.say({ type: 'move', ...ON_THE_SHOP_FLOOR, yaw: 0, walk: 0, place: 'the shop', riding: 'foot', gear: [] });
    rowan.say({ type: 'stood', x: step.x, z: step.z, why: 'place' });
    const out = rowan.of('youAre').at(-1)!;
    expect(out.x, 'he came out of the door he went in by').toBeCloseTo(step.x, 5);
    expect(out.z).toBeCloseTo(step.z, 5);
  });
});

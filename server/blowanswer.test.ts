import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
import { Forgetful } from './vault';

/**
 * Every blow gets an answer, including the ones the world throws away.
 *
 * `warband-hit` used to end in `return` on two ordinary conditions and say nothing about either:
 * the duel had already ended on this side, or the blow failed `cleanSwing`. Meanwhile the page that
 * threw it had already taken the health off — item 73 says a swing must not wait for a round trip
 * and `predicted.ts` agrees, so acting first is right; what was missing was anything that could
 * contradict it.
 *
 * So the page now numbers the blow and the world answers that number either way. **Either way** is
 * the part worth a test: an answer that only came back on success could not be told from one still
 * in flight, `Claims` deliberately times nothing out, and the claim would stand for ever while the
 * page went on showing a hit that was never counted.
 */

/** A player made of a list, as `sim.test.ts` has one: everything the world said, in order. */
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

/** Two players in one world, with a fight running between them. */
const fighting = () => {
  const sim = new Simulation({ vault: new Forgetful() });
  const rowan = new Pretend(sim).join(7, 'Rowan');
  const wren = new Pretend(sim).join(7, 'Wren');
  const wrenId = rowan.of('joined')[0].player.id;
  const rowanId = wren.of('welcome')[0].players[0].id;
  rowan.say({ type: 'warband-challenge', to: wrenId, swords: 1 });
  wren.say({ type: 'warband-answer', from: rowanId, yes: true, swords: 1 });
  // nothing below is worth reading if the fight never started
  if (rowan.of('warband-begun').length !== 1) throw new Error('the two never squared up');
  return { rowan, wren };
};

describe('what the world says about a blow', () => {
  it('answers a numbered blow it took', () => {
    const { rowan } = fighting();
    rowan.say({ type: 'warband-hit', damage: 30, sword: true, seq: 1 });
    expect(rowan.of('warband-blow')).toEqual([{ type: 'warband-blow', seq: 1, stood: true }]);
  });

  it('answers a blow it threw away, which is the whole point', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const alone = new Pretend(sim).join(7, 'Rowan');
    // no duel at all, which is what a page has whenever the fight ended while its blow was in
    // flight — the message used to be dropped in silence
    alone.say({ type: 'warband-hit', damage: 30, sword: true, seq: 4 });
    expect(alone.of('warband-blow')).toEqual([{ type: 'warband-blow', seq: 4, stood: false }]);
  });

  it('still lands the blow on the other side when it stood', () => {
    const { rowan, wren } = fighting();
    rowan.say({ type: 'warband-hit', damage: 30, sword: true, seq: 1 });
    expect(wren.of('warband-struck')).toHaveLength(1);
  });

  it('tells nobody about a blow that did not stand', () => {
    const { rowan, wren } = fighting();
    rowan.say({ type: 'warband-hit', damage: Number.NaN, sword: true, seq: 2 });
    expect(rowan.of('warband-blow')[0]).toMatchObject({ seq: 2, stood: false });
    expect(wren.of('warband-struck'), 'a refused blow must not reach the far side').toHaveLength(0);
  });

  it('says nothing to a page that did not number its blow, as it always did', () => {
    const { rowan, wren } = fighting();
    rowan.say({ type: 'warband-hit', damage: 30, sword: true });
    expect(rowan.of('warband-blow'), 'an old page gets the old behaviour').toHaveLength(0);
    expect(wren.of('warband-struck'), 'and its blow still lands').toHaveLength(1);
  });
});

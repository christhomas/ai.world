import { describe, expect, it } from 'vitest';
import { type Entity } from '../entities/entity';
import { createBlows, type Fighting } from './blows';
import { Duel } from './duel';
import { Warband, sideOf, strangers } from './warband';
import type { Hires } from './hire';

/**
 * The blow the hero throws himself, and the fact that nothing could ever contradict it.
 *
 * #281 gave the *hired men's* blows the whole of the pattern — a number on the wire, what was
 * given kept, and an answer that puts it back — and left the one blow the player actually swings
 * exactly where it was. `blows.ts` read, in the same fight:
 *
 *     duel.landed(landed);          online.duelHit(landed);
 *     warband.landed({ ... });      online.warbandHit(landed, false);
 *
 * No sequence number on either, so `server/messages.ts` had nothing to answer and sent nothing;
 * and both of those messages are dropped by the world without a word in an ordinary case — the
 * bout had ended on its side while the blow was in flight. The page went on showing health it had
 * taken off somebody who never lost it, and in a duel that is the whole readout in the corner of
 * the screen.
 *
 * That is prediction without reconciliation, which item #235 names as the thing that makes a game
 * lie. `predicted.ts` settles a swing as `hand` and is right — a blow that waits for a round trip
 * is the letterbox the argument is against — so what is missing is the other two thirds, not a
 * blow that waits.
 *
 * ## What "replayed" means for a blow
 *
 * Walking replays the steers newer than the answer. A blow has no steers, and the same question
 * has the same shape: when an answer refuses one blow, everything thrown *after* it must still
 * stand. A correction that put the far side back to what the world last agreed about would throw
 * away every blow landed while the answer was in flight, which is the failure the pattern exists
 * to avoid. Every test below that undoes anything asserts the newer blow survived it.
 */

/** A far side held exactly as a client holds one, with armour that is their business, not ours. */
const them = (hearts: number) => sideOf({ who: 'them', name: 'Wren', hearts, guard: 0 }, strangers(0));

/** The one thing `attack` needs to find in front of the hero: somebody within reach, facing him. */
const presence = () => ({
  id: 'them', name: 'Wren', x: 1, z: 0, yaw: 0, walk: 0, gear: [], place: 'surface', riding: 'foot' as const,
});

/**
 * Everything `attack` reaches for when the hero is in a bout, and nothing else.
 *
 * Built off the shape `blows.test.ts` already uses. The duel and warband branches both return
 * before the swing is resolved against the world, so no creatures, no chunks and no standing are
 * needed — which is the reason this can be a unit at all.
 */
function inABout(what: 'duel' | 'warband') {
  const hero = { x: 0, z: 0, yaw: 0, hurt: 0, blow: 'swing', walk: 0, attackCooldown: 0 } as unknown as Entity;
  const duel = new Duel();
  const warband = new Warband();
  const sent: Array<{ damage: number; seq: number | undefined }> = [];
  if (what === 'duel') duel.begin('them', 'Wren', 30);
  else {
    warband.asked('them');
    warband.begin(sideOf({ who: 'me', name: 'Rowan', hearts: 20, guard: 0 }, []), them(30));
  }
  const ctx = {
    seed: 1,
    state: { attack: 6, worn: () => undefined, practised: () => '' },
    player: { entity: hero, get x() { return hero.x; }, get z() { return hero.z; } },
    places: { indoors: null, underground: null },
    breath: { swing: () => 1 },
    duel,
    warband,
    hires: {} as Hires,
    online: { id: 'me', players: new Map([['them', presence()]]),
      duelHit: (damage: number, seq?: number) => sent.push({ damage, seq }),
      warbandHit: (damage: number, _sword: boolean, seq?: number) => sent.push({ damage, seq }) },
    sound: { thud: () => {}, miss: () => {}, hit: () => {}, voice: () => {} },
    director: { saw: () => {} },
    entities: { within: () => [] },
    talking: () => false,
    typing: () => false,
    flash: () => {},
    hurt: () => {},
  } as unknown as Fighting;
  const blows = createBlows(ctx);
  /** Swing, with the cooldown wound off first so a second blow is allowed to land. */
  const swing = (): void => { blows.cooled(10); blows.attack(); };
  return { blows, duel, warband, sent, swing };
}

describe('the hero\'s own blow in a duel', () => {
  it('numbers it, so the world has something to answer', () => {
    const bout = inABout('duel');
    bout.swing();
    expect(bout.sent, 'one blow reported').toHaveLength(1);
    expect(bout.sent[0].seq, 'an unnumbered blow is one the world cannot answer').toBeGreaterThan(0);
    expect(bout.duel.theirs, 'and it was taken off on the spot, as a swing must be').toBe(24);
  });

  it('puts back exactly what the blow took when the world says it never counted it', () => {
    const bout = inABout('duel');
    bout.swing();
    bout.duel.answered(bout.sent[0].seq!, false);
    expect(bout.duel.theirs, 'the six hearts came back').toBe(30);
  });

  it('keeps the blows thrown after the one that was refused', () => {
    const bout = inABout('duel');
    bout.swing();
    bout.swing();
    expect(bout.duel.theirs, 'two swings of six').toBe(18);
    // the answer to the first arrives after the second has already landed, which is ordinary: a
    // round trip is longer than the cooldown between two swings
    bout.duel.answered(bout.sent[0].seq!, false);
    expect(bout.duel.theirs, 'the second blow stands; only the refused one is given back').toBe(24);
  });

  it('gives back nothing twice, however many answers arrive', () => {
    const bout = inABout('duel');
    bout.swing();
    bout.duel.answered(bout.sent[0].seq!, false);
    bout.duel.answered(bout.sent[0].seq!, false);
    expect(bout.duel.theirs, 'an answer to a settled claim is nothing').toBe(30);
  });

  it('gives back nothing at all for a blow the world took', () => {
    const bout = inABout('duel');
    bout.swing();
    bout.duel.answered(bout.sent[0].seq!, true);
    expect(bout.duel.theirs).toBe(24);
    expect(bout.duel.owed, 'and the claim is forgotten rather than left standing').toBe(0);
  });

  it('says how much it took rather than how hard it was thrown', () => {
    // the clamp is the reason `claims.ts` keeps what was given instead of working it out again: a
    // blow against somebody on his last heart takes one heart, not the six that were swung
    const duel = new Duel();
    duel.begin('them', 'Wren', 4);
    const seq = duel.landed(999);
    expect(duel.theirs).toBe(0);
    duel.answered(seq, false);
    expect(duel.theirs, 'four hearts back, not nine hundred and ninety-nine').toBe(4);
  });

  it('leaves a bout that has already ended alone', () => {
    const duel = new Duel();
    duel.begin('them', 'Wren', 30);
    const seq = duel.landed(6);
    duel.end();
    duel.answered(seq, false);
    expect(duel.active, 'nothing may restart a bout that is over').toBe(false);
    expect(duel.theirs).toBe(0);
  });
});

describe('the hero\'s own blow in a fight with sides', () => {
  it('numbers it, exactly as his hired men\'s blows have been numbered since #281', () => {
    const fight = inABout('warband');
    fight.swing();
    expect(fight.sent, 'one blow reported').toHaveLength(1);
    expect(fight.sent[0].seq).toBeGreaterThan(0);
  });

  it('puts it back on the world\'s word, and keeps what was thrown after it', () => {
    const fight = inABout('warband');
    fight.swing();
    fight.swing();
    fight.warband.answered(fight.sent[0].seq!, false);
    // through the same door anybody else uses: what is left of the far side is what the next blow
    // finds there. Thirty, less two sixes, plus the six given back, is twenty-four
    expect(fight.warband.landed({ damage: 24, sword: false })!.over, 'twenty-four left').toBe(true);
  });

  it('shares one numbering with the men, so no two blows can claim the same number', () => {
    const fight = inABout('warband');
    fight.swing();
    const mine = fight.sent[0].seq!;
    const theirs = fight.warband.threw(fight.warband.landed({ damage: 1, sword: true })!);
    expect(theirs, 'a hired man\'s blow takes the next number, not the same one').not.toBe(mine);
  });
});

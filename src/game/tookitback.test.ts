import { describe, expect, it } from 'vitest';
import { Warband, sideOf, strangers, type Landing, type Side } from './warband';
import { Claims } from './claims';

/**
 * A blow the world disagreed with, and what the page does about it.
 *
 * `multiplayer.ts` `swingSwords` took the health off the far side *and* reported the blow:
 *
 *     warband.landed({ damage: WARBAND.SWORD_BLOW, sword: true });
 *     online.warbandHit(WARBAND.SWORD_BLOW, true);
 *
 * No sequence number, nothing kept to put back, and no answer that could contradict it — and
 * `server/messages.ts` drops that message without a word in two ordinary cases: when the duel is
 * already over on its side (`!me.warband`), and when the blow fails `cleanSwing`. So the page
 * showed a hit that did not happen and had no way of ever taking it back.
 *
 * That is prediction without reconciliation, which is the exact thing item 73 says makes a game
 * lie. `predicted.ts` already settles that a swing is `hand` — the page is *right* to act first —
 * so what is missing is the other two thirds of the pattern, not a blow that waits.
 *
 * ## Why the amount has to be kept rather than worked out again
 *
 * `claims.ts` says it in as many words: *what was given is kept, not recomputed*. Two things make
 * a recomputed undo wrong here, and both are ordinary rather than exotic:
 *
 * - **The clamp.** A blow against somebody on his last heart takes one heart, not the six that were
 *   swung, because `land` floors at nought. Giving back six would invent five.
 * - **Who took it.** A blow lands on the first man still standing. By the time an answer arrives
 *   that man may be down and somebody else in front, so "put it back on whoever is there now" puts
 *   it on the wrong person.
 */

/** A far side held exactly as a client holds one: a readout, with armour that is their business. */
const them = (hearts: number, swords = 0): Side =>
  sideOf({ who: 'them', name: 'Wren', hearts, guard: 0 }, strangers(swords));

const facingOff = (hearts: number, swords = 0): Warband => {
  const band = new Warband();
  band.asked('them');
  band.begin(sideOf({ who: 'me', name: 'Rowan', hearts: 20, guard: 0 }, []), them(hearts, swords));
  return band;
};

describe('a blow that is put back', () => {
  it('says how much it actually took, rather than how hard it was thrown', () => {
    const band = facingOff(30);
    const landing = band.landed({ damage: 999, sword: false })!;
    expect(landing.over, 'thirty hearts and nine hundred swung is the end of him').toBe(true);
    expect(landing.took, 'he had thirty to give, not nine hundred').toBe(30);
  });

  it('leaves the far side exactly as it was, so the fight is not over after all', () => {
    const band = facingOff(30);
    const landing = band.landed({ damage: 999, sword: false })!;
    band.takeBack(landing);
    // the proof goes through the same door anybody else uses: a man with his hearts back is a man
    // still standing, and one left at nought is not
    expect(band.landed({ damage: 1, sword: false })!.over).toBe(false);
  });

  it('puts it back on the man who took it, not on whoever is in front now', () => {
    const band = facingOff(20, 2);
    const first = band.landed({ damage: 1, sword: true })!;
    expect(band.theirMuster).toBe(2);
    band.landed({ damage: 99, sword: true });        // fells him; the second man is in front now
    expect(band.theirMuster).toBe(1);
    band.takeBack(first);
    expect(band.theirMuster, 'the heart went back onto the wrong man').toBe(1);
  });

  it('gives back nothing at all for a blow that never landed', () => {
    const band = facingOff(30);
    // nought damage still costs `WARBAND.LEAST`, which is what a scratch is; the blow that takes
    // nothing is one against somebody already at nought
    const felling = band.landed({ damage: 999, sword: false })!;
    const nothing = band.landed({ damage: 999, sword: false })!;
    expect(nothing.took, 'there was nothing left to take').toBe(0);
    band.takeBack(nothing);
    band.takeBack(felling);
    expect(band.landed({ damage: 1, sword: false })!.over, 'one undo, not two').toBe(false);
  });
});

/*
 * And the reconciliation itself: one claim, one answer, one undo, however many times the answer
 * arrives. `Claims` guarantees the last part; this asserts it where somebody would debug it.
 */
describe('reconciling a blow against the world', () => {
  it('forgets the claim when the world agrees, and the hit stands', () => {
    const band = facingOff(30);
    const claims = new Claims<Landing>();
    const seq = claims.ask(band.landed({ damage: 20, sword: false })!);
    expect(claims.answered(seq)).not.toBeNull();
    expect(claims.pending).toBe(0);
    expect(band.landed({ damage: 10, sword: false })!.over, 'thirty less twenty less ten').toBe(true);
  });

  it('undoes exactly once, however many answers arrive', () => {
    const band = facingOff(30);
    const claims = new Claims<Landing>();
    const seq = claims.ask(band.landed({ damage: 20, sword: false })!);
    band.takeBack(claims.answered(seq)!);
    expect(claims.answered(seq), 'an answer to a settled claim is nothing').toBeNull();
    expect(band.landed({ damage: 30, sword: false })!.over, 'his twenty hearts came back once').toBe(true);
  });
});

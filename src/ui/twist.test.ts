import { describe, expect, it } from 'vitest';
import { Twist, angleBetween, keyForTurn, turnedBy } from './twist';

/**
 * Two fingers on the world, as the camera keys they amount to.
 *
 * The camera's two buttons were in the left gutter with the pack and the journal, which made that
 * rail six cells long — 326 pixels down a screen 390 tall, straight through where a steering thumb
 * rests. `design/mobile` has no camera control anywhere and this is why: on a phone a camera is a
 * gesture.
 */

/** A hand on the glass, as the two points it is. */
const hand = (angle: number, at = { x: 400, y: 200 }, reach = 80) => [
  { x: at.x - Math.cos(angle) * reach, y: at.y - Math.sin(angle) * reach },
  { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach },
];

/** A twist, and the keys it sent, in order. */
function turning(through: number[]): string[] {
  const sent: string[] = [];
  const twist = new Twist((k) => sent.push(`hold ${k}`), (k) => sent.push(`let go ${k}`));
  const [a, b] = hand(through[0]);
  twist.began(1, a.x, a.y);
  twist.began(2, b.x, b.y);
  for (const angle of through) {
    const [one, two] = hand(angle);
    twist.moved(1, one.x, one.y);
    twist.moved(2, two.x, two.y);
  }
  return sent;
}

describe('turning the camera with two fingers', () => {
  it('takes the short way round, so the bottom of the circle is not a cliff', () => {
    /*
     * `atan2` wraps at π. A hand turning steadily through the bottom of the circle reads as a jump
     * of nearly a whole turn the other way, which would flip the camera round at one particular
     * angle and nowhere else — the kind of bug that is reported as "it sometimes spins".
     */
    expect(turnedBy(3.1, -3.1)).toBeCloseTo(0.0832, 3);
    expect(turnedBy(-3.1, 3.1)).toBeCloseTo(-0.0832, 3);
    expect(turnedBy(0, 0.2)).toBeCloseTo(0.2, 6);
  });

  it('measures the angle of the hand rather than of either finger', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 6);
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 6);
  });

  it('asks for a real turn to start and a small one to continue', () => {
    // a pinch, a drag and a hand resting all move the angle a little; starting on that would turn
    // the camera every time two fingers touched the glass
    expect(keyForTurn(0.02, false), 'a shiver is not a twist').toBeNull();
    expect(keyForTurn(0.08, false)).toBe('e');
    expect(keyForTurn(0.02, true), 'once it is turning, keep turning').toBe('e');
    expect(keyForTurn(-0.08, false)).toBe('q');
  });

  it('holds one key while the hand keeps turning, rather than pressing once a frame', () => {
    const sent = turning([0, 0.1, 0.2, 0.3, 0.4]);
    expect(sent.filter((one) => one.startsWith('hold'))).toEqual(['hold e']);
  });

  it('lets the key go when the hand stops', () => {
    const sent = turning([0, 0.1, 0.2, 0.2, 0.2]);
    expect(sent).toContain('hold e');
    expect(sent[sent.length - 1]).toBe('let go e');
  });

  it('swaps cleanly when the hand turns back the other way', () => {
    const sent = turning([0, 0.1, 0.2, 0.1, 0]);
    expect(sent).toEqual(['hold e', 'let go e', 'hold q']);
  });

  it('lets go when a finger lifts, because one finger is not a twist', () => {
    const sent: string[] = [];
    const twist = new Twist((k) => sent.push(`hold ${k}`), (k) => sent.push(`let go ${k}`));
    const [a, b] = hand(0);
    twist.began(1, a.x, a.y);
    twist.began(2, b.x, b.y);
    for (const angle of [0, 0.1, 0.2]) {
      const [one, two] = hand(angle);
      twist.moved(1, one.x, one.y);
      twist.moved(2, two.x, two.y);
    }
    expect(twist.key).toBe('e');
    twist.ended(2);
    expect(twist.key, 'a key left down is a camera that never stops').toBeNull();
  });

  it('does nothing at all with one finger, which is how you walk', () => {
    const sent: string[] = [];
    const twist = new Twist((k) => sent.push(`hold ${k}`), (k) => sent.push(`let go ${k}`));
    twist.began(1, 100, 100);
    for (let i = 0; i < 20; i++) twist.moved(1, 100 + i * 5, 100 + i * 3);
    expect(sent).toEqual([]);
  });
});

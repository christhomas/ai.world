import type { AnimalKind, AnimRole } from './animals';

/**
 * What a thing does when it hits something.
 *
 * Before this, a fight was two figures standing still while numbers changed, which reads as
 * nothing happening at all. The whole point is that every blow in the game is one of a handful of
 * shapes, so the hero, a constable and a wolf all animate through the same three lines rather
 * than each growing their own special case.
 *
 * A blow is kept on the creature as a countdown rather than as a flag, because the renderer needs
 * to know how far through it is, and because a countdown ends by itself if whatever started it
 * walks away or dies mid-swing.
 */

export type Blow = 'swing' | 'punch' | 'kick' | 'bite' | 'rear' | 'lunge';

export const STRIKE = {
  /** How long a blow takes, in seconds. Long enough to read, short enough to spam. */
  LASTS: 0.42,
  /** The share of that spent winding up before it comes forward. */
  WIND: 0.3,
  /** How far a swung weapon travels, in radians. Deliberately more than a walk cycle ever does. */
  SWING: 2.4,
  /** A fist. Shorter than a blade because there is less of it. */
  PUNCH: 1.9,
  /** A boot. */
  KICK: 1.5,
  /** A head thrown forward, for anything that fights with its mouth. */
  BITE: 0.9,
  /** How far a bear goes back on its hind legs before it comes down, in radians. */
  REAR: 0.85,
  /** And how far a thing with no limbs to throw pitches its whole self at you. */
  LUNGE: 0.5,
} as const;

/**
 * How this creature fights.
 *
 * A kind may say so itself, and the ones worth watching do. Everything else is worked out from
 * the body it was built with: a thing with an arm punches and a thing without bites, which covers
 * the whole bestiary without anybody maintaining a list of which animals have hands.
 */
export function blowOf(kind: Pick<AnimalKind, 'blow' | 'parts'>): Blow {
  if (kind.blow) return kind.blow;
  const has = (role: AnimRole): boolean => kind.parts.some((part) => part.anim === role);
  if (has('armR')) return 'punch';
  if (has('head')) return 'bite';
  // a shark has neither an arm to throw nor a head that turns, so it comes at you whole, which
  // is also how a shark actually does it
  return 'lunge';
}

/**
 * Where a blow has got to, from nought at the start to one at the end. Zero when nothing is
 * being thrown, which is nearly always and is the case worth being cheap about.
 */
export function strikeAt(strike: number): number {
  if (strike <= 0) return 0;
  return Math.min(1, 1 - strike / STRIKE.LASTS);
}

/**
 * The shape every blow follows: back, through, and settle.
 *
 * Minus one at the furthest point of the wind-up, plus one at the furthest point of the blow, and
 * nought at each end. One curve for all of them is what makes a punch and a bear's lunge look
 * like the same world.
 */
export function arcOf(at: number): number {
  if (at <= 0 || at >= 1) return 0;
  if (at < STRIKE.WIND) return -Math.sin((at / STRIKE.WIND) * (Math.PI / 2));
  return Math.sin(((at - STRIKE.WIND) / (1 - STRIKE.WIND)) * Math.PI);
}

/**
 * How far a limb has turned for this blow, or null when this limb has nothing to do with it.
 *
 * Returned rather than applied so the renderer can add it to whatever the walk cycle was already
 * doing: somebody who swings while running should do both.
 */
export function limbTurn(role: AnimRole | undefined, blow: Blow, at: number, mirrored: boolean): number | null {
  const arc = arcOf(at);
  if (arc === 0) return null;
  const arm = mirrored ? 'armL' : 'armR';
  const leg = mirrored ? 'legL' : 'legR';

  switch (blow) {
    case 'swing': return role === arm ? arc * STRIKE.SWING : null;
    case 'punch': return role === arm ? arc * STRIKE.PUNCH : null;
    case 'kick': return role === leg ? arc * STRIKE.KICK : null;
    case 'bite': return role === 'head' ? arc * STRIKE.BITE : null;
    // a bear rears on its hind legs, so its forelegs come up with the body and its head comes down
    case 'rear': {
      if (role === 'armL' || role === 'armR') return arc * -STRIKE.SWING * 0.5;
      if (role === 'head') return arc * STRIKE.BITE * 0.6;
      return null;
    }
    case 'lunge': return null;   // nothing on it moves: the whole of it does, in bodyLean
  }
}

/**
 * How far the whole body tilts, which only a rear does.
 *
 * Everything else moves a limb and leaves the body where it is. A bear that only waved a paw
 * would not read as a bear, so this is the one blow that is allowed to move all of it.
 */
export function bodyLean(blow: Blow, at: number): number {
  if (blow === 'rear') return -arcOf(at) * STRIKE.REAR;
  if (blow === 'lunge') return arcOf(at) * STRIKE.LUNGE;
  return 0;
}

import motion from '../../animations/motion.json';
import type { AnimalKind, AnimRole } from './animals';

/**
 * How everything in the game moves, read out of animations/motion.json.
 *
 * The numbers are data and the maths is code, which is the line worth holding. What anybody
 * actually wants to change is how far an arm swings or how long a blow takes, and those are now a
 * file you can edit with the game running. A format that could also express arbitrary curves
 * would be harder to edit than the code it replaced, so it deliberately cannot.
 *
 * A bad file fails at load with the path to what is wrong, exactly as a bad behaviour tree does,
 * because an animation that silently falls back to nothing is a bug nobody finds for a week.
 */

export type Blow = 'swing' | 'punch' | 'kick' | 'bite' | 'rear' | 'lunge';

/** Which of a creature's states drives a part of the walk cycle. */
type Driver = 'walk' | 'flap' | 'always';

/** One part's share of the walk cycle. */
interface Cycle {
  of: Driver;
  /** How far it travels at full pace, in radians, in step with the gait. */
  swing?: number;
  /** A constant sway, with its rate and where in the cycle it starts. */
  wave?: number;
  rate?: number;
  offset?: number;
  /** Where it sits when nothing is happening, and how far it trails when moving. */
  rest?: number;
  lean?: number;
  /** Which way it turns. Legs walk on z, wings beat on x. */
  axis?: 'x' | 'y' | 'z';
  /** Whether the creature's own head angle is added, which only a head wants. */
  pitch?: boolean;
}

/** One blow, from the wind-up to the furthest point of it. */
interface Strike {
  lasts: number;
  wind: number;
  turn?: Partial<Record<AnimRole, number>>;
  /** Tips the whole body rather than a limb, which is the only way a rear reads. */
  lean?: number;
  /** Whether it alternates hands, so a flurry is not one arm four times. */
  mirrors?: boolean;
}

interface MotionFile {
  walking: Record<string, Cycle | string>;
  blows: Record<string, Strike | string>;
}

/** The most a limb may be asked to turn. Past this something has been typed wrong. */
const SANE_TURN = Math.PI * 2;
/** And the longest a blow may take, in seconds. */
const SANE_LASTS = 4;

function fault(where: string, why: string): never {
  throw new Error(`animations/motion.json: ${where} ${why}`);
}

const file = motion as unknown as MotionFile;

/** Read a section, dropping the `note` that documents it for whoever opens the file. */
function sectionOf<T>(part: Record<string, T | string>, where: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [name, value] of Object.entries(part)) {
    if (name === 'note') continue;
    if (typeof value === 'string') fault(`${where}.${name}`, 'is a line of prose where a set of numbers should be');
    out[name] = value;
  }
  return out;
}

const CYCLES: Record<string, Cycle> = sectionOf<Cycle>(file.walking, 'walking');
const BLOWS: Record<string, Strike> = sectionOf<Strike>(file.blows, 'blows');

for (const [name, blow] of Object.entries(BLOWS)) {
  if (!(blow.lasts > 0) || blow.lasts > SANE_LASTS) fault(`blows.${name}.lasts`, `must be between 0 and ${SANE_LASTS} seconds`);
  if (!(blow.wind >= 0) || blow.wind >= 1) fault(`blows.${name}.wind`, 'must be a share of the blow, from 0 up to but not including 1');
  for (const [role, turn] of Object.entries(blow.turn ?? {})) {
    if (Math.abs(turn as number) > SANE_TURN) fault(`blows.${name}.turn.${role}`, 'turns further than a full circle');
  }
}

/** Every blow the file describes, which is what a creature is allowed to throw. */
export const BLOW_NAMES: readonly string[] = Object.keys(BLOWS);

/** Is this a blow the file knows about? */
export function isBlow(name: string): name is Blow {
  return name in BLOWS;
}

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

/** How long the named blow takes, for whoever starts one. */
export function lastsFor(blow: Blow): number {
  return BLOWS[blow].lasts;
}

/** Whether the named blow alternates hands. */
export function mirrors(blow: Blow): boolean {
  return BLOWS[blow].mirrors === true;
}

/** Where a blow has got to, from nought at the start to one at the end. */
export function strikeAt(blow: Blow, left: number): number {
  if (left <= 0) return 0;
  return Math.min(1, 1 - left / BLOWS[blow].lasts);
}

/**
 * The shape every blow follows: back, through, and settle.
 *
 * Minus one at the furthest point of the wind-up, plus one at the furthest point of the blow, and
 * nought at each end. One curve for all of them is what makes a punch and a bear's lunge look
 * like the same world.
 */
export function arcOf(blow: Blow, at: number): number {
  if (at <= 0 || at >= 1) return 0;
  const wind = BLOWS[blow].wind;
  if (at < wind) return -Math.sin((at / wind) * (Math.PI / 2));
  return Math.sin(((at - wind) / (1 - wind)) * Math.PI);
}

/** How far a limb has turned for this blow, or null when this limb has nothing to do with it. */
export function limbTurn(role: AnimRole | undefined, blow: Blow, at: number, offhand: boolean): number | null {
  if (!role) return null;
  const arc = arcOf(blow, at);
  if (arc === 0) return null;

  const turns = BLOWS[blow].turn ?? {};
  // a mirrored blow is written for the right side and thrown with either, so a flurry alternates
  const looked = mirrors(blow) && offhand ? otherSide(role) : role;
  const turn = turns[looked as AnimRole];
  return turn === undefined ? null : arc * turn;
}

/** The limb on the other side of the body, for a blow thrown with the other hand. */
function otherSide(role: AnimRole): AnimRole {
  if (role === 'armL') return 'armR';
  if (role === 'armR') return 'armL';
  if (role === 'legL') return 'legR';
  if (role === 'legR') return 'legL';
  return role;
}

/** How far the whole body tips for this blow, which is nought for all but a couple of them. */
export function bodyLean(blow: Blow, at: number): number {
  const lean = BLOWS[blow].lean;
  return lean === undefined ? 0 : arcOf(blow, at) * lean;
}

/** What a creature's state is, as far as the walk cycle is concerned. */
export interface Moving {
  walk: number;
  flap: number;
  phase: number;
  headPitch: number;
}

/**
 * Where a part sits in the walk cycle, as an x, y, z turn.
 *
 * Everything a creature does while it is not hitting something comes through here, which is why
 * a tail, a cape and a pair of wings are all describable in the same handful of fields.
 */
export function cycleTurn(role: AnimRole | undefined, e: Moving): [number, number, number] {
  const cycle = role ? CYCLES[role] : undefined;
  if (!cycle) return [0, 0, 0];

  const driver = cycle.of === 'walk' ? e.walk : cycle.of === 'flap' ? e.flap : 1;
  let turn = 0;
  if (cycle.swing !== undefined) turn += Math.sin(e.phase) * cycle.swing * e.walk;
  if (cycle.wave !== undefined) turn += Math.sin(e.phase * (cycle.rate ?? 1) + (cycle.offset ?? 0)) * cycle.wave * driver;
  if (cycle.rest !== undefined) turn += cycle.rest;
  if (cycle.lean !== undefined) turn += cycle.lean * e.walk;
  if (cycle.pitch === true) turn += e.headPitch;

  const axis = cycle.axis ?? 'z';
  return axis === 'x' ? [turn, 0, 0] : axis === 'y' ? [0, turn, 0] : [0, 0, turn];
}

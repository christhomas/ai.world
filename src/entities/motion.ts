import motion from '../../animations/motion.json';
import type { AnimalKind, AnimRole } from './animals';

/**
 * How everything in the game moves, read out of animations/motion.json.
 *
 * The numbers are data and the maths is code, which is the line worth holding. What anybody
 * actually wants to change is how far an arm swings or how long a blow takes, and those are now a
 * file you can edit with the game running. A format that could also express arbitrary curves
 * would be harder to edit than the code it replaced, so it deliberately cannot: the curves live
 * here, one of each, and everything in the world settles and follows through the same way.
 *
 * A bad file fails at load with the path to what is wrong, exactly as a bad behaviour tree does,
 * because an animation that silently falls back to nothing is a bug nobody finds for a week.
 */

export type Blow = 'swing' | 'punch' | 'kick' | 'bite' | 'rear' | 'lunge';

/** Which of a creature's states drives a part of the walk cycle. */
type Driver = 'walk' | 'flap' | 'always';

/** One part's share of a cycle, whether that cycle is a walk or a stand. */
interface Cycle {
  /** What fades it in. An idle has none: what drives an idle is the standing still. */
  of?: Driver;
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

/** The weight the whole body carries, walking and standing. */
interface BodyFile {
  bounce: number;
  sway: number;
  lean: number;
  breath: number;
  breathRate: number;
  settle: number;
  settleRate: number;
}

/** How a full-pace gait differs from an amble. */
interface RunFile {
  from: number;
  stride: number;
  bounce: number;
  lean: number;
}

/** What being hit does to a body. */
interface FlinchFile {
  lasts: number;
  snap: number;
  lean: number;
  drop: number;
  turn?: Partial<Record<AnimRole, number>>;
}

/** Going down for the last time. */
interface DyingFile {
  lasts: number;
  fall: number;
  sink: number;
  turn?: Partial<Record<AnimRole, number>>;
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
  idling: Record<string, Cycle | string>;
  body: BodyFile & { note?: string };
  running: RunFile & { note?: string };
  flinch: FlinchFile & { note?: string };
  dying: DyingFile & { note?: string };
  blows: Record<string, Strike | string>;
}

/** The most a limb may be asked to turn. Past this something has been typed wrong. */
const SANE_TURN = Math.PI * 2;
/** And the longest a blow may take, in seconds. */
const SANE_LASTS = 4;
/** And the furthest a body may rise or sink, in the units a creature is built in. */
const SANE_LIFT = 1;
/** And the fastest anything may sway, against the phase everything else runs on. */
const SANE_RATE = 8;
/** And the most a run may open a stride out. */
const SANE_STRIDE = 4;

/**
 * Every part a cycle may name. Written out rather than inferred so that a typo in the file is a
 * loud failure at load instead of a limb that quietly never moves; the type makes leaving one out
 * a compile error, so it cannot drift from the rig.
 */
const ROLES: Record<AnimRole, true> = {
  legL: true, legR: true, armL: true, armR: true, tail: true, head: true, wingL: true, wingR: true, cape: true,
};

function fault(where: string, why: string): never {
  throw new Error(`animations/motion.json: ${where} ${why}`);
}

const file = motion as unknown as MotionFile;

// a section somebody has deleted should say so, rather than failing later as an unreadable
// property of undefined with no hint of which file it came from
for (const name of ['walking', 'idling', 'body', 'running', 'flinch', 'dying', 'blows'] as const) {
  if (!file[name] || typeof file[name] !== 'object') fault(name, 'is missing from the file');
}

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

/** A number the file has to give, in range, named by where it sits when it is not. */
function figure(where: string, value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fault(where, 'must be a number');
  const n = value as number;
  if (Math.abs(n) > limit) fault(where, `must be between -${limit} and ${limit}`);
  return n;
}

/** A part named by a cycle or a blow has to be a part the rig actually has. */
function role(where: string, name: string): AnimRole {
  if (!(name in ROLES)) fault(`${where}.${name}`, 'is not a part any creature has');
  return name as AnimRole;
}

const CYCLES: Record<string, Cycle> = sectionOf<Cycle>(file.walking, 'walking');
const IDLES: Record<string, Cycle> = sectionOf<Cycle>(file.idling, 'idling');
const BLOWS: Record<string, Strike> = sectionOf<Strike>(file.blows, 'blows');
const BODY = file.body;
const RUN = file.running;
const FLINCH = file.flinch;
const DYING = file.dying;

/** Which way a part turns, taken from its walk and shared by everything else that moves it. */
function axisOf(name: string): 'x' | 'y' | 'z' {
  return CYCLES[name]?.axis ?? IDLES[name]?.axis ?? 'z';
}

/** One entry of a walk or an idle, checked field by field so the fault names the one at fault. */
function checkCycle(where: string, cycle: Cycle, idle: boolean): void {
  if (idle) {
    if (cycle.of !== undefined) fault(`${where}.of`, 'is not something an idle has: what drives an idle is the standing still');
    if (cycle.swing !== undefined) fault(`${where}.swing`, 'is a stride, and a creature standing still has none');
  } else if (cycle.of !== 'walk' && cycle.of !== 'flap' && cycle.of !== 'always') {
    fault(`${where}.of`, "must be 'walk', 'flap' or 'always'");
  }
  for (const field of ['swing', 'wave', 'rest', 'lean'] as const) {
    if (cycle[field] !== undefined) figure(`${where}.${field}`, cycle[field], SANE_TURN);
  }
  if (cycle.rate !== undefined) figure(`${where}.rate`, cycle.rate, SANE_RATE);
  if (cycle.offset !== undefined) figure(`${where}.offset`, cycle.offset, SANE_TURN);
  if (cycle.axis !== undefined && cycle.axis !== 'x' && cycle.axis !== 'y' && cycle.axis !== 'z') {
    fault(`${where}.axis`, "must be 'x', 'y' or 'z'");
  }
}

// everything below runs once, at load, because an animation that silently falls back to nothing
// is a bug nobody finds for a week, and the game is more use refusing to start than looking wrong
for (const [name, cycle] of Object.entries(CYCLES)) {
  role('walking', name);
  checkCycle(`walking.${name}`, cycle, false);
}

for (const [name, cycle] of Object.entries(IDLES)) {
  role('idling', name);
  checkCycle(`idling.${name}`, cycle, true);
  // one part turns one way whoever is asking, or a creature would unbend itself as it stopped
  if (cycle.axis !== undefined && CYCLES[name]?.axis !== undefined && cycle.axis !== CYCLES[name].axis) {
    fault(`idling.${name}.axis`, `turns on ${cycle.axis} where walking.${name} turns on ${CYCLES[name].axis}`);
  }
}

for (const field of ['bounce', 'sway', 'breath', 'settle'] as const) figure(`body.${field}`, BODY[field], SANE_LIFT);
figure('body.lean', BODY.lean, SANE_TURN);
for (const field of ['breathRate', 'settleRate'] as const) figure(`body.${field}`, BODY[field], SANE_RATE);

if (!(RUN.from >= 0) || RUN.from >= 1) fault('running.from', 'must be a pace from 0 up to but not including 1');
if (!(RUN.stride > 0) || RUN.stride > SANE_STRIDE) fault('running.stride', `must be between 0 and ${SANE_STRIDE} times the walk's`);
if (!(RUN.bounce >= 0) || RUN.bounce > SANE_STRIDE) fault('running.bounce', `must be between 0 and ${SANE_STRIDE} times the walk's`);
figure('running.lean', RUN.lean, SANE_TURN);

if (!(FLINCH.lasts > 0) || FLINCH.lasts > SANE_LASTS) fault('flinch.lasts', `must be between 0 and ${SANE_LASTS} seconds`);
if (!(FLINCH.snap > 0) || FLINCH.snap >= 1) fault('flinch.snap', 'must be a share of the flinch, above 0 and below 1');
figure('flinch.lean', FLINCH.lean, SANE_TURN);
figure('flinch.drop', FLINCH.drop, SANE_LIFT);
for (const [name, turn] of Object.entries(FLINCH.turn ?? {})) {
  role('flinch.turn', name);
  figure(`flinch.turn.${name}`, turn, SANE_TURN);
}

if (!(DYING.lasts > 0) || DYING.lasts > SANE_LASTS) fault('dying.lasts', `must be between 0 and ${SANE_LASTS} seconds`);
figure('dying.fall', DYING.fall, SANE_TURN);
figure('dying.sink', DYING.sink, SANE_LIFT);
for (const [name, turn] of Object.entries(DYING.turn ?? {})) {
  role('dying.turn', name);
  figure(`dying.turn.${name}`, turn, SANE_TURN);
}

for (const [name, blow] of Object.entries(BLOWS)) {
  if (!(blow.lasts > 0) || blow.lasts > SANE_LASTS) fault(`blows.${name}.lasts`, `must be between 0 and ${SANE_LASTS} seconds`);
  if (!(blow.wind >= 0) || blow.wind >= 1) fault(`blows.${name}.wind`, 'must be a share of the blow, from 0 up to but not including 1');
  if (blow.lean !== undefined) figure(`blows.${name}.lean`, blow.lean, SANE_TURN);
  for (const [part, turn] of Object.entries(blow.turn ?? {})) {
    role(`blows.${name}.turn`, part);
    figure(`blows.${name}.turn.${part}`, turn, SANE_TURN);
  }
}

/** Every blow the file describes, which is what a creature is allowed to throw. */
export const BLOW_NAMES: readonly string[] = Object.keys(BLOWS);

/**
 * How long a creature staggers after a hit.
 *
 * The game counts the stagger down itself, so this is the file's opinion of the same length: keep
 * the two together or a flinch will still be settling long after the creature can fight back.
 */
export const FLINCH_LASTS: number = FLINCH.lasts;

/**
 * How long a body takes to fall, and so how long a killed creature stays in the world.
 *
 * The game counts it down itself, exactly as it counts down a stagger, so this is the file's
 * opinion of the same length and the two have to agree.
 */
export const DYING_LASTS: number = DYING.lasts;

/**
 * How far through going down a body is: nought at the moment it is killed, one when it is still.
 *
 * It accelerates, because a body that topples at a constant rate is a plank being lowered rather
 * than something falling, and it holds at one at the end rather than settling back — nothing gets
 * up from this.
 */
export function dyingAt(dying: number): number {
  if (dying <= 0) return 0;
  const at = 1 - Math.min(1, dying / DYING.lasts);
  return at * at;
}

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
  const has = (part: AnimRole): boolean => kind.parts.some((p) => p.anim === part);
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

/** How far past rest a movement carries before it comes back, as a share of how far it went. */
const CARRY = 0.85;
/** How far back a blow loads, against how far it comes through. Nobody draws back as far as they hit. */
const LOAD = 0.55;
/** Where in the part after the wind-up the blow actually lands: early, so the rest is follow-through. */
const LANDS = 0.4;

/**
 * Nought to one with no corner at either end.
 *
 * Everything in the world that starts moving and stops again is shaped by this, which is why a
 * wing, a flinch and a punch look like they were animated by the same hand.
 */
function ease(at: number): number {
  return (1 - Math.cos(Math.PI * at)) / 2;
}

/**
 * Coming home from the furthest point of a movement: back towards rest, a little past it, and
 * still. The carry past rest is most of what separates a blow that lands from a limb being
 * teleported back to where it started, and it costs nothing but this line.
 */
function settle(at: number): number {
  return (1 - at) * Math.cos(Math.PI * CARRY * at);
}

/**
 * The shape every blow follows: back, through, past, and settle.
 *
 * Nought at rest, minus LOAD at the top of the wind-up, one where it lands, and then a long
 * settle that carries a little past rest before it comes home. It is one continuous curve, which
 * matters: the limb used to jump from the top of its wind-up back to rest in a single frame the
 * moment the blow proper began, and one curve for all of them is what makes a punch and a bear's
 * lunge look like the same world.
 */
export function arcOf(blow: Blow, at: number): number {
  if (at <= 0 || at >= 1) return 0;
  const wind = BLOWS[blow].wind;
  if (at < wind) return -LOAD * ease(at / wind);
  const through = (at - wind) / (1 - wind);
  if (through < LANDS) return -LOAD + (1 + LOAD) * ease(through / LANDS);
  return settle((through - LANDS) / (1 - LANDS));
}

/** How far a limb has turned for this blow, or null when this limb has nothing to do with it. */
export function limbTurn(part: AnimRole | undefined, blow: Blow, at: number, offhand: boolean): number | null {
  if (!part) return null;
  const arc = arcOf(blow, at);
  if (arc === 0) return null;

  const turns = BLOWS[blow].turn ?? {};
  // a mirrored blow is written for the right side and thrown with either, so a flurry alternates
  const looked = mirrors(blow) && offhand ? otherSide(part) : part;
  const turn = turns[looked];
  return turn === undefined ? null : arc * turn;
}

/** The limb on the other side of the body, for a blow thrown with the other hand. */
function otherSide(part: AnimRole): AnimRole {
  if (part === 'armL') return 'armR';
  if (part === 'armR') return 'armL';
  if (part === 'legL') return 'legR';
  if (part === 'legR') return 'legL';
  return part;
}

/** How far the whole body tips for this blow, which is nought for all but a couple of them. */
export function bodyLean(blow: Blow, at: number): number {
  const lean = BLOWS[blow].lean;
  return lean === undefined ? 0 : arcOf(blow, at) * lean;
}

/**
 * How far through the stagger a hit creature is, from nothing at the moment of the blow to all of
 * it a heartbeat later and nothing again by the time it can fight back.
 *
 * `hurt` is the countdown the game already keeps, in seconds, so a creature hit again part way
 * through starts the recoil over, which is what being hit twice looks like.
 */
export function flinchAt(hurt: number): number {
  if (hurt <= 0) return 0;
  const at = 1 - Math.min(1, hurt / FLINCH.lasts);
  if (at < FLINCH.snap) return ease(at / FLINCH.snap);
  return settle((at - FLINCH.snap) / (1 - FLINCH.snap));
}

/**
 * How much of this pace is a run rather than a walk, from nought to one.
 *
 * A creature does not reach a run by doing a walk faster: below `running.from` it is ambling
 * whatever the numbers say, and above it the stride opens out and the body goes over its feet.
 */
export function runShare(walk: number): number {
  if (walk <= RUN.from) return 0;
  return Math.min(1, (walk - RUN.from) / (1 - RUN.from));
}

/** What a creature's state is, as far as anything that moves it is concerned. */
export interface Moving {
  walk: number;
  flap: number;
  phase: number;
  headPitch: number;
  /** Seconds left of the stagger after a hit, which is nought for anything unharmed. */
  hurt: number;
  /** Seconds left of going down, which is nought for anything still alive. */
  dying: number;
}

/** One part of a cycle worked out, before it is put on an axis. */
function cycleValue(cycle: Cycle, e: Moving, stride: number): number {
  const driver = cycle.of === 'walk' ? e.walk : cycle.of === 'flap' ? e.flap : 1;
  let turn = 0;
  // only a swing is a stride, so only a swing opens out into a run
  if (cycle.swing !== undefined) turn += Math.sin(e.phase) * cycle.swing * e.walk * stride;
  if (cycle.wave !== undefined) turn += Math.sin(e.phase * (cycle.rate ?? 1) + (cycle.offset ?? 0)) * cycle.wave * driver;
  if (cycle.rest !== undefined) turn += cycle.rest;
  if (cycle.lean !== undefined) turn += cycle.lean * e.walk;
  if (cycle.pitch === true) turn += e.headPitch;
  return turn;
}

/**
 * Where a part sits, as an x, y, z turn: its walk, the stand it falls back into as it slows, and
 * whatever it is still doing about the last thing that hit it.
 *
 * Everything a creature does while it is not hitting something comes through here, which is why
 * a tail, a cape and a pair of wings are all describable in the same handful of fields.
 */
export function cycleTurn(part: AnimRole | undefined, e: Moving): [number, number, number] {
  if (!part) return [0, 0, 0];
  const cycle = CYCLES[part];
  const idle = IDLES[part];
  const hit = FLINCH.turn?.[part];
  const last = DYING.turn?.[part];
  if (!cycle && !idle && hit === undefined && last === undefined) return [0, 0, 0];

  let turn = 0;
  if (cycle) turn += cycleValue(cycle, e, 1 + (RUN.stride - 1) * runShare(e.walk));
  // the stand fades in exactly as the walk fades out, so nothing is ever holding perfectly still
  if (idle) turn += cycleValue(idle, e, 1) * (1 - e.walk);
  if (hit !== undefined) turn += hit * flinchAt(e.hurt);
  // and going down takes over from all of it, because a body on its way to the ground is not
  // also breathing
  const going = dyingAt(e.dying);
  if (going > 0) {
    const last = DYING.turn?.[part];
    turn = turn * (1 - going) + (last ?? 0) * going;
  }

  const axis = axisOf(part);
  return axis === 'x' ? [turn, 0, 0] : axis === 'y' ? [0, turn, 0] : [0, 0, turn];
}

/** What the whole creature is doing that no single limb can show. */
export interface BodyMotion {
  /** How far it is off the ground, in the units it was built in. */
  bob: number;
  /** How far it tips forward or back, on the same axis a blow's lean uses. */
  lean: number;
  /** How far it rolls onto one foot or the other, on the axis it faces along. */
  roll: number;
}

/**
 * The weight a creature carries: the rise and fall of a stride, the tip into a run, the breath of
 * something stood still, and the fold away from a blow that has just landed.
 *
 * A body that stays at one height while its legs move is the single thing that makes a walk read
 * as a puppet, so this is not decoration. The bounce peaks twice a stride because a body is
 * tallest when its legs are together and lowest at full reach, and it is worked out from the same
 * phase the legs are, so the settle lands on the foot rather than near it.
 *
 * A blow's own lean is not in here: that one belongs to the blow and is added on top.
 */
export function bodyMotion(e: Moving): BodyMotion {
  const run = runShare(e.walk);
  const still = 1 - e.walk;
  const hit = flinchAt(e.hurt);

  const bounce = BODY.bounce * (1 + (RUN.bounce - 1) * run) * e.walk;
  const bob = Math.cos(e.phase * 2) * bounce
    + Math.sin(e.phase * BODY.breathRate) * BODY.breath * still
    - FLINCH.drop * hit;
  const lean = BODY.lean * e.walk + RUN.lean * run + FLINCH.lean * hit;
  const roll = Math.sin(e.phase) * BODY.sway * e.walk
    + Math.sin(e.phase * BODY.settleRate) * BODY.settle * still;

  // a body going down rolls over and keeps going into the ground, which is what hands it over to
  // the carcass lying underneath without either of them being seen to appear
  const going = dyingAt(e.dying);
  if (going === 0) return { bob, lean, roll };
  return {
    bob: bob * (1 - going) - DYING.sink * going,
    lean: lean * (1 - going),
    roll: roll * (1 - going) + DYING.fall * going,
  };
}

import { hashString, rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { BEHAVIOUR, Entity, Herd, canStand, groundY, type TileWorld } from './entity';
import { specFor, specNamed, treeNameFor } from './behaviours';
import { dutyAt, rangeIn, ringIn } from './timetable';

/**
 * What a week of a behaviour does, when nobody was there for any of it.
 *
 * This is the half of C2 that the rest of C2 stands on. The measurement in `tools/ticks.ts` settled
 * the question it was taken to settle: a province-sized population steps at between one and three
 * times real time, so catching a week up by running the week is out by four or five orders of
 * magnitude, and no reduction in tick rate closes that. A coarse tier that is "the same code, less
 * often" does not reach. The only thing that reaches is knowing the answer without running the
 * ticks — and the answer has to be *written down*, per behaviour, or the coarse tier is guessing.
 *
 * So: for each tree in `behaviours/`, what is actually true after a long time with nobody watching?
 *
 * The rule the whole file is held to is that a closed form must agree with the simulation in the
 * ways somebody could tell and is free to differ in the ways nobody could. Nobody alive can say
 * whether a particular rabbit spent Tuesday behind a particular rock. Everybody notices if the
 * rabbits are gone, if there are suddenly ten thousand of them, if the innkeeper is standing in a
 * field at midnight, or if the whole flock has teleported into the sea. Every form below therefore
 * carries a `keeps` and a `loses` in so many words, and `unwatched.test.ts` runs the simulation
 * forward beside the form and holds it to them.
 *
 * ## The result, which was not the expected one
 *
 * A week of a behaviour, in this game, **moves things and does nothing else**. That is worth
 * stating plainly because the obvious expectation — a wolf pack thins a village, a hunter empties
 * the woods — is wrong here, and it is wrong for a good reason rather than an oversight:
 *
 * - *Wild populations are not state.* A chunk's animals are re-derived from the world seed every
 *   time the chunk is spawned (`ChunkManager.spawnChunk`, `mulberry32(hash3(seed, cx, cz,
 *   HERD_CHUNK))`). Kill a rabbit, walk away, come back, and the roll is the same roll. There is no
 *   book anywhere that a predation closed form could write a number into, so a form that reduced a
 *   population would be reducing something that does not exist and would be silently undone by the
 *   next spawn. This is a real gap and it is on the work list; it is not something to fake here.
 * - *Village populations are state, and something else already keeps them.* `game/rescue.ts` says
 *   what a pack or a haunt takes out of a village per night, as a share of who is left, and
 *   `game/nemesis.ts` says what Old Nettle costs a village per fortnight. Both are closed forms
 *   already, written a layer up where the register lives. A second toll down here would be the same
 *   deaths counted twice, which is worse than no toll at all.
 * - *Purses, meals and births are the register's day, not a creature's week.* `game/economy.bench`
 *   lives villages forward a hundred days a day at a time out of the books. A villager's earnings
 *   over an unwatched week belong there and are already there.
 *
 * That leaves the behaviour layer owning exactly what it should own: where a thing is, whether it
 * is indoors, and — for a good third of the bestiary — nothing whatever, because with nobody about
 * their tree does not move them at all. Which makes the coarse tier's job small: it **places**
 * creatures, it does not simulate them.
 *
 * ## Four forms, twenty-three trees
 *
 * `staysPut`, `driftsInRange`, `ridesItsCircle`, `keepsItsHours`. Every tree the game ships is one
 * of those, `LONG_RUN` at the bottom says which, and the test holds that table to `allTrees()` in
 * both directions the way `world/catalogue.test.ts` holds the catalogue to the prop library: a new
 * tree with no long-run twin is a failed build with a sentence saying what to do about it, never a
 * silent fallback to "leave it where it was".
 *
 * Not one of the four holds a number of its own about how a creature behaves. How far a wanderer
 * ranges and what hours an innkeeper keeps are read straight out of `behaviours/` by
 * `timetable.ts`, so there is one copy of each and changing it in the JSON changes the week as well
 * as the minute. The numbers that *are* here — `SETTLES`, `RIM_BIAS` — are about the closed form
 * itself rather than about any creature, and each says what it was measured against.
 *
 * ## What this file deliberately does not do
 *
 * It does not decide *when* to catch anything up. Which province is live, which is coarse and which
 * is frozen is C2's other half and belongs with C3, which puts an agent in one province so that a
 * week of its life is one province's business. The seam is `catchUp` below: hand it a herd and how
 * long nobody was looking, and it is done. Nothing here reads a clock, a player list or a province.
 */

/** Everything a form is allowed to know about the stretch of time it is accounting for. */
export interface Away {
  /** How long nobody was watching, in seconds. */
  seconds: number;
  /** The time of day it is *now*, as a fraction of a day — the number the trees ask `hourBetween`. */
  time: number;
  /** The world seed, so two machines catch the same herd up to the same place. */
  seed: number;
  /**
   * The ground, for asking whether a spot is one this kind could stand on.
   *
   * Optional, and its absence is not a detail: **with no ground, nothing moves.** A form that
   * placed creatures without being able to ask the world would put sheep in lakes and travellers
   * off their road, and a wrong position is far worse than a stale one. So the degenerate case of
   * every form below is `staysPut`, which is always a defensible answer.
   */
  ground?: TileWorld | null;
}

/** What a stretch of not being watched came to. */
export interface Aftermath {
  /** Whether anything at all is different. False means the herd is exactly as it was left. */
  moved: boolean;
  /** How many of the herd are standing somewhere new. */
  placed: number;
}

/**
 * One behaviour's long-run twin.
 *
 * `keeps` and `loses` are prose because they are the actual claim being made, and they are fields
 * rather than comments because a claim nothing reads is a claim that goes stale. The test reads
 * them: every form must say both, and the comparison it runs is the comparison `keeps` describes.
 */
export interface LongRun {
  /** What is still true after a week of this, and what the test therefore checks. */
  readonly keeps: string;
  /** What is deliberately not, because nobody who was not there could tell. */
  readonly loses: string;
  /** Catch one creature up. True if it ended up somewhere new. */
  readonly settle: (e: Entity, away: Away) => boolean;
}

export class LongRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LongRunError';
  }
}

/**
 * Shorter than this and nothing moves.
 *
 * Derived rather than chosen: `HERD_DRIFT_TIME[0]` is the shortest gap the simulation ever leaves
 * between two moves of a herd's anchor, so below it the simulation could not have moved the herd
 * either and neither should this. Larger, and a coarse tier hands back positions that are visibly
 * stale — a herd frozen mid-field while the clock runs. Smaller is not possible without claiming a
 * move the simulation would not have made, which is how a creature comes to teleport eight tiles
 * the moment a player turns their back.
 */
const SETTLES = BEHAVIOUR.HERD_DRIFT_TIME[0];

/**
 * How many spots to try before giving up and leaving something where it is.
 *
 * The same eight `somewhereNear` in `verbs.ts` tries, and for the same reason: eight is enough to
 * find standing room in any country that has some, and giving up rather than searching harder is
 * what keeps a herd penned in by a cliff from ending up on the wrong side of it.
 */
const TRIES = 8;

const TAU = Math.PI * 2;

// --- the same answer on every machine ---

/**
 * A number in [0, 1) for one creature, one absence and one question.
 *
 * Rolled from where the creature is standing rather than from any identifier it carries, because
 * position is the one thing every machine holding this world already agrees about: `worldId` is
 * nought for anything the client owns and a herd index shifts the moment something dies. The
 * elapsed seconds are in the salt as well, so catching the same creature up over three days and
 * over seven does not put it in the same spot.
 */
function draw(e: Entity, away: Away, salt: number): number {
  const seed = derive(away.seed, SALT.UNWATCHED) ^ hashString(`${e.kind.id}:${e.name}`);
  return rand2(seed, Math.round(e.x * 16), Math.round(e.z * 16), salt + Math.round(away.seconds));
}

/** The same, for a herd: keyed on where it lives and where its anchor has got to. */
function drawHerd(h: Herd, away: Away, salt: number): number {
  const seed = derive(away.seed, SALT.UNWATCHED) ^ hashString(h.kind.id);
  return rand2(seed, Math.round(h.homeX * 4 + h.ax), Math.round(h.homeZ * 4 + h.az), salt + Math.round(away.seconds));
}

// --- putting things down again ---

/**
 * How far a herd's anchor has got from home after this long — the random walk, solved.
 *
 * `updateHerd` moves an anchor one fixed step in a uniformly random direction every eight to
 * eighteen seconds, refusing any step that would leave the leash. A walk like that has no memory of
 * where it started once it has taken a few steps, so after `n` steps its root-mean-square distance
 * from home is `step * sqrt(n)` and it stops growing when it meets the leash. Which is the whole
 * closed form: `n` is `seconds / gap`, and the answer saturates.
 *
 * Measured against the simulation before it was trusted, on a leash of twelve: the anchor's mean
 * displacement is already 5.0 tiles after five seconds, 6.8 after thirty, and flat at 7.0–8.0 from
 * about a minute onwards. **A herd forgets where it started in under a minute**, which is why a
 * week and a minute have the same answer and why nothing about this gets harder as the absence
 * gets longer. Even over the whole leash a disc drawn evenly by area has a mean radius of 8.0, so
 * the anchor really does end up as good as uniform inside its leash — very nearly, and `RIM_BIAS`
 * below is the "very nearly".
 */
export function spreadAfter(h: Herd, seconds: number): number {
  const step = h.kind.behaviour === 'prowl' ? BEHAVIOUR.PROWL_DRIFT : BEHAVIOUR.HERD_DRIFT;
  // a herd on a shorter leash than one drift never moves at all: the first step out of home
  // already crosses the line, and every step after it is that same step again
  if (step > h.leash) return 0;
  const gap = (BEHAVIOUR.HERD_DRIFT_TIME[0] + BEHAVIOUR.HERD_DRIFT_TIME[1]) / 2;
  return Math.min(h.leash - RIM_BIAS * step, step * Math.sqrt(seconds / gap));
}

/**
 * How far in from its leash the rejection at the rim packs a herd, as a share of one drift.
 *
 * `updateHerd` throws away a step that would cross the leash and leaves the anchor exactly where it
 * was, so the walk is not free inside the disc — near the rim most directions are refused and the
 * only ones that take are the ones pointing home. The bias therefore scales with how big a step is
 * against how long a leash it is on, which is why this is a share of the drift and not a distance.
 *
 * Measured. A grazer's five-tile drift on a twelve-tile leash barely shows: the simulation puts a
 * sheep 7.47 tiles from home on average and an uncorrected draw puts it at 7.49. A wolf's nine-tile
 * drift on the same leash shows plainly: 7.36 against 9.89, a third too far. Two fifths of a step
 * brings the wolf back to 7.79 and costs the sheep a little in the other direction, at 6.37; across
 * seven kinds the form then lands between 0.82 and 1.06 of what the simulation does, which is
 * inside the spread the simulation itself shows between kinds that ought to be identical. The
 * argument for either end is the wolf and the sheep: too small and every pack in the world dens a
 * third further out than it should, too large and the whole bestiary huddles round its own doorstep.
 */
const RIM_BIAS = 0.4;

/** Move a herd's anchor to where a week of drifting would plausibly have left it. */
function settleAnchor(h: Herd, away: Away): void {
  const ground = away.ground;
  if (!ground || away.seconds < SETTLES) return;
  const reach = spreadAfter(h, away.seconds);
  // a herd whose anchor cannot have moved keeps the anchor it has, which is not the same thing as
  // being sent home: a villager's anchor is wherever their trade last put them, and hauling it back
  // to the spot the herd was founded on would undo a day's work rather than leave it alone
  if (reach <= 0) return;
  for (let tries = 0; tries < TRIES; tries++) {
    // sqrt of a uniform, so the draw is even over the *area* of the disc rather than crowding the
    // middle — which is what a walk with no memory actually settles into
    const far = reach * Math.sqrt(drawHerd(h, away, tries * 2));
    const angle = drawHerd(h, away, tries * 2 + 1) * TAU;
    const nx = h.homeX + Math.cos(angle) * far, nz = h.homeZ + Math.sin(angle) * far;
    if (!canStand(ground, h.kind, nx, nz)) continue;
    h.ax = nx; h.az = nz;
    return;
  }
}

/**
 * Whatever this creature was part way through, it is not part way through it any more.
 *
 * A week is longer than any behaviour in the game takes. A wolf caught mid-charge, a bear three
 * frames into a swing, a villager walking to the surgery — none of those survive being left alone
 * until Tuesday, and resuming one on arrival is the single most obviously wrong thing a coarse tier
 * could do. So the mind is wiped and the half-finished business with it. This is the one thing
 * `staysPut` still changes, and it is why its `keeps` says *where it is and what it is* rather than
 * everything.
 */
function forgets(e: Entity): void {
  e.mind.wipe();
  e.target = null;
  e.charging = 0;
  e.winding = 0;
  e.strike = 0;
  e.attackCooldown = 0;
  e.hurt = 0;
  e.warned = false;
}

/** Put a creature down somewhere it could stand, within `radius` of its herd's anchor. */
function placeNear(e: Entity, radius: number, away: Away, salt: number): boolean {
  const ground = away.ground;
  if (!ground) return false;
  const h = e.herd;
  for (let tries = 0; tries < TRIES; tries++) {
    // the same law `somewhereNear` picks by — half a tile clear of the anchor, then out to the
    // radius — rather than a nicer one, so the form's spread is the simulation's spread
    const far = 0.5 + draw(e, away, salt + tries * 2) * radius;
    const angle = draw(e, away, salt + tries * 2 + 1) * TAU;
    const nx = h.ax + Math.cos(angle) * far, nz = h.az + Math.sin(angle) * far;
    if (!canStand(ground, e.kind, nx, nz)) continue;
    stand(e, nx, nz, ground);
    return true;
  }
  return false;
}

/** Set a creature down at a point, idle, on the ground, with nothing pending. */
function stand(e: Entity, x: number, z: number, ground: TileWorld): void {
  e.x = x; e.z = z;
  e.tx = x; e.tz = z;
  const gy = groundY(ground, e.kind, x, z);
  if (gy !== null) e.y = gy;
  e.state = 'idle';
  e.timer = 0.5;
  e.walk = 0;
  e.bobY = 0;
}

// --- the four forms ---

/**
 * Nothing happens. The creature is exactly where it was left, and that is not an approximation.
 *
 * Four trees are like this and it is worth saying which and why, because "this behaviour has no
 * long-run effect at all" is a result rather than a shrug — it is the licence for the frozen tier
 * to be genuinely frozen rather than merely cheap.
 *
 * - **seaHunter.** Its first branch is `not afloat -> idle` and its last is `idle`. With nobody in
 *   the water there is no other branch, and `idle` moves nothing. A shark run for an hour with
 *   nobody about finishes on the exact coordinates it started on, to the last decimal place.
 * - **wight.** Idle by day because the tree says so, and idle by night because with nobody within
 *   twelve tiles `markPrey` fails and the branch after it is `idle`. Its own note says it: "it
 *   stands exactly where it was left". The only trees in the game that never `wander`.
 * - **nettle.** He would roam, but where Old Nettle goes next is decided a fortnight at a time in
 *   `game/nemesis.ts`, which moves him between villages and says who it costs. Roaming him here as
 *   well would be two hands on the same puppet.
 * - **hired.** A sword bought and paid for stands at the shoulder of whoever paid. If one is ever
 *   being caught up on a week, the person who hired it has gone, and what to do about that is a
 *   dismissal and the game's business — not something a placement rule should paper over by
 *   walking it into a field.
 */
const staysPut: LongRun = {
  keeps: 'everything about where it is and what it is: position, heading, hit points, herd',
  loses: 'whatever it was part way through, since nothing in the game takes a week',
  settle: (e) => { forgets(e); return false; },
};

/**
 * Somewhere plausible in its range, which is all anybody could ever say about it.
 *
 * The herd's anchor has taken a random walk inside its leash and the creature is pottering about
 * that anchor; neither has any memory of where it was a week ago, so the honest answer is a draw
 * from where it has ended up rather than a claim about a path. `spreadAfter` above is the walk
 * solved; the offset from the anchor is drawn by the same law `somewhereNear` uses, so the shape of
 * the flock is the shape the simulation makes.
 *
 * Applied to grazers, hoppers, swimmers, travellers, prowlers, monsters and ogres. Notice what is
 * *not* in that list of consequences: nothing is eaten, nothing is grazed down, no ground is
 * changed. The `graze` verb sets a pose and a timer and touches no state that outlives the tick —
 * there is no forage anywhere in this world to deplete — and a pack's kills belong to
 * `game/rescue.ts`. See the head of this file.
 */
const driftsInRange: LongRun = {
  keeps: 'that it is inside its leash of home, that its herd is still standing together, that it '
    + 'is on ground its kind can stand on, and that there are exactly as many of them as before',
  loses: 'which spot of the several thousand it could be on, which way it is facing, every step '
    + 'of how it got there, and about a tenth of its distance from home — the simulation\'s members '
    + 'trail an anchor that has already moved on, and this draws them round where it stands now',
  settle: (e, away) => {
    forgets(e);
    if (away.seconds < SETTLES) return false;
    return placeNear(e, rangeOf(e), away, 0);
  },
};

/**
 * How far this creature's own tree lets it range, out of the file.
 *
 * It throws rather than falling back on a number of its own, and the choice is the same one
 * `longRunOf` makes. A tree filed under `driftsInRange` that has no `wander` or `roam` in it is a
 * contradiction somebody has written down — either the tree stopped wandering and its long-run twin
 * was not revisited, or it was filed wrongly in the first place — and a quiet default of four tiles
 * would turn that into an ogre pottering about in a circle a fifth of the size of its ground, which
 * is the sort of thing that gets noticed a year later by somebody who cannot explain it.
 */
function rangeOf(e: Entity): number {
  const name = treeNameFor(e) ?? e.kind.id;
  const spec = specNamed(name);
  const range = spec ? rangeIn(spec) : null;
  if (range === null) {
    throw new LongRunError(
      `"${name}" is filed as a behaviour that drifts about its range, and there is no wander or `
      + 'roam anywhere in its tree to say how far that is. Either give it one in behaviours/, or '
      + 'give it a different form in LONG_RUN in src/entities/unwatched.ts.',
    );
  }
  return range;
}

/**
 * A flier's circle, solved rather than stepped — the one form here that is *exact*.
 *
 * `patrol` is not a decision at all, it is an integration: the herd's shared angle advances by
 * `dt * speed / radius` every tick and the bird is drawn at that angle. So its position after a
 * week is `angle + seconds * speed / radius`, and that is not an approximation of the simulation,
 * it is the simulation's own recurrence written without the loop. Run an eagle for an hour at
 * thirty ticks a second and the two agree to the width of one tick.
 *
 * Two things are deliberately left alone. The animation phase, because nobody can tell where in a
 * wingbeat a bird was a week ago. And the height, for a worse reason: a flier's `y` has no
 * time-independent value to compute. `patrol` pulls it up towards `altitude` at `dt * 2` a tick
 * while the ground-following at the bottom of `updateEntity` pulls it back down at `dt * 12`, so
 * what it settles at is a fixed point of the two filters and therefore *depends on the tick length*
 * — an eagle with an altitude of 9 sits at 1.85 above ground of height 1. That is a live bug, it is
 * on the work list, and it is not this file's to fix; what this file can do is refuse to invent a
 * closed form for a quantity that does not have one, and leave `y` where the simulation put it.
 */
const ridesItsCircle: LongRun = {
  keeps: 'exactly where on its ring it is and which way it is facing, to floating point',
  loses: 'where in a wingbeat it was, and its height — which has no value independent of the tick '
    + 'length to be preserved (see the note above)',
  settle: (e, away) => {
    forgets(e);
    const ground = away.ground;
    if (!ground || away.seconds < SETTLES) return false;
    const h = e.herd;
    const around = h.angle + (e.slot % 3) * 2.1;
    const radius = ringOf(e);
    const nx = h.ax + Math.cos(around) * radius, nz = h.az + Math.sin(around) * radius;
    e.yaw = Math.atan2(-(nz - e.z), nx - e.x);
    e.x = nx; e.z = nz;
    e.tx = nx; e.tz = nz;
    const under = ground.heightAt(h.ax, h.az);
    if (under !== null) h.baseY = under;
    e.state = 'fly';
    e.flap = 1;
    e.walk = 0;
    return true;
  },
};

/**
 * The ring one flier keeps to: the tree's radius, spread by which slot it holds in its herd.
 *
 * Exactly the arithmetic in `patrol`, including that a creature which is not being drawn has a slot
 * of -1 and so rides a tighter ring than any of the drawn ones. That is odd, it is what the
 * simulation does, and a closed form that quietly corrected it would disagree with the walk a
 * player can watch — which is the one thing it is not allowed to do.
 */
function ringOf(e: Entity): number {
  const name = treeNameFor(e) ?? e.kind.id;
  const spec = specNamed(name);
  const tiles = spec ? ringIn(spec) : Number.NaN;
  if (Number.isNaN(tiles)) {
    throw new LongRunError(
      `"${name}" is filed as a behaviour that rides a circle, and there is no patrol anywhere in `
      + 'its tree to say how wide. Either give it one in behaviours/, or give it a different form '
      + 'in LONG_RUN in src/entities/unwatched.ts.',
    );
  }
  return tiles + (e.slot % 3) * 1.5;
}

/**
 * Somebody whose day has hours in it is exactly where their hours say, and this is exact too.
 *
 * An innkeeper's tree is a list of `hourBetween` guards over `goTo`s, and nothing else. There is no
 * randomness in it and no dependence on anything that happened: at any hour of any day, the file
 * says which post he is standing at. So the closed form for a week is a table lookup, and it is
 * read out of `behaviours/villagers.json` itself rather than transcribed, which means it cannot go
 * stale when somebody moves the doctor's surgery hours.
 *
 * This is the form that most obviously matters to a player. Arriving in a village at three in the
 * morning after a fortnight away and finding everybody standing in the street would be the loudest
 * possible way of announcing that nobody was home while you were gone. Being indoors is preserved
 * because being indoors is *visible*.
 *
 * Hours that are not postings fall through to `driftsInRange`: the wanderer's daylight, the
 * explorer's roaming, the hunter's afternoon in the woods. What a hunter caught out there is the
 * register's business — see the head of this file.
 */
const keepsItsHours: LongRun = {
  keeps: 'which post their day puts them at, at the hour they are found, and whether they are '
    + 'behind their own front door — exactly, from the same file the simulation reads',
  loses: 'the walk there, the purse, who they passed, and where they stood during the hours their '
    + 'trade leaves to them',
  settle: (e, away) => {
    forgets(e);
    if (away.seconds < SETTLES) return false;
    const spec = specFor(e);
    if (!spec) return false;
    const duty = dutyAt(spec, away.time);
    // going through a door is the one placement that does not ask the ground where it may stand,
    // so it needs its own guard: with no world to ask, nothing moves, doors included
    if (!away.ground) return false;
    if (duty?.post) {
      const post = e.posts[duty.post];
      // a trade with nowhere to do it — a sailor in a village with no shore — is what the `goTo`
      // verb calls failure, and the tree carries on to the next branch. Here it means the hour
      // decides nothing, so fall through to ranging.
      if (post) {
        // `goTo` moves the herd anchor to the post, so somebody's whole day follows their work
        e.herd.ax = post[0]; e.herd.az = post[1];
        if (duty.enter) {
          e.x = post[0]; e.z = post[1];
          e.tx = post[0]; e.tz = post[1];
          e.indoors = true;
          e.state = 'idle';
          e.timer = 0;
          e.walk = 0;
          return true;
        }
        e.indoors = false;
        // a post that cannot be stood on leaves them where they were, which is what the simulation
        // does with somebody who never manages to arrive
        return placeNear(e, duty.ranges, away, 64);
      }
    }
    e.indoors = false;
    return placeNear(e, duty?.ranges || rangeIn(spec) || atALooseEnd(), away, 128);
  },
};

/**
 * How far somebody with nothing to do and nowhere to do it potters about.
 *
 * A hunter in a village with no woods, a sailor in one with no shore. `goTo` fails for them in the
 * simulation too and they fall through to whatever is below it, so this is that fall-through
 * written down — and rather than a number of its own it borrows the ordinary villager's out of the
 * wanderer tree, because somebody whose trade has nothing for them today is exactly an ordinary
 * villager for the rest of it. The four at the end is unreachable while `behaviours/creatures.json`
 * has a wanderer in it with a `wander` in its day, which it has had since there were villagers.
 */
function atALooseEnd(): number {
  const spec = specNamed('wanderer');
  return (spec && rangeIn(spec)) ?? 4;
}

/**
 * What a week of each tree does. Every tree in `behaviours/` is here, and nothing else is.
 *
 * `unwatched.test.ts` holds this to `allTrees()` in both directions, the way
 * `world/catalogue.test.ts` holds the catalogue to the prop library. A tree without a long-run form
 * is a failed build and a sentence telling somebody what to write; it is never a quiet fallback to
 * leaving the creature alone, because a quiet fallback is how a coarse tier ends up shipping a
 * province where the wolves have not moved in a fortnight and nobody knows why.
 */
export const LONG_RUN: Record<string, LongRun> = {
  // creatures.json
  grazer: driftsInRange,
  wanderer: keepsItsHours,
  traveller: driftsInRange,
  hopper: driftsInRange,
  swimmer: driftsInRange,
  prowler: driftsInRange,
  monster: driftsInRange,
  flier: ridesItsCircle,
  seaHunter: staysPut,

  // villagers.json — a day of hours, every one of them read back out of the file
  innkeeper: keepsItsHours,
  seller: keepsItsHours,
  farmer: keepsItsHours,
  hunter: keepsItsHours,
  constable: keepsItsHours,
  doctor: keepsItsHours,
  soldier: keepsItsHours,
  sailor: keepsItsHours,
  climber: keepsItsHours,
  explorer: keepsItsHours,
  /*
   * A shift at the rock face, and `staysPut` is the true answer rather than the easy one.
   *
   * `facework` has no hours in it — a mine does not know what the sky is doing — and a miner is put
   * at his cut by `game/crews.ts` when somebody walks into the workings, not by a timetable. So a
   * week of it leaves a man exactly where the crew list says he is, which is what `staysPut` keeps.
   *
   * What a week of his *work* does is a different question and is already answered elsewhere:
   * `game/mines.ts` lives every village's mine forward a day at a time, gold and all, whether or
   * not anybody is underground to see it. Giving this form a yield as well would mint the same coin
   * twice.
   */
  facework: staysPut,
  hired: staysPut,

  // monsters.json and villain.json
  ogre: driftsInRange,
  wight: staysPut,
  nettle: staysPut,
};

/**
 * The long-run twin of a named tree, or a failure a person can act on.
 *
 * Deliberately not `?? staysPut`. Somebody adding a behaviour and forgetting this file would
 * otherwise get a creature that is silently exempt from the passage of time, which reads as a bug
 * in the world rather than a gap in the code and would be found by a player long before it was
 * found by anybody who could fix it.
 */
export function longRunOf(name: string): LongRun {
  const form = LONG_RUN[name];
  if (!form) {
    throw new LongRunError(
      `nothing says what a week of "${name}" does. Add it to LONG_RUN in src/entities/unwatched.ts: `
      + 'a coarse tier catches a province up by calculating, not by ticking, so a behaviour with no '
      + 'closed form cannot be left alone. If the honest answer is that a week of it changes nothing, '
      + 'say so with `staysPut` — that is a result, not a stub.',
    );
  }
  return form;
}

/**
 * Catch a whole herd up on the time nobody was watching it. **This is the seam.**
 *
 * Whoever wires up C2's tiers calls this and nothing else: it is the one entry point, it takes no
 * clock and no player list, and it is a pure function of the herd and the stretch of time. A
 * province that has been asleep for a week is `catchUp` over its herds, in whatever order, and it
 * costs a few dozen hashes per creature rather than six million ticks.
 *
 * The order inside matters and is the order the simulation uses. `updateHerd` runs before any
 * creature is thought for, so the anchor settles first; the fliers' shared angle is advanced next,
 * once per member exactly as the ticks would have done it; then each creature is put down by its
 * own tree's form. A villager's trade decides for them before their species does, because
 * `treeNameFor` is the same rule `treeFor` runs on.
 */
export function catchUp(herd: Herd, away: Away): Aftermath {
  settleAnchor(herd, away);
  advanceRing(herd, away);
  let placed = 0;
  for (const e of herd.members) {
    if (e.dead || e.dying > 0) continue;
    // falling back to the kind's own name is only so the error below can say which creature it
    // was: anything with no tree at all has no long-run form either, and both are worth hearing
    if (longRunOf(treeNameFor(e) ?? e.kind.id).settle(e, away)) placed++;
  }
  return { moved: placed > 0, placed };
}

/**
 * Advance a flock's shared circle by everything the ticks would have added to it.
 *
 * Once per member per tick is what `patrol` does — the angle is on the herd and every bird in it
 * pushes the same number along — so the total is the sum of each member's own rate, and a herd of
 * three goes round three times as fast as one bird would. That is odd and it is faithful; the
 * alternative is a closed form that puts a flock somewhere the simulation never would.
 */
function advanceRing(herd: Herd, away: Away): void {
  if (herd.kind.behaviour !== 'fly' || away.seconds < SETTLES) return;
  let rate = 0;
  for (const e of herd.members) {
    if (e.dead || e.dying > 0) continue;
    rate += e.kind.speed / ringOf(e);
  }
  herd.angle += away.seconds * rate;
}

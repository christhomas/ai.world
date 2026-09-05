import { describe, expect, it, vi } from 'vitest';
import {
  BLOW_NAMES, FLINCH_LASTS, type Moving, arcOf, blowOf, bodyLean, bodyMotion, cycleTurn, flinchAt,
  isBlow, lastsFor, limbTurn, mirrors, runShare, strikeAt,
} from './motion';
import { KINDS } from './animals';

const still: Moving = { walk: 0, flap: 0, phase: 0, headPitch: 0, hurt: 0, dying: 0 };
const walking: Moving = { walk: 1, flap: 1, phase: Math.PI / 2, headPitch: 0, hurt: 0, dying: 0 };
/** Slower than the pace a run takes over at, so it is an amble however hard it is trying. */
const ambling: Moving = { ...walking, walk: 0.4 };
/** A creature a moment after something landed on it. */
const struck: Moving = { ...still, hurt: FLINCH_LASTS * 0.85 };

/** Every value something takes over one full stride, because one frame of a cycle says nothing. */
function overAStride(of: (e: Moving) => number, e: Moving, steps = 360): number[] {
  return Array.from({ length: steps }, (_, i) => of({ ...e, phase: (i / steps) * Math.PI * 2 }));
}

/** How far a thing travels in total: the only honest way to say one moves more than another. */
function travel(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

const bobOf = (e: Moving) => bodyMotion(e).bob;
const turnOf = (part: Parameters<typeof cycleTurn>[0]) => (e: Moving) =>
  cycleTurn(part, e).reduce((most, v) => (Math.abs(v) > Math.abs(most) ? v : most), 0);

/**
 * The point of animations/motion.json is that somebody can change how the game moves without
 * touching a line of code, so what is tested is that the file is actually in charge: every blow
 * comes from it, every creature can throw one, and a limb that moves does so because the file
 * said a number.
 */
describe('the motion file', () => {
  it('is what says which blows exist at all', () => {
    for (const name of ['swing', 'punch', 'kick', 'bite', 'rear', 'lunge']) {
      expect(BLOW_NAMES, name).toContain(name);
      expect(isBlow(name)).toBe(true);
    }
    expect(isBlow('pirouette')).toBe(false);
  });

  it('gives every blow a length, and takes it from the file', () => {
    for (const name of BLOW_NAMES) {
      expect(lastsFor(name as never), name).toBeGreaterThan(0);
    }
    // a bear takes longer to go up and come down than somebody throws a punch
    expect(lastsFor('rear')).toBeGreaterThan(lastsFor('punch'));
  });

  it('winds up before it comes through, and settles at the end', () => {
    expect(arcOf('swing', 0)).toBe(0);
    expect(arcOf('swing', 0.1), 'must go back first').toBeLessThan(0);
    expect(arcOf('swing', 0.6), 'and then come forward').toBeGreaterThan(0);
    expect(arcOf('swing', 1)).toBe(0);
  });

  it('reads a countdown as how far through the blow is', () => {
    expect(strikeAt('swing', 0)).toBe(0);
    expect(strikeAt('swing', lastsFor('swing'))).toBeCloseTo(0, 5);
    expect(strikeAt('swing', lastsFor('swing') / 2)).toBeCloseTo(0.5, 5);
  });

  it('moves the arm for a swing and the leg for a kick, and never both', () => {
    expect(limbTurn('armR', 'swing', 0.6, false)).not.toBeNull();
    expect(limbTurn('legR', 'swing', 0.6, false)).toBeNull();
    expect(limbTurn('legR', 'kick', 0.6, false)).not.toBeNull();
    expect(limbTurn('armR', 'kick', 0.6, false)).toBeNull();
  });

  it('throws with the other hand when told to, so a flurry is not one arm four times', () => {
    expect(mirrors('punch')).toBe(true);
    expect(limbTurn('armR', 'punch', 0.6, false)).not.toBeNull();
    expect(limbTurn('armR', 'punch', 0.6, true)).toBeNull();
    expect(limbTurn('armL', 'punch', 0.6, true)).not.toBeNull();
  });

  it('swings a weapon further than it throws a fist, because the file says so', () => {
    expect(Math.abs(limbTurn('armR', 'swing', 0.6, false)!))
      .toBeGreaterThan(Math.abs(limbTurn('armR', 'punch', 0.6, false)!));
  });

  it('tips the whole body over for a rear and a lunge, and for nothing else', () => {
    expect(bodyLean('rear', 0.6)).not.toBe(0);
    expect(bodyLean('lunge', 0.6)).not.toBe(0);
    for (const blow of ['swing', 'punch', 'kick', 'bite'] as const) {
      expect(bodyLean(blow, 0.6), blow).toBe(0);
    }
  });

  it('rears a bear backwards and drives a lunge forwards, which is the way round they read', () => {
    // the body stands above its pivot, so a positive lean tips it back: a bear goes up on its
    // hind legs and a shark comes at you nose first, and the file's signs say which is which
    expect(bodyLean('rear', 0.6), 'a rear goes up and back').toBeGreaterThan(0);
    expect(bodyLean('lunge', 0.6), 'a lunge goes down and forward').toBeLessThan(0);
    expect(limbTurn('head', 'bite', 0.6, false)!, 'a bite closes downward').toBeLessThan(0);
  });

  it('has a bear go up on its hind legs and a wolf use its teeth', () => {
    expect(blowOf(KINDS.bear)).toBe('rear');
    expect(blowOf(KINDS.wolf)).toBe('bite');
    expect(blowOf(KINDS.villager), 'anything with arms throws hands').toBe('punch');
  });
});

/**
 * A blow is not an arc from A to B. It loads, it lands early, and then it spends most of itself
 * coming home, carrying a little past where it started on the way. That last part is the whole
 * difference between a swing and a limb being dragged through a shape.
 */
describe('the shape of a blow', () => {
  const arcAcross = (blow: string): number[] =>
    Array.from({ length: 400 }, (_, i) => arcOf(blow as never, i / 400));

  it('lands early and spends the rest of itself following through', () => {
    const arc = arcAcross('swing');
    const peak = arc.indexOf(Math.max(...arc)) / arc.length;
    expect(Math.max(...arc), 'the landing is the furthest it goes').toBeCloseTo(1, 2);
    expect(peak, 'a blow that lands halfway through is a blow with no follow-through').toBeLessThan(0.6);
  });

  it('carries past where it started before it comes home', () => {
    const arc = arcAcross('swing');
    const home = arc.slice(arc.indexOf(Math.max(...arc)));
    expect(Math.min(...home), 'nothing stops dead on the mark').toBeLessThan(0);
    expect(Math.min(...home), 'a settle, not a second blow').toBeGreaterThan(-0.3);
    expect(arcOf('swing', 0.999), 'and it is home by the end').toBeCloseTo(0, 2);
  });

  it('draws back less far than it hits, because nobody winds up as far as they follow through', () => {
    const arc = arcAcross('swing');
    expect(Math.abs(Math.min(...arc))).toBeLessThan(Math.max(...arc));
  });

  it('never jumps, for any blow in the file', () => {
    for (const blow of BLOW_NAMES) {
      const arc = Array.from({ length: 1000 }, (_, i) => arcOf(blow as never, i / 1000));
      const worst = arc.reduce((most, v, i) => (i === 0 ? most : Math.max(most, Math.abs(v - arc[i - 1]))), 0);
      // a thousandth of a blow is under a millisecond of it, and a limb that covers a fiftieth of
      // its travel in that time has teleported: the wind-up used to end by snapping back to rest
      expect(worst, `${blow} jumps`).toBeLessThan(0.02);
    }
  });
});

describe('the walk cycle', () => {
  it('holds a leg still when nothing is walking and swings it when something is', () => {
    expect(cycleTurn('legL', still)[2]).toBeCloseTo(0, 5);
    expect(Math.abs(cycleTurn('legL', walking)[2])).toBeGreaterThan(0.1);
  });

  it('swings the legs opposite ways, or it is not a walk', () => {
    const [, , left] = cycleTurn('legL', walking);
    const [, , right] = cycleTurn('legR', walking);
    expect(Math.sign(left)).toBe(-Math.sign(right));
  });

  it('beats a wing on its own axis rather than the one legs walk on', () => {
    const [x, , z] = cycleTurn('wingL', { ...walking, phase: 1 });
    expect(Math.abs(x)).toBeGreaterThan(0);
    expect(z).toBe(0);
  });

  it('waves a tail whether or not anything is moving, because a tail does', () => {
    expect(Math.abs(cycleTurn('tail', { ...still, phase: 1 })[1])).toBeGreaterThan(0);
  });

  it('leaves a part the file says nothing about exactly where it was', () => {
    expect(cycleTurn(undefined, walking)).toEqual([0, 0, 0]);
  });
});

/**
 * A body that holds one height while its legs swing is a puppet, and no amount of limb detail
 * fixes it. The weight is the thing: it drops onto each foot, rolls over it, and comes up again.
 */
describe('a body carrying its own weight', () => {
  it('rises and falls twice a stride, because a body is tallest with its legs together', () => {
    const bob = overAStride(bobOf, walking);
    const peaks = bob.filter((v, i) =>
      v > bob[(i + bob.length - 1) % bob.length] && v >= bob[(i + 1) % bob.length]).length;
    expect(peaks, 'one rise per footfall, and there are two feet').toBe(2);
    expect(bodyMotion({ ...walking, phase: 0 }).bob, 'highest as the legs pass')
      .toBeGreaterThan(bodyMotion({ ...walking, phase: Math.PI / 2 }).bob);
  });

  it('settles onto one foot and then the other', () => {
    expect(bodyMotion({ ...walking, phase: 0 }).roll, 'level as the legs pass').toBeCloseTo(0, 5);
    const onto = bodyMotion({ ...walking, phase: Math.PI / 2 }).roll;
    const off = bodyMotion({ ...walking, phase: (3 * Math.PI) / 2 }).roll;
    expect(Math.abs(onto)).toBeGreaterThan(0);
    expect(Math.sign(onto)).toBe(-Math.sign(off));
  });

  it('leans into a walk and stands up again when it stops', () => {
    expect(Math.abs(bodyMotion(walking).lean)).toBeGreaterThan(Math.abs(bodyMotion(still).lean));
    expect(bodyMotion(still).lean).toBe(0);
  });
});

/** A creature at full pace is not an ambling one played faster. */
describe('a run against a walk', () => {
  it('does not start until the pace is well past an amble', () => {
    expect(runShare(0)).toBe(0);
    expect(runShare(ambling.walk)).toBe(0);
    expect(runShare(1)).toBe(1);
  });

  it('leans further than a walk does', () => {
    expect(Math.abs(bodyMotion(walking).lean)).toBeGreaterThan(Math.abs(bodyMotion(ambling).lean) * 2);
  });

  it('opens the stride out rather than just repeating it faster', () => {
    // per unit of pace, so a longer stride is a longer stride and not simply more walking
    const perPace = (e: Moving) => Math.abs(cycleTurn('legL', e)[2]) / e.walk;
    expect(perPace(walking)).toBeGreaterThan(perPace(ambling) * 1.2);
    expect(Math.abs(cycleTurn('armR', walking)[2])).toBeGreaterThan(Math.abs(cycleTurn('armR', ambling)[2]));
  });

  it('carries more weight in the bounce', () => {
    const at = (e: Moving) => travel(overAStride(bobOf, e));
    expect(at(walking)).toBeGreaterThan(at(ambling) * 2);
  });
});

/** Something stood still is still alive: it breathes and shifts, and never twitches. */
describe('an idle that is not a statue', () => {
  it('breathes, and by less than a walk moves it', () => {
    const standing = travel(overAStride(bobOf, still));
    const walked = travel(overAStride(bobOf, walking));
    expect(standing, 'a chest that never rises is a corpse').toBeGreaterThan(0);
    expect(standing).toBeLessThan(walked / 2);
  });

  it('shifts its weight, slowly, and by less than a walk rolls it', () => {
    const standing = travel(overAStride((e) => bodyMotion(e).roll, still));
    const walked = travel(overAStride((e) => bodyMotion(e).roll, walking));
    expect(standing).toBeGreaterThan(0);
    expect(standing).toBeLessThan(walked);
  });

  it('moves a head and an arm while it stands there', () => {
    for (const part of ['head', 'armL', 'armR'] as const) {
      const standing = travel(overAStride(turnOf(part), still));
      expect(standing, `${part} is carved from stone`).toBeGreaterThan(0);
      // the tail is left out: its sway is the walk file's, and runs whatever anything else does
      expect(standing, `${part} twitches rather than breathes`).toBeLessThan(0.1);
    }
  });

  it('gives way to the walk rather than being added to it', () => {
    const standing = travel(overAStride(turnOf('head'), still));
    const walked = travel(overAStride(turnOf('head'), { ...walking, headPitch: 0 }));
    expect(walked).toBeGreaterThan(standing);
  });
});

/**
 * Being hit has to show, and it has to show at the moment it happens rather than a beat later.
 * The countdown the game already keeps is the only thing this needs to know.
 */
describe('a flinch when hurt', () => {
  it('is hardest a moment after the blow and gone by the time it can fight back', () => {
    expect(flinchAt(0), 'nothing is flinching about nothing').toBe(0);
    expect(flinchAt(FLINCH_LASTS), 'the instant of the hit').toBeCloseTo(0, 5);
    expect(flinchAt(FLINCH_LASTS * 0.85), 'a moment after it').toBeGreaterThan(0.5);
    expect(Math.abs(flinchAt(FLINCH_LASTS * 0.1)), 'and long over by the end').toBeLessThan(0.2);
  });

  it('recoils inside the first quarter of the stagger', () => {
    const through = Array.from({ length: 200 }, (_, i) => i / 200);
    const hardest = through.reduce((worst, at) =>
      Math.abs(flinchAt(FLINCH_LASTS * (1 - at))) > Math.abs(flinchAt(FLINCH_LASTS * (1 - worst))) ? at : worst, 0);
    expect(hardest).toBeLessThan(0.25);
  });

  it('folds the body away and sinks it', () => {
    expect(bodyMotion(struck).lean, 'tipped away from whatever landed').toBeGreaterThan(0.1);
    expect(bodyMotion(struck).bob).toBeLessThan(bodyMotion(still).bob);
  });

  it('throws the head, and puts it back afterwards', () => {
    const thrown = Math.abs(cycleTurn('head', struck)[2]);
    expect(thrown).toBeGreaterThan(Math.abs(cycleTurn('head', still)[2]) + 0.2);
    expect(cycleTurn('head', { ...struck, hurt: 0 })).toEqual(cycleTurn('head', still));
  });

  it('flinches while it is walking rather than instead of walking', () => {
    const hurtWalk = { ...walking, hurt: struck.hurt };
    expect(Math.abs(cycleTurn('legL', hurtWalk)[2]), 'the legs keep going')
      .toBeCloseTo(Math.abs(cycleTurn('legL', walking)[2]), 5);
    expect(bodyMotion(hurtWalk).lean).not.toBeCloseTo(bodyMotion(walking).lean, 5);
  });
});

/**
 * Every creature in the game, in every state it can be in. A rig that quietly animates nothing is
 * the failure this catches: it is invisible in a screenshot and obvious in motion.
 */
describe('every creature in the game', () => {
  const partsOf = (kind: { parts: { anim?: string }[] }) =>
    [...new Set(kind.parts.map((p) => p.anim))].filter((p): p is NonNullable<typeof p> => p !== undefined);

  it('moves something when it walks', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const parts = partsOf(kind);
      const moves = parts.some((part) => travel(overAStride(turnOf(part as never), walking)) > 1e-6);
      expect(moves || parts.length === 0, `${id} walks without moving a thing`).toBe(true);
      expect(travel(overAStride(bobOf, walking)), `${id} walks without any weight`).toBeGreaterThan(0);
    }
  });

  it('moves something when it stands still', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const parts = partsOf(kind);
      const breathes = travel(overAStride(bobOf, still)) > 1e-6;
      const stirs = parts.some((part) => travel(overAStride(turnOf(part as never), still)) > 1e-6);
      expect(breathes && (stirs || parts.length === 0), `${id} is a statue when it stops`).toBe(true);
    }
  });

  it('shows it when something hits it', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const folded = Math.abs(bodyMotion(struck).lean) > 0.05;
      const thrown = partsOf(kind).some((part) =>
        Math.abs(turnOf(part as never)(struck) - turnOf(part as never)(still)) > 1e-6);
      expect(folded || thrown, `${id} takes a blow without noticing`).toBe(true);
    }
  });

  it('has something to throw that moves something', () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      const blow = blowOf(kind);
      expect(BLOW_NAMES, id).toContain(blow);
      const moved = partsOf(kind).some((part) => limbTurn(part as never, blow, 0.6, false) !== null);
      expect(moved || bodyLean(blow, 0.6) !== 0, `${id} throws a ${blow} that moves nothing`).toBe(true);
    }
  });
});

/**
 * The file is edited by hand, so it will be edited wrongly, and the only useful thing to do about
 * that is stop with the name of the field in the message. A creature that quietly stops moving is
 * a fortnight of nobody noticing.
 */
describe('a file somebody has got wrong', () => {
  /** A file with nothing wrong with it, so each case can put exactly one thing wrong. */
  const sound = () => ({
    walking: { legL: { of: 'walk', swing: 0.6 } },
    idling: { head: { wave: 0.04, rate: 0.3 } },
    body: { bounce: 0.04, sway: 0.03, lean: -0.05, breath: 0.014, breathRate: 0.9, settle: 0.028, settleRate: 0.22 },
    running: { from: 0.55, stride: 1.4, bounce: 1.55, lean: -0.14 },
    flinch: { lasts: 0.35, snap: 0.18, lean: 0.26, drop: 0.06, turn: { head: 0.5 } },
    dying: { lasts: 0.85, fall: 1.5, sink: 0.75, turn: { head: 0.55 } },
    blows: { punch: { lasts: 0.42, wind: 0.3, turn: { armR: 1.9 } } },
  });

  const loading = async (file: Record<string, unknown>): Promise<unknown> => {
    vi.resetModules();
    vi.doMock('../../animations/motion.json', () => ({ default: file }));
    try {
      return await import('./motion');
    } finally {
      vi.doUnmock('../../animations/motion.json');
      vi.resetModules();
    }
  };

  it('loads at all when there is nothing wrong with it', async () => {
    await expect(loading(sound())).resolves.toBeTruthy();
  });

  it('names the blow that takes a fortnight', async () => {
    const file = sound();
    file.blows.punch.lasts = 99;
    await expect(loading(file)).rejects.toThrow(/blows\.punch\.lasts/);
  });

  it('names a part no creature has', async () => {
    const file = sound() as unknown as { walking: Record<string, unknown> };
    file.walking.legLeft = { of: 'walk', swing: 0.6 };
    await expect(loading(file as never)).rejects.toThrow(/walking\.legLeft/);
  });

  it('names an idle that has been given a stride', async () => {
    const file = sound() as unknown as { idling: Record<string, unknown> };
    file.idling.head = { wave: 0.04, swing: 0.5 };
    await expect(loading(file as never)).rejects.toThrow(/idling\.head\.swing/);
  });

  it('names a body that has been asked to bounce a mile', async () => {
    const file = sound();
    file.body.bounce = 40;
    await expect(loading(file)).rejects.toThrow(/body\.bounce/);
  });

  it('names a run that starts at a standstill', async () => {
    const file = sound();
    file.running.from = 1;
    await expect(loading(file)).rejects.toThrow(/running\.from/);
  });

  it('names a flinch with no recoil in it', async () => {
    const file = sound();
    file.flinch.snap = 0;
    await expect(loading(file)).rejects.toThrow(/flinch\.snap/);
  });

  it('says which section has gone missing altogether', async () => {
    const file = sound() as unknown as Record<string, unknown>;
    delete file.running;
    await expect(loading(file)).rejects.toThrow(/running/);
  });
});

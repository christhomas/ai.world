import { describe, expect, it } from 'vitest';
import { EYRIE } from './eyries';
import { ANCHOR_VERSION, Manifest } from '../world/manifest';
import { layTheCarcass, nestsOn } from './baiting';
import type { Massif } from '../world/mountains';

const range = (x: number, z: number, radius: number): Massif => ({ x, z, radius, height: 80, hollow: 0 });
const anywhere = (): boolean => true;
/** Tiles to the nearest village, for a site nobody could walk to before dark. */
const NOBODY_NEAR = 400;
/** And one with a village in earshot, which is the whole of what a bad site is. */
const IN_THE_SQUARE = 2;

/** A range big enough that the birds already fly it, so only the *site* is ever in question. */
const MOUNTAIN = [range(0, 0, 60)];

/**
 * The site used everywhere below, and the reason it is this one.
 *
 * Halfway in from the skirt of a range of sixty: far enough up that the ground does not refuse
 * outright, and low enough that the roll genuinely decides. A site the eagle always takes would
 * let a re-rolling implementation pass the test that matters most here, so this is chosen to be
 * marginal and the first assertion in that test proves it still is.
 */
const HALFWAY = { x: 0, z: 30 };

const lay = (manifest: Manifest, day: number, at = HALFWAY, toVillage = NOBODY_NEAR) =>
  layTheCarcass(manifest, 7, day, MOUNTAIN, anywhere, toVillage, at.x, at.z);

/**
 * Baiting an eyrie: the carcass you leave on a crag, and the nest that is there afterwards.
 *
 * Two rules and everything here is one of them. The eagle only comes where an eagle would come,
 * and when it does not the world says which condition fell shortest rather than shrugging. And the
 * roll happens *once*: it is written into the manifest the moment it is made, so a world re-lived
 * from its seed reads the answer rather than asking the question again.
 */
describe('a carcass left for the eagles', () => {
  it('does nothing at all in flat country, and says so', () => {
    const bait = layTheCarcass(new Manifest(7), 7, 3, [], anywhere, NOBODY_NEAR, 0, 0);
    expect(bait.nest).toBeNull();
    expect(bait.chance).toBe(0);
    expect(bait.said).toMatch(/high/i);
  });

  it('will not put a nest on a hill an eagle would not bother flying over', () => {
    const hill = [range(0, 0, EYRIE.WORTH_FLYING - 1)];
    const bait = layTheCarcass(new Manifest(7), 7, 3, hill, anywhere, NOBODY_NEAR, 0, 0);
    expect(bait.nest).toBeNull();
    expect(bait.said).toMatch(/hill/i);
  });

  it('refuses a village square, which is the whole point of the condition', () => {
    const bait = lay(new Manifest(7), 3, HALFWAY, IN_THE_SQUARE);
    expect(bait.nest).toBeNull();
    expect(bait.chance).toBe(0);
    expect(bait.said).toMatch(/people|village|nobody/i);
  });

  it('refuses ground nobody could stand on, because a nest is no use halfway down a cliff', () => {
    const nowhere = (): boolean => false;
    const bait = layTheCarcass(new Manifest(7), 7, 3, MOUNTAIN, nowhere, NOBODY_NEAR, HALFWAY.x, HALFWAY.z);
    expect(bait.nest).toBeNull();
  });

  /*
   * The one that matters, and the reason it is built the way it is.
   *
   * A test of a seventy-five per cent roll can pass by accident in half a dozen ways, so this
   * asserts nothing about the odds. It finds one spot where the answer on one day differs from the
   * answer on another — scanned for, not chosen — and then asks what a *re-lived* world says about
   * each. Because both use the same seed and the same tile, any implementation that works the
   * answer out again from where the nest is must give both the same answer, and so must fail one
   * of the two halves. And `nestsOn` is never handed a day, so it cannot work it out from that
   * either. The only way to pass both is to have written the answer down when it was made.
   *
   * The second half is there because the first was not enough, and that was found by breaking the
   * code on purpose rather than by thinking about it. A `nestsOn` that re-rolled each anchor at
   * three in four kept the one nest this test had written and went green. One nest can survive a
   * re-roll by luck; a score of them cannot, so the count of what was written has to come back
   * whole.
   */
  it('rolls once and writes it down, so a re-lived world cannot change its mind', () => {
    let came = -1, ate = -1;
    for (let day = 0; day < 100 && (came < 0 || ate < 0); day++) {
      const bait = lay(new Manifest(7), day);
      expect(bait.chance, 'a site the eagle always takes would prove nothing').toBeGreaterThan(0);
      expect(bait.chance, 'nor would one it never takes').toBeLessThan(1);
      if (bait.nest && came < 0) came = day;
      if (!bait.nest && ate < 0) ate = day;
    }
    expect(came, 'scanned for a day the eagle came').toBeGreaterThanOrEqual(0);
    expect(ate, 'and a day it only ate').toBeGreaterThanOrEqual(0);

    const lucky = new Manifest(7);
    expect(lay(lucky, came).nest).not.toBeNull();
    const unlucky = new Manifest(7);
    expect(lay(unlucky, ate).nest).toBeNull();

    // and this is the re-living: the manifest through a save and back, with nothing else kept
    const relived = (m: Manifest): Manifest => new Manifest(7, JSON.parse(JSON.stringify(m.toJSON())));
    expect(nestsOn(relived(lucky), null, []), 'the nest the eagle built is still there').toHaveLength(1);
    expect(nestsOn(relived(unlucky), null, []), 'and the meal it only ate never became one').toHaveLength(0);

    // a score of nests, each on its own ledge, each written down on the day the eagle came
    const many = new Manifest(7);
    for (let ledge = 0; ledge < 20; ledge++) {
      const at = { x: -18 + (ledge % 5) * 9, z: -18 + Math.floor(ledge / 5) * 9 };
      for (let day = 0; day < 200 && !layTheCarcass(many, 7, day, MOUNTAIN, anywhere, NOBODY_NEAR, at.x, at.z).nest; day++);
    }
    expect(many.byKind('eyrie'), 'twenty ledges, scanned until each took').toHaveLength(20);
    expect(nestsOn(relived(many), null, []), 'every one of them, and not most of them')
      .toHaveLength(many.byKind('eyrie').length);
  });

  /*
   * The distinction #324 makes the whole rule out of: a bird that ate and left writes nothing, so
   * "turned down" and "never tried" are one state. That is what allows another carcass tomorrow,
   * and `chance` is how the two are still told apart at the moment it happens — a ground that
   * refused before any dice were thrown reports nought, and a lost roll reports the odds it lost.
   */
  it('writes nothing for a meal the eagle ate and flew away from', () => {
    const manifest = new Manifest(7);
    let ate = -1;
    for (let day = 0; day < 100 && ate < 0; day++) if (!lay(new Manifest(7), day).nest) ate = day;
    const lost = lay(manifest, ate);
    expect(lost.nest).toBeNull();
    expect(lost.chance, 'the dice were thrown and lost, which is not the same as never thrown').toBeGreaterThan(0);
    expect(manifest.anchors.size, 'and nothing whatever was written down').toBe(0);

    const never = lay(new Manifest(7), ate, HALFWAY, IN_THE_SQUARE);
    expect(never.chance, 'where the ground refused, no dice were thrown at all').toBe(0);
  });

  /*
   * And what that costs, answered rather than left open. A second carcass on the same ledge the
   * same morning gets the same morning's answer, so the refusal cannot be spammed; a third one
   * tomorrow is a fresh roll, so it can be learned from. The day is in the stream for exactly this.
   */
  it('gives the same answer to a second carcass the same day, and a fresh one tomorrow', () => {
    const manifest = new Manifest(7);
    const again = new Manifest(7);
    for (let day = 0; day < 40; day++) {
      expect(!!lay(manifest, day).nest, `day ${day}`).toBe(!!lay(again, day).nest);
    }
    const answers = new Set<boolean>();
    for (let day = 0; day < 40; day++) answers.add(!!lay(new Manifest(7), day).nest);
    expect(answers.size, 'a spot whose answer never changed would make the day pointless').toBe(2);
  });

  it('writes the nest down as an eyrie anchor, which is how it survives the tab closing', () => {
    const manifest = new Manifest(7);
    let nest = null;
    for (let day = 0; day < 100 && !nest; day++) nest = lay(new Manifest(7), day).nest ? lay(manifest, day).nest : null;
    expect(nest).not.toBeNull();
    expect(nest?.kind).toBe('eyrie');
    expect(manifest.byKind('eyrie')).toHaveLength(1);
    // #324: the anchor is the record, so it carries its own seed and generator version like any
    // other entry in the seed tree, and the nest's name is read off that seed rather than re-derived
    expect(nest?.seed).toBeGreaterThan(0);
    expect(nest?.version).toBe(ANCHOR_VERSION.eyrie);
  });

  it('tells a hunter the ground was too low rather than that he was unlucky', () => {
    // right out on the skirt, where the odds are worst and the reason is the height
    const skirt = { x: 0, z: 59 };
    const words = new Set<string>();
    for (let day = 0; day < 40; day++) {
      const bait = lay(new Manifest(7), day, skirt);
      if (!bait.nest) words.add(bait.said);
    }
    expect([...words].some((said) => /high/i.test(said)), [...words].join(' | ')).toBe(true);
  });

  /*
   * What a baited nest is *for*. A lone crag with a bird on it is scenery; a pair is a way over a
   * mountain. `EYRIE.MOST` gives a whole square two crossings however many ranges it has, which is
   * exactly how a country ends up with a place nobody can reach — so two carcasses make a third.
   */
  it('pairs two baited nests into a crossing somebody made for themselves', () => {
    const manifest = new Manifest(7);
    for (const at of [{ x: 0, z: 30 }, { x: 0, z: -30 }]) {
      for (let day = 0; day < 100 && !manifest.byKind('eyrie').some((a) => a.z === at.z); day++) {
        layTheCarcass(manifest, 7, day, MOUNTAIN, anywhere, NOBODY_NEAR, at.x, at.z);
      }
    }
    const nests = nestsOn(manifest, null, []);
    expect(nests).toHaveLength(2);
    expect(nests[0].partner).toBe(nests[1].id);
    expect(nests[1].partner).toBe(nests[0].id);
    expect(nests[0].fare).toBeGreaterThan(EYRIE.FARE_BASE);
  });

  it('does not sell a flight between two nests on the same ledge', () => {
    const manifest = new Manifest(7);
    for (const at of [{ x: 0, z: 30 }, { x: 1, z: 31 }]) {
      for (let day = 0; day < 100 && !manifest.byKind('eyrie').some((a) => a.x === at.x); day++) {
        layTheCarcass(manifest, 7, day, MOUNTAIN, anywhere, NOBODY_NEAR, at.x, at.z);
      }
    }
    const nests = nestsOn(manifest, null, []);
    expect(nests, 'two ledges a stride apart').toHaveLength(2);
    // near enough that the hero would be standing at both ends of his own crossing
    for (const nest of nests) expect(nest.partner, nest.id).toBe('');
  });

  it('gives a single nest the crag the world already planned, and a fare to match', () => {
    const manifest = new Manifest(7);
    for (let day = 0; day < 100 && manifest.byKind('eyrie').length === 0; day++) lay(manifest, day);
    const planned = { id: 'eyrie:0:a', name: 'Windcrag', x: 0, z: -55, partner: 'eyrie:0:b', fare: 40 };
    const [nest] = nestsOn(manifest, null, [planned]);
    expect(nest.partner).toBe(planned.id);
    expect(nest.name).not.toBe('');
  });

  it('leaves a nest on another square out of the crags of this one', () => {
    const manifest = new Manifest(7);
    for (let day = 0; day < 100 && manifest.byKind('eyrie').length === 0; day++) lay(manifest, day);
    expect(nestsOn(manifest, { x0: 1000, z0: 1000, x1: 1512, z1: 1512 }, [])).toHaveLength(0);
    expect(nestsOn(manifest, { x0: -512, z0: -512, x1: 512, z1: 512 }, [])).toHaveLength(1);
  });
});

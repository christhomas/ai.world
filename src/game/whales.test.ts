import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from '../world/graph';
import { TerrainSampler } from '../world/terrain';
import { HOUR_SECONDS, WHALE, displayAt, hourAt, landingOf, planPods, podsWithin, whaleAt } from './whales';

const pods = (seed: number) => planPods(new TerrainSampler(generateRoadGraph(seed)), seed);

describe('where whales live', () => {
  it('puts pods in deep water, well apart, and always in the same places for a seed', () => {
    const sampler = new TerrainSampler(generateRoadGraph(1));
    const first = planPods(sampler, 1);
    expect(first.length).toBeGreaterThan(0);

    for (const pod of first) {
      const here = sampler.probe(pod.x, pod.z);
      expect(here.land).toBe(false);
      expect(here.roadDist).toBeGreaterThanOrEqual(WHALE.DEEP);
      expect(pod.size).toBeGreaterThanOrEqual(WHALE.POD_MIN);
      expect(pod.size).toBeLessThanOrEqual(WHALE.POD_MAX);
    }
    for (const a of first) {
      for (const b of first) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(WHALE.DEEP * 2);
      }
    }
    // the same world, grown again, has the same whales in it
    expect(planPods(sampler, 1)).toEqual(first);
    expect(pods(2)).not.toEqual(first);
  });

  it('only offers the pods you could actually see', () => {
    const all = pods(1);
    const near = podsWithin(all, all[0].x, all[0].z, 1);
    expect(near).toEqual([all[0]]);
    expect(podsWithin(all, all[0].x + 1e6, all[0].z, 100)).toEqual([]);
  });
});

describe('when whales breach', () => {
  const pod = { x: 0, z: 0, size: 3, favourite: 5, seed: 99 };

  it('counts hours from the world clock', () => {
    expect(hourAt(0)).toEqual({ hour: 0, into: 0 });
    expect(hourAt(HOUR_SECONDS * 3 + 4).hour).toBe(3);
    expect(hourAt(HOUR_SECONDS * 3 + 4).into).toBeCloseTo(4);
  });

  it('shows on the hour and not between hours', () => {
    expect(displayAt(pod, 0).showing).toBe(true);
    expect(displayAt(pod, WHALE.DISPLAY - 0.1).showing).toBe(true);
    expect(displayAt(pod, WHALE.DISPLAY + 0.1).showing).toBe(false);
    expect(displayAt(pod, HOUR_SECONDS - 0.1).showing).toBe(false);
    expect(displayAt(pod, HOUR_SECONDS + 0.1).showing).toBe(true);
  });

  it('leaves the water, arcs over, and comes down again', () => {
    // the first whale takes the first turn, so its arc starts with the display
    const start = whaleAt(pod, 0, 0.01);
    const top = whaleAt(pod, 0, WHALE.ARC / 2);
    const end = whaleAt(pod, 0, WHALE.ARC - 0.01);

    expect(top.y).toBeGreaterThan(start.y + 1);
    expect(top.y).toBeGreaterThan(end.y);
    expect(top.airborne).toBe(true);
    expect(start.pitch).toBeGreaterThan(0);      // nose up on the way out
    expect(end.pitch).toBeLessThan(0);           // nose down on the way back
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(1);
  });

  it('rests just under the surface when nothing is happening', () => {
    const resting = whaleAt(pod, 0, HOUR_SECONDS * 0.5);
    expect(resting.airborne).toBe(false);
    expect(resting.through).toBe(-1);
    expect(resting.y).toBeLessThan(0);
  });

  it('takes each whale over in turn rather than all at once', () => {
    const first = whaleAt(pod, 0, 0.2);
    const second = whaleAt(pod, 1, 0.2);
    expect(first.airborne).toBe(true);
    expect(second.airborne).toBe(false);
    expect(whaleAt(pod, 1, WHALE.DISPLAY / 3 + 0.4).airborne).toBe(true);
  });

  it('names the spot where one comes down, and nothing while it is still up', () => {
    expect(landingOf(pod, 0, WHALE.ARC / 2)).toBeNull();
    const splash = landingOf(pod, 0, WHALE.ARC * 0.95);
    expect(splash).not.toBeNull();
    expect(Number.isFinite(splash!.x)).toBe(true);
  });
});

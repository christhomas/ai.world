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

    // every family keeps its own mark within the hour, so two in sight do not go at once
    expect(new Set(first.map((p) => Math.round(p.at))).size).toBeGreaterThan(1);
    for (const pod of first) {
      expect(pod.at).toBeGreaterThanOrEqual(0);
      expect(pod.at).toBeLessThanOrEqual(HOUR_SECONDS - WHALE.DISPLAY);
      const here = sampler.probe(pod.x, pod.z);
      expect(here.land).toBe(false);
      expect(here.roadDist).toBeGreaterThanOrEqual(WHALE.DEEP);
      expect(pod.size).toBeGreaterThanOrEqual(WHALE.POD_MIN);
      expect(pod.size).toBeLessThanOrEqual(WHALE.POD_MAX);
    }
    for (const a of first) {
      for (const b of first) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(WHALE.APART);
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
  /** A family that starts twenty seconds into each hour. */
  const pod = { x: 0, z: 0, size: 3, favourite: 5, at: 20, seed: 99 };
  /** World seconds at a point in this pod's own display. */
  const during = (into: number) => pod.at + into;

  it('counts hours from the world clock', () => {
    expect(hourAt(0)).toEqual({ hour: 0, into: 0 });
    expect(hourAt(HOUR_SECONDS * 3 + 4).hour).toBe(3);
    expect(hourAt(HOUR_SECONDS * 3 + 4).into).toBeCloseTo(4);
  });

  it('shows once an hour, at its own mark rather than the stroke', () => {
    expect(displayAt(pod, 0).showing).toBe(false);                       // the hour itself: not yet
    expect(displayAt(pod, during(0.1)).showing).toBe(true);
    expect(displayAt(pod, during(WHALE.DISPLAY - 0.1)).showing).toBe(true);
    expect(displayAt(pod, during(WHALE.DISPLAY + 0.1)).showing).toBe(false);
    expect(displayAt(pod, HOUR_SECONDS + during(0.1)).showing).toBe(true);   // and again next hour

    // a family with a different mark is up at a different moment
    const later = { ...pod, at: 60 };
    expect(displayAt(later, during(0.1)).showing).toBe(false);
    expect(displayAt(later, 60.1).showing).toBe(true);
  });

  it('keeps a display going long enough to be worth watching', () => {
    // somebody is out of the water for most of it, rather than one jump and done
    let airborneMoments = 0;
    for (let t = 0; t < WHALE.DISPLAY; t += 0.4) {
      if ([0, 1, 2].some((i) => whaleAt(pod, i, during(t)).airborne)) airborneMoments++;
    }
    expect(WHALE.DISPLAY).toBeGreaterThan(30);
    expect(airborneMoments / (WHALE.DISPLAY / 0.4)).toBeGreaterThan(0.5);
  });

  it('leaves the water, arcs over, and comes down again', () => {
    // the first whale takes the first turn, so its arc starts with the display
    const start = whaleAt(pod, 0, during(0.01));
    const top = whaleAt(pod, 0, during(WHALE.ARC / 2));
    const end = whaleAt(pod, 0, during(WHALE.ARC - 0.01));

    expect(top.y).toBeGreaterThan(start.y + 1);
    expect(top.y).toBeGreaterThan(end.y);
    expect(top.airborne).toBe(true);
    expect(start.pitch).toBeGreaterThan(0);      // nose up on the way out
    expect(end.pitch).toBeLessThan(0);           // nose down on the way back
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(1);
  });

  it('rests just under the surface when nothing is happening', () => {
    const resting = whaleAt(pod, 0, HOUR_SECONDS * 0.8);
    expect(resting.airborne).toBe(false);
    expect(resting.through).toBe(-1);
    expect(resting.y).toBeLessThan(0);
  });

  it('takes each whale over in turn rather than all at once', () => {
    const first = whaleAt(pod, 0, during(0.2));
    const second = whaleAt(pod, 1, during(0.2));
    expect(first.airborne).toBe(true);
    expect(second.airborne).toBe(false);
    // the pod spreads itself through the cycle: the next one is up a third of it later
    expect(whaleAt(pod, 1, during(WHALE.PERIOD / 3 + 0.2)).airborne).toBe(true);
  });

  it('names the spot where one comes down, and nothing while it is still up', () => {
    expect(landingOf(pod, 0, during(WHALE.ARC / 2))).toBeNull();
    const splash = landingOf(pod, 0, during(WHALE.ARC * 0.95));
    expect(splash).not.toBeNull();
    expect(Number.isFinite(splash!.x)).toBe(true);
  });
});

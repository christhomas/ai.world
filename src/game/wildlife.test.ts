import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TileWorld } from '../entities/entity';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import type { CreatureSnap } from '../../server/protocol';
import { Wildlife } from './wildlife';

/**
 * Which creature a measurement of "is the screen lying about where things are" should stand next to.
 *
 * The played run asks that question by walking the hero up to something living and then reading the
 * close tally. It picked whatever was nearest, and the close tally counts something narrower than
 * "nearest": anything that flies is left out of it on purpose, because nobody swings at a bird and
 * a bird is drawn behind deliberately. So the run could stand under an eagle, measure nothing at
 * all, and report the empty measurement as a failure — which is what it did in the pipeline, where
 * the tally came back `0 corrections, mean 0.00, worst 0.00 ()` on two unrelated branches.
 *
 * An empty measurement is the bug this file is about. The rule for what counts lives in one place
 * and is now readable from outside, so the thing the run stands beside and the thing the run
 * measures cannot be two different animals.
 */

const flat: TileWorld = { heightAt: () => 1, waterAt: () => null, blocked: () => false, isRoad: () => false };

const snap = (id: number, kind: string, x: number, z: number): CreatureSnap => ({
  id, kind, x, z, y: 1, yaw: 0, walk: 0, state: 'idle', hp: 10,
});

const world = (): Wildlife => {
  const renderer = new EntityRenderer(new THREE.Scene());
  const manager = new EntityManager(renderer, flat, { getTiles: () => null }, 1);
  return new Wildlife(renderer, manager, null);
};

afterEach(() => { vi.useRealTimers(); });

describe('the creature a drift measurement should stand beside', () => {
  it('is not the eagle overhead, however much closer it is', () => {
    const wildlife = world();
    wildlife.apply([snap(1, 'eagle', 1, 0), snap(2, 'cow', 5, 0)], []);
    expect(wildlife.nearestCounted({ x: 0, z: 0 })?.kind).toBe('cow');
  });

  it('is nothing at all when only fliers are drawn, rather than a bird the tally ignores', () => {
    const wildlife = world();
    wildlife.apply([snap(1, 'eagle', 1, 0), snap(2, 'vulture', 2, 0)], []);
    expect(wildlife.nearestCounted({ x: 0, z: 0 })).toBeNull();
  });

  it('is nothing at all when nothing is drawn', () => {
    expect(world().nearestCounted({ x: 0, z: 0 })).toBeNull();
  });

  /*
   * The creature that is not moving, which is the one this actually went wrong on.
   *
   * The world sends a client only what changed since the last snapshot — a creature standing
   * perfectly still is not in the message at all — so a tally fed by arriving snapshots never hears
   * about it, and standing beside it all day moves nothing. A man idling in a village is therefore
   * an honest `0 corrections`, and the played run read that as a world drawing creatures wrongly.
   */
  it('is not the man standing still, whom the world has stopped mentioning', async () => {
    vi.useFakeTimers();
    const wildlife = world();
    wildlife.apply([snap(1, 'man', 2, 0), snap(2, 'cow', 5, 0)], []);
    // a second and a half in which only the cow is spoken about, which is what a walking creature
    // and a standing one look like on the wire
    vi.advanceTimersByTime(1500);
    wildlife.apply([snap(2, 'cow', 5.4, 0)], []);
    expect(wildlife.nearestCounted({ x: 0, z: 0 })?.kind).toBe('cow');
  });

  /*
   * The one that matters: standing where this says to stand has to make the tally move. A rule read
   * by two files that disagree is the fault this whole change is about, so it is asserted rather
   * than trusted — the creature it names is walked, and the close tally has to be the one that
   * noticed.
   */
  it('is a creature the close tally will actually count once you stand by it', () => {
    const wildlife = world();
    wildlife.apply([snap(1, 'eagle', 1, 0), snap(2, 'cow', 5, 0)], []);
    const stand = wildlife.nearestCounted({ x: 0, z: 0 })!;
    const hero = { x: stand.x + 3, z: stand.z + 3 };
    wildlife.apply([snap(1, 'eagle', 1.5, 0), snap(2, 'cow', 5.4, 0)], [], hero);
    const drift = wildlife.drift();
    expect(drift.wrongClose.of).toBeGreaterThan(0);
    expect(drift.wrongClose.worstIs).toBe('cow');
  });
});

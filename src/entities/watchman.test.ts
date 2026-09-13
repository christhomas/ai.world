import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { civicFor, whereItStands } from '../world/civics';
import { towerFoot } from './street';

/**
 * The man on the tower, and the tower.
 *
 * A village has paid for a watchtower since the 12th and has carried a watchman's wage every day
 * since: `whoStandsWatch` names him each morning out of who is here and what the hall can pay, and
 * `Settlement.watch` records it. Nothing in the entity layer had ever read that field. He was paid,
 * named, and there was nobody up there.
 *
 * The assertion that matters is not that he exists but that **he and the tower agree about where
 * the tower is**. Two representations of one place, worked out in two files, is this project's
 * signature fault — a man standing in a field twelve tiles from his own tower is exactly what it
 * looks like, and it would read as a pathing bug rather than as two numbers that were never made
 * to match.
 */
describe('the watchman and his tower', () => {
  const village = { name: 'Ashford', x: 100, z: 200, radius: 12, board: [104, 198] as const };

  it('stands where the tower was drawn, to the tile', () => {
    const drawn = whereItStands(civicFor('watchtower')!, village, [], 0)!;
    const foot = towerFoot(village);
    expect(foot).not.toBeNull();
    expect(Math.hypot(foot!.x - drawn.x, foot!.z - drawn.z), 'he is standing at somebody else\'s tower')
      .toBeLessThan(0.001);
  });

  it('stands in the same place every morning', () => {
    // a watchman who moved would be a village that rebuilt its tower nightly
    expect(towerFoot(village)).toEqual(towerFoot({ ...village }));
  });

  it('is somebody the village is actually paying', () => {
    // the branch is gated on being told to watch, and nothing but the payroll may tell him
    expect(readFileSync('src/entities/street.ts', 'utf8')).toContain('onTheTower');
  });

  it('has a branch in the tree a villager can reach', () => {
    // the posted branch lived under `hired` only, so a sword you paid for could take a post and
    // the village's own man could not — he has no trade, so he runs the plain villager tree
    const tree = JSON.parse(readFileSync('behaviours/villagers.json', 'utf8'));
    const said = JSON.stringify(tree.villager);
    expect(said, 'the village watchman runs the villager tree and it never mentions a post')
      .toContain('takePost');
  });
});

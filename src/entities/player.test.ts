import { describe, expect, it } from 'vitest';
import { Player } from './player';
import type { Input } from '../core/input';
import type { IsoCamera } from '../render/camera';
import type { EntityRenderer } from './pool';
import type { TileWorld } from '../world/tiles';

/**
 * The hero, walked by something other than a pair of hands.
 *
 * This is the half of the vocabulary work that makes an automated game possible. Everything a
 * villager does is a decision made by a tree; everything the hero does is the same decision made by
 * a person — and until `autopilot` there was nowhere for anything but a keyboard to reach him. A
 * playtest could only hold keys down and hope, which measures the keyboard as much as it measures
 * the game and cannot say "walk to the village" at all.
 *
 * What is pinned here is the contract a script depends on: he sets off, he arrives, he stops
 * himself, and a person who touches the keys takes him back without argument.
 */

/** Flat, empty, endless ground: nothing here is about terrain. */
const field = (): TileWorld => ({
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
});

/** The same field with a river across it, which is what stopped the first hero ever sent anywhere. */
const riverbank = (at: number): TileWorld => ({
  ...field(),
  heightAt: (x: number) => (x >= at ? null : 0),
  waterAt: (x: number) => (x >= at ? 0 : null),
});

/** A keyboard with nothing held down, unless a test says otherwise. */
const hands = (...held: string[]): Input =>
  ({ isDown: (...keys: string[]) => keys.some((k) => held.includes(k)) }) as unknown as Input;

/** A view looking down the axes, so a steer of (1,0) walks east and stays readable. */
const view = (): IsoCamera =>
  ({ target: { x: 0, y: 0, z: 0 }, basis: () => ({ fx: 1, fz: 0, rx: 0, rz: 1 }) }) as unknown as IsoCamera;

/** A hero standing at the origin on some ground, open country unless a test says otherwise. */
function hero(world: TileWorld = field()) {
  const player = new Player(world, { add: () => {} } as unknown as EntityRenderer, 0, 0);
  const iso = view();
  const walk = (seconds: number, input: Input = hands()) => {
    // a tenth of a second a step, which is the order a real frame is and keeps `stride` honest
    for (let t = 0; t < seconds; t += 0.1) player.update(input, iso, 0.1);
  };
  return { player, walk };
}

describe('a hero driven by something other than the keyboard', () => {
  it('sets off towards where he was sent', () => {
    const { player, walk } = hero();
    player.walkTo(40, 0);
    walk(1);
    expect(player.x, 'told to walk east and did not move').toBeGreaterThan(0.5);
    expect(Math.abs(player.z), 'wandered off the line he was sent down').toBeLessThan(0.5);
  });

  it('arrives, and stops himself when he does', () => {
    const { player, walk } = hero();
    player.walkTo(12, 0);
    walk(30);
    expect(Math.hypot(player.x - 12, player.z)).toBeLessThanOrEqual(Player.ARRIVED);
    expect(player.steering, 'still steering after arriving, which is how a hero ends up pressed into a wall for ever').toBe(false);
  });

  it('stays where he stopped rather than creeping past the place', () => {
    const { player, walk } = hero();
    player.walkTo(12, 0);
    walk(30);
    const arrived = { x: player.x, z: player.z };
    walk(5);
    expect(player.x).toBeCloseTo(arrived.x, 6);
    expect(player.z).toBeCloseTo(arrived.z, 6);
  });

  it('gives way the moment a person touches the keys', () => {
    /*
     * Input wins outright. A hero who argued with the keyboard for even a frame would be
     * unplayable, so the autopilot is only consulted when nothing at all is held down — and it is
     * still waiting afterwards, because a player nudging a key has not cancelled anything.
     */
    const { player, walk } = hero();
    player.walkTo(0, 40);                       // sent north
    walk(1, hands('w'));                        // person walks him east instead
    expect(player.x, 'the keyboard was overruled by the autopilot').toBeGreaterThan(0.5);
    expect(player.steering, 'a nudge of a key threw away where he had been sent').toBe(true);
  });

  it('can be told to stand still, and does', () => {
    const { player, walk } = hero();
    player.walkTo(40, 0);
    walk(0.5);
    const stopped = player.x;
    player.walkTo();
    walk(2);
    expect(player.steering).toBe(false);
    expect(player.x).toBeCloseTo(stopped, 6);
  });

  it('is not steering until somebody steers him', () => {
    const { player } = hero();
    expect(player.steering).toBe(false);
  });

  it('gives up on somewhere he cannot get to, rather than leaning on it for ever', () => {
    /*
     * Found by walking one. Sent twenty tiles east across a real world he went four, met a river,
     * and pushed at the bank for as long as anybody watched — which is exactly what a player
     * holding W would get, and is right for a player. A script is not watching: a driver that can
     * push at a riverbank for ever is a test that hangs instead of one that fails.
     */
    const { player, walk } = hero(riverbank(5));
    player.walkTo(40, 0);
    walk(1);
    expect(player.x, 'walked into the river').toBeLessThan(5);
    expect(player.x, 'never set off at all').toBeGreaterThan(1);
    walk(Player.GIVES_UP + 1);
    expect(player.steering, 'still shoving at the far bank').toBe(false);
  });

  it('keeps going while he is still getting nearer, however slowly', () => {
    // squeezing between a house and a fence is progress, and a driver that timed it out would
    // abandon every walk that had anything at all in the way of it
    const { player, walk } = hero();
    player.walkTo(400, 0);
    walk(Player.GIVES_UP * 3);
    expect(player.steering, 'gave up on a walk that was going perfectly well').toBe(true);
    expect(player.x).toBeGreaterThan(5);
  });
});

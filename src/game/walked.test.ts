import { describe, expect, it } from 'vitest';
import type { TileWorld } from '../entities/entity';
import { newHero } from '../entities/stride';
import { Walked } from './walked';

/**
 * The client's half of a hero the server owns.
 *
 * What is being pinned here is the thing a player would notice if it were wrong: that agreeing
 * costs nothing, and that disagreeing moves the hero once rather than for ever. A reconciler that
 * corrects when both halves already agree is a hero who shivers on the spot, and it is the kind of
 * bug that only shows up on somebody else's connection.
 */

/** Flat, empty ground: nothing here is about collision. */
const field: TileWorld = {
  heightAt: () => 0,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

/** A wall down the line x = 2: the far side is not somewhere anybody can stand. */
const walled: TileWorld = { ...field, heightAt: (x) => (x >= 2 ? 40 : 0) };

const east = { dx: 1, dz: 0, pace: 1, dt: 1 / 60 };

describe('walking a hero the world owns', () => {
  it('gathers frames into steers rather than sending one a frame', () => {
    const sent: Array<{ seq: number; dt: number }> = [];
    const walked = new Walked((s) => sent.push({ seq: s.seq, dt: s.dt }));
    // half a second of walking east, a frame at a time
    for (let i = 0; i < 30; i++) walked.walked(east);
    expect(sent.length).toBeGreaterThan(6);
    expect(sent.length).toBeLessThan(20);
    expect(sent.map((s) => s.seq)).toEqual(sent.map((_, i) => i + 1));
    // and nothing is lost in the gathering: what was sent adds up to what was walked
    const total = sent.reduce((n, s) => n + s.dt, 0);
    expect(total).toBeGreaterThan(30 / 60 - 0.034);
  });

  it('closes a batch the moment the hero turns, so no steer has two directions in it', () => {
    const sent: Array<{ dx: number; dz: number }> = [];
    const walked = new Walked((s) => sent.push({ dx: s.dx, dz: s.dz }));
    walked.walked(east);
    walked.walked({ dx: 0, dz: 1, pace: 1, dt: 1 / 60 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ dx: 1, dz: 0 });
  });

  it('says nothing about a hero standing still', () => {
    const sent: unknown[] = [];
    const walked = new Walked((s) => sent.push(s));
    for (let i = 0; i < 30; i++) walked.walked(null);
    expect(sent).toEqual([]);
  });

  it('leaves the hero exactly where he is when the world agrees', () => {
    const sent: Array<{ seq: number }> = [];
    const walked = new Walked((s) => sent.push(s));
    const hero = newHero(0, 0);
    for (let i = 0; i < 30; i++) { walked.walked(east); hero.x += east.dt * hero.kind.speed; }
    // the world has run every steer, and it walked him the same way we did
    const last = sent[sent.length - 1].seq;
    const out = walked.toldWhereHeIs(hero, field, last, hero.x, hero.z);
    expect(out).toBe(0);
    expect(hero.x).toBeCloseTo(30 * east.dt * hero.kind.speed, 5);
  });

  it('walks the steers the world has not seen yet back on top of its answer', () => {
    const sent: Array<{ seq: number; dt: number }> = [];
    const walked = new Walked((s) => sent.push(s));
    const hero = newHero(0, 0);
    for (let i = 0; i < 30; i++) { walked.walked(east); hero.x += east.dt * hero.kind.speed; }
    // an answer to the first steer only: everything after it is still in flight
    const first = sent[0];
    walked.toldWhereHeIs(hero, field, first.seq, first.dt * hero.kind.speed, 0);
    // which comes to the same place, because the replay is the same arithmetic
    expect(hero.x).toBeCloseTo(30 * east.dt * hero.kind.speed, 1);
  });

  it('leans a small disagreement off over a few frames rather than jumping', () => {
    const walked = new Walked(() => {});
    const hero = newHero(4, 0);
    // nothing in flight, and the world says he is a third of a tile further on
    const out = walked.toldWhereHeIs(hero, field, 1, 4.3, 0);
    expect(out).toBeCloseTo(0.3, 5);
    expect(hero.x, 'not moved yet: the correction is walked off, not applied').toBe(4);
    for (let i = 0; i < 30; i++) walked.settle(hero, 1 / 60);
    expect(hero.x).toBeCloseTo(4.3, 2);
  });

  it('moves the hero at once when the world says he is somewhere else entirely', () => {
    const walked = new Walked(() => {});
    const hero = newHero(0, 0);
    const out = walked.toldWhereHeIs(hero, field, 1, 30, 12);
    expect(out).toBeGreaterThan(30);
    expect(hero.x).toBe(30);
    expect(hero.z).toBe(12);
  });

  it('replays against its own ground, so a wall it can see is a wall it stops at', () => {
    const sent: Array<{ seq: number; dt: number }> = [];
    const walked = new Walked((s) => sent.push(s));
    const hero = newHero(0, 0);
    // a second of walking east, all of it still in flight
    for (let i = 0; i < 60; i++) walked.walked(east);
    hero.x = 1.9;
    walked.toldWhereHeIs(hero, walled, 0, 0, 0);
    expect(hero.x, 'the replay walked into the wall and stopped').toBeLessThan(2);
  });

  it('forgets what was in flight when the hero stops being the world\'s to walk', () => {
    const sent: Array<{ seq: number }> = [];
    const walked = new Walked((s) => sent.push(s));
    const hero = newHero(0, 0);
    for (let i = 0; i < 30; i++) walked.walked(east);
    walked.reset();
    // an answer to a steer from before the reset moves him there and replays nothing
    walked.toldWhereHeIs(hero, field, 1, 9, 0);
    expect(hero.x).toBe(9);
  });
});

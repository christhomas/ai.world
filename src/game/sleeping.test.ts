import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The bed, which is the only clean way out of this world.
 *
 * #262 has to put a hero back where he was when the tab was closed. Everywhere but a bed that is a
 * spot in a field, and a spot in a field is not a place anything can be said about; in a bed it is.
 * So the one place the game offers to stop playing is the one place stopping is tidy, and the flag
 * that says so is written when the bed is taken rather than when somebody presses leave — because
 * on a phone nobody presses leave. They swipe the app away.
 */
const MEETING = readFileSync(new URL('./meeting.ts', import.meta.url), 'utf8');
const COUNTER = readFileSync(new URL('./counter.ts', import.meta.url), 'utf8');

describe('a bed is a place a body can be left', () => {
  it('writes the flag when the bed is taken, not when somebody presses leave', () => {
    const take = MEETING.slice(MEETING.indexOf('take: () => {'), MEETING.indexOf('leave: toTitle'));
    expect(take, 'lodged has to be true before anything can go wrong').toContain('state.lodged = true');
    expect(take.indexOf('state.lodged = true'), 'and before the save that records it')
      .toBeLessThan(take.indexOf('persist()'));
  });

  it('offers to leave the world from the bed and nowhere else', () => {
    // `leave` is the only door out of `Room`, and `Room` is only handed to an innkeeper
    expect(MEETING).toContain('leave: toTitle');
    expect(COUNTER).toContain("s.ctx.room!.leave()");
  });

  it('counts down to waking up rather than to leaving', () => {
    /*
     * The whole of why this menu is safe. A count that ended in *leave the world* would quit the
     * game for somebody who was reading the menu; a count that ends in *up and out* costs them
     * nothing at all, and they can take the bed again.
     */
    const menu = COUNTER.slice(COUNTER.indexOf('function slept('));
    const expires = menu.slice(menu.indexOf('node.expires ='), menu.indexOf('return node;'));
    expect(expires).toContain('up and out');
    expect(expires, 'the count must not be able to quit the game').not.toContain('leave');
  });

  it('says out loud that it is counting', () => {
    // a menu that acts on its own without having said it was going to is a menu that acted on you
    expect(COUNTER).toContain("label: 'up and out in %ss'");
  });
});

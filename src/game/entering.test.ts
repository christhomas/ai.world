import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Enterings, type BackOut } from './entering';

/**
 * A door the page walked the hero through before the world had agreed to it.
 *
 * `predicted.ts` settles a door as `hand` and says why: *walking into a room that turns out to be
 * somewhere else is jarring and recoverable, and a door that waits makes every building in the
 * country feel stuck.* The page has always done the first half — `places.enterBuilding` draws the
 * room, moves the hero onto its floor and frames the camera, on the spot. What it never had was
 * anything that could contradict it.
 *
 * And the world did disagree, silently. `putThere` in `server/messages.ts` compares the door
 * claimed against the hero it has been walking, and when the two do not agree it quietly keeps its
 * *own* position as the doorway. Nothing was ever sent back, so the page found out minutes later,
 * on the way out: the hero came through the door he went in by and was hauled across the county to
 * the one the world had. A correction the player meets on the far side of a shop visit is the
 * thing prediction is supposed to prevent.
 *
 * ## What is kept, and why it is the step rather than the fact of being indoors
 *
 * `claims.ts`: *what was given is kept, not recomputed.* The undo here is "step back out onto the
 * step", and which step that is cannot be worked out when the answer arrives — by then the hero
 * may be standing in a different building. Two doors along a street is a second or two of walking
 * and a round trip is less, so this is ordinary rather than exotic. So the doorstep goes into the
 * claim and the undo refuses to fire unless the hero is still standing in that room.
 */

/** A hero indoors, and the way back out, counted. */
function inside(at: { x: number; z: number } | null) {
  let room = at;
  const out: Array<{ x: number; z: number }> = [];
  const said: string[] = [];
  const back: BackOut = {
    step: () => room,
    out: () => { if (room) out.push(room); room = null; },
    flash: (line) => said.push(line),
  };
  return { back, out, said, walkOutOf: () => { room = null; }, walkInto: (to: { x: number; z: number }) => { room = to; } };
}

const DOOR = { x: 12, z: -40 };
const NEXT_DOOR = { x: 19, z: -40 };

describe('a door the world was asked about', () => {
  it('keeps the step until an answer names it', () => {
    const doors = new Enterings();
    doors.ask(DOOR);
    expect(doors.pending, 'one answer owed').toBe(1);
  });

  it('costs nothing at all when the world agrees, which is the case that happens', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    const seq = doors.ask(DOOR);
    doors.answered(seq, true, hero.back);
    expect(hero.out, 'a door the world believed leaves the hero where he is').toEqual([]);
    expect(doors.pending, 'and the claim is forgotten rather than left standing').toBe(0);
  });

  it('steps him back out onto the step when the world refuses it', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    doors.answered(doors.ask(DOOR), false, hero.back);
    expect(hero.out, 'out of the room he was never in').toEqual([DOOR]);
    expect(hero.said, 'and told, because a hero who leaves a shop on his own deserves a reason').toHaveLength(1);
  });

  it('does nothing when he has already walked back out by himself', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    const seq = doors.ask(DOOR);
    hero.walkOutOf();
    doors.answered(seq, false, hero.back);
    expect(hero.out, 'there is nothing to undo: he is on the step already').toEqual([]);
    expect(hero.said, 'and nothing to say about it').toEqual([]);
  });

  /*
   * The replay half, in the form a door has one.
   *
   * Walking replays the steers newer than the answer rather than throwing them away, and this is
   * the same question: a refusal names one door, and anything the hero has done since must stand.
   * A correction that simply put him outdoors would throw him out of a shop he is legitimately
   * standing in, which is a worse lie than the one it was correcting.
   */
  it('does not throw him out of the next shop he walked into', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    const first = doors.ask(DOOR);
    hero.walkOutOf();
    const second = doors.ask(NEXT_DOOR);
    hero.walkInto(NEXT_DOOR);
    doors.answered(first, false, hero.back);
    expect(hero.out, 'the second door is not the refused one').toEqual([]);
    // and the second is still owed an answer, so the world can still refuse that one on its merits
    expect(doors.pending).toBe(1);
    doors.answered(second, false, hero.back);
    expect(hero.out).toEqual([NEXT_DOOR]);
  });

  it('puts him out once, however many answers arrive', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    const seq = doors.ask(DOOR);
    doors.answered(seq, false, hero.back);
    hero.walkInto(DOOR);                      // he walks back in, as anybody would
    doors.answered(seq, false, hero.back);
    expect(hero.out, 'the second answer is to a claim that was already settled').toEqual([DOOR]);
  });

  it('ignores an answer to a number it never handed out', () => {
    const doors = new Enterings();
    const hero = inside(DOOR);
    doors.answered(9_999, false, hero.back);
    expect(hero.out).toEqual([]);
  });

  /*
   * And that any of it is reached at all.
   *
   * `createMultiplayer` wants a document, a camera and a renderer, so there is no unit that can
   * call it — which is exactly the shape of fault `reachable.test.ts` was written for, and the
   * reason `blows.test.ts` reads `frame.ts` rather than asserting about it. This reads the one
   * call site a door travels on. A claim asked and never answered, or answered with something that
   * is not the way out, is a whole feature with a guard on it and nothing behind it.
   */
  it('is wired to the one message a door travels on', () => {
    const source = readFileSync(new URL('./multiplayer.ts', import.meta.url), 'utf8');
    const at = source.indexOf('online.stood(');
    expect(at, 'nothing tells the world he went through a door at all').toBeGreaterThan(-1);
    expect(source.indexOf('online.stood(', at + 1), 'one call site, or this checks the wrong one').toBe(-1);
    const call = source.slice(at, source.indexOf('online.update(', at));
    expect(call, 'a door goes out unnumbered, so nothing can answer it').toContain('doors.ask(');
    const answer = /onStepped:[\s\S]*?\}\),/.exec(source)?.[0] ?? '';
    expect(answer, 'nothing answers a door').toContain('doors.answered(');
    expect(answer, 'the undo is not stepping back out onto the step').toContain('leaveBuilding()');
  });
});

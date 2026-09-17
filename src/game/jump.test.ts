import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Where a teleport puts somebody, which used to be "nowhere" twice over.
 *
 * Two faults with one shape: the jump knew something was wrong and refused instead of dealing with
 * it. Indoors it refused rather than walking out of the door; on a tile with a tree on it it landed
 * anyway and left the collider to shove the hero out sideways a frame at a time.
 *
 * Read from the source, because what is being held is the *decision* — the machinery it decides
 * with (`spaceNear`, `leaveBuilding`, `exitDungeon`) is tested where it lives.
 */
const CONSOLE = readFileSync(new URL('./console.ts', import.meta.url), 'utf8');
const PLAYER = readFileSync(new URL('../entities/player.ts', import.meta.url), 'utf8');

/** The body of `jumpTo`, which is the whole subject. */
const jumpTo = (): string => {
  const at = CONSOLE.indexOf('const jumpTo = ');
  expect(at, 'jumpTo has moved or gone').toBeGreaterThan(0);
  return CONSOLE.slice(at, CONSOLE.indexOf('\n  };', at));
};

describe('a jump asked for from indoors', () => {
  it('walks out of the door rather than refusing', () => {
    const body = jumpTo();
    expect(body).toContain('places.leaveBuilding()');
    expect(body).toContain('places.exitDungeon()');
    expect(body, 'the old refusal is gone').not.toContain('climb out first');
  });

  it('asks the interior first, so a move across a room is not an exit', () => {
    // a point that is in here is a move across this room, and leaving would be absurd
    expect(jumpTo()).toContain("here !== 'surface' && !player.groundNear(x, z)");
  });
});

describe('a jump lands somewhere a hero can stand', () => {
  it('takes the spot the ring found rather than the one it was asked for', () => {
    const body = jumpTo();
    expect(body).toContain('player.roomAt(x, z)');
    expect(body).toMatch(/player\.teleport\(onto\.x, onto\.z\)/);
    expect(body, 'and the camera follows it there').toMatch(/iso\.target\.set\(onto\.x/);
  });

  it('hands back what the search found instead of a boolean', () => {
    /*
     * `groundNear` ran this exact search and threw the answer away. The ring has known where the
     * nearest clear tile is the whole time.
     */
    expect(PLAYER).toContain('roomAt(x: number, z: number): { x: number; z: number } | null');
    expect(PLAYER).toMatch(/groundNear[\s\S]{0,120}this\.roomAt\(x, z\) !== null/);
  });

  it('still refuses nothing out of doors, because unstreamed ground is not missing ground', () => {
    /*
     * The limit that must survive. Out of doors, ground that has not arrived reads exactly like
     * ground that does not exist, so a jump across the county before the county is built finds
     * nothing and is perfectly good — the surface settles a hero when the ground turns up. Indoors
     * the floor is made before you are in it, so nothing found there means nothing there.
     */
    const body = jumpTo();
    expect(body).toMatch(/if \(!room && placeName\(\) !== 'surface'\)/);
  });
});

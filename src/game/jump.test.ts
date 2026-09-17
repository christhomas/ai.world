import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { openConsole, type Consoled } from './console';

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

/**
 * Enough of a world to take a teleport, and nothing else.
 *
 * A jump out of doors onto clear ground touches six things — the hero, the camera, the light, the
 * chat, the world's copy of him and where he is standing — so those six are the ones that are real
 * here and the rest of `Consoled` is never reached. The point is to watch the beam rather than to
 * read the source that calls it.
 */
const aWorld = () => {
  const beam = { leaves: vi.fn(), arrives: vi.fn() };
  const player = {
    x: 0, z: 0,
    entity: {},
    groundNear: vi.fn(() => true),
    roomAt: vi.fn((x: number, z: number) => ({ x, z })),
    teleport: vi.fn(),
    lookHere: vi.fn(),
  };
  const iso = { target: { set: vi.fn() } };
  const chat = { dismiss: vi.fn(), line: vi.fn() };
  const online = { stood: vi.fn() };
  const ctx = {
    player, iso, chat, online, beam,
    placeName: () => 'surface',
    areaLabel: () => 'nowhere in particular',
  } as unknown as Consoled;
  return { world: openConsole(ctx).commandWorld, beam, player, iso, chat, online };
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
    // both paths move him to what the ring found, watched or not; they differ only in the picture
    expect(body).toContain('player.teleport(onto.x, onto.z)');
    expect(body).toContain('player.teleport(onto.x, onto.z, false)');
    expect(body, 'and the camera follows it there').toContain('iso.target.set(onto.x, 0.5, onto.z)');
  });

  it('hands back what the search found instead of a boolean', () => {
    /*
     * `groundNear` ran this exact search and threw the answer away. The ring has known where the
     * nearest clear tile is the whole time.
     */
    expect(PLAYER).toContain('roomAt(x: number, z: number): { x: number; z: number } | null');
    expect(PLAYER).toMatch(/groundNear[\s\S]{0,120}this\.roomAt\(x, z\) !== null/);
  });

  it('plays no beam at all for a jump nobody is watching', () => {
    /*
     * `warpTo` said "the same jump with no picture" and played the picture anyway: only the camera
     * was held back, so a probe's teleport still ran the full ten seconds with the hero fully apart
     * — and therefore not drawn — for the first six. The playtest missed it because it waits five
     * seconds and then asks where he is rather than whether he can be seen. `chore shots` caught it
     * by photographing a column of light with an invisible man in it.
     *
     * Driven rather than read, because the fault was never a word in a file: a helper called from
     * the quick path would reach the beam without the source of `jumpTo` ever saying `beam.`.
     */
    const { world, beam, player, iso, online } = aWorld();
    world.warpTo(46, 84);

    expect(beam.leaves, 'nothing leaves').not.toHaveBeenCalled();
    expect(beam.arrives, 'and nothing arrives').not.toHaveBeenCalled();
    // and it is a jump all the same: he is moved, the camera is with him, the world is told
    expect(player.teleport).toHaveBeenCalledWith(46, 84);
    expect(iso.target.set).toHaveBeenCalledWith(46, 0.5, 84);
    expect(online.stood).toHaveBeenCalledWith(46, 84, 'teleport');
  });

  it('plays the whole passage for a jump somebody is watching', () => {
    /*
     * The other half of the same rule, and the reason the one above cannot be satisfied by a beam
     * that has simply stopped working: the watched teleport is still a passage with a light in it.
     */
    const { world, beam, chat } = aWorld();
    world.teleport(46, 84);

    expect(chat.dismiss, 'the console gets out of the way').toHaveBeenCalled();
    expect(beam.leaves).toHaveBeenCalled();
    expect(beam.arrives).toHaveBeenCalled();
  });

  it('tells the world where he landed, not where he was sent', () => {
    /*
     * The two are not the same whenever the asked-for tile had a tree on it or had not streamed in
     * yet, and telling the world the request left the page holding him at one and the world holding
     * him at the other — with the next `youAre` dragging him to the world's copy. #329: a jump into
     * a village square landing in the field beside it, differently on every cold page.
     */
    expect(jumpTo(), 'the jump has to hand its answer back').toContain('return onto;');
    expect(CONSOLE).toContain('const landed = jumpTo(x, z, true);');
    expect(CONSOLE).toContain('const landed = jumpTo(found.x, found.z, true);');
    expect(CONSOLE, 'the request is no longer what is reported')
      .not.toContain("online.stood(x, z, 'teleport')");
    expect(CONSOLE, 'both teleports report the landing')
      .toContain("online.stood(landed.x, landed.z, 'teleport')");
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

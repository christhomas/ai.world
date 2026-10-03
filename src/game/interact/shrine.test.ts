import { describe, expect, it, vi } from 'vitest';
import { aroundOf } from '../../world/around';
import { samplerIn } from '../../world/endless';
import { Manifest } from '../../world/manifest';
import { boundsOf, patchOf } from '../../world/patchwork';
import { StructureKind } from '../../world/structures';
import type { DialogueNode } from '../../ui/dialogue';
import type { Surroundings } from './context';
import { wildInteractions } from './wild';

/**
 * A shrine the prayer can be made at, in a country somebody actually grew.
 *
 * #444's own tests handed the prayer a shrine made up for the purpose, which is how it shipped with
 * nowhere to be said: the prayer asks for a world of your own, which is an endless one, and an
 * endless country had no shrine in it at all (#491). So this grows the patch a fresh hero stands
 * in, walks to a shrine the generator put there, and presses Enter.
 *
 * The seed was found by scanning for one whose first patch holds a shrine, not chosen.
 */
const SEED = 3;

describe('a shrine in a world of your own', () => {
  it('stands in the endless country, and offers the prayer there', () => {
    const sampler = samplerIn(SEED, boundsOf(patchOf(0, 0)));
    const structures = sampler.structures;
    // the precondition the prayer asks for, and the thing #491 found missing
    expect(sampler.within).not.toBeNull();
    const shrine = structures.pois.find((p) => p.kind === StructureKind.Shrine);
    expect(shrine).toBeDefined();

    let dialogue: DialogueNode | null = null;
    const ctx = {
      player: { x: shrine!.x, z: shrine!.z },
      state: { day: 10, prayers: [], inventory: { gold: 0 } },
      structures, sampler, manifest: new Manifest(SEED), around: aroundOf(structures),
      register: { living: () => [{}] },
      online: { connected: true, away: false },
      dialogue: { start: (node: DialogueNode) => { dialogue = node; } },
      hud: { flash: vi.fn() }, sound: { chime: vi.fn() },
      persist: vi.fn(), persistStrict: vi.fn(async () => {}),
      prayerHost: { randomSeed: () => 123, restart: vi.fn(), isLive: () => true },
    } as unknown as Surroundings;
    const wild = wildInteractions(ctx);

    expect(wild.tryShrine(true)).toBe(true);
    expect(wild.tryShrine()).toBe(true);
    const ask = (dialogue as DialogueNode | null)?.choices?.find((c) => c.label === 'Ask the stones to raise high ground');
    expect(ask).toBeDefined();
    const sites = ask!.next();
    expect(sites?.pages.join(' ')).not.toContain('world of your own');
    expect(sites?.choices?.map((c) => c.label)).toContain(`${shrine!.name} north heights`);
  });
});

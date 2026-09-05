import { describe, expect, it } from 'vitest';
import type { SessionSave, WorldKind } from '../save/store';

/**
 * The world type decides the whole terrain: the same seed grows two completely different
 * countries. So it has to be chosen when a world is made and honoured for ever afterwards —
 * reopening one as the other kind would put the ground somewhere else underneath a house, a
 * planted field, and every dungeon and island anchor the manifest is holding.
 *
 * Before this was recorded, every world made with `?world=mesh` came back as a road world.
 */

/** What the title screen does when a slot is taken: the save's own kind, whatever else is asked for. */
function continuing(save: SessionSave): WorldKind {
  return save.world ?? 'road';
}

describe('which world a save is in', () => {
  it('is whatever the save says, so the ground never moves under a hero', () => {
    expect(continuing({ seed: 1, world: 'mesh' } as SessionSave)).toBe('mesh');
    expect(continuing({ seed: 1, world: 'road' } as SessionSave)).toBe('road');
  });

  it('is the flat one for a save made before the choice existed', () => {
    // every world that already exists was grown by the road tree, whatever anybody picks today
    expect(continuing({ seed: 1 } as SessionSave)).toBe('road');
  });
});

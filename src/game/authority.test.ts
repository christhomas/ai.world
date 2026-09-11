import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EntityManager } from '../entities/manager';
import { EntityRenderer } from '../entities/pool';
import type { TileWorld } from '../entities/entity';
import { Wildlife } from './wildlife';
import { GameState } from './state';
import { createAuthority, type Authority } from './authority';
import type { CreatureSnap } from '../../server/protocol';

/**
 * What the client does when the world says one of its creatures is dead.
 *
 * Reported by somebody playing on a server: "when you kill animals, they don't drop anything like
 * skin or meat". Everything about a kill looked right in the code a single player runs, because
 * that is the half that was written first — and in a shared world none of it runs. The world owns
 * every animal out of doors, resolves the blow itself, and says only that the creature died. What
 * each player's game makes of that is this file, and it was making less of it than the local path:
 *
 *   - the loot was handed over twice, because `spoils` both worked it out and paid it, and this
 *     side paid it again. A cow was two pieces of meat online and one alone.
 *   - no body was left at all. A hide is not in the loot any more — it stays on the carcass until
 *     somebody kneels with a knife — so a world-resolved kill left nothing to skin and nothing in
 *     the pack. Hunting in a shared world could not be done.
 *
 * Both are about the seam rather than about combat, which is why the test is here: everything it
 * asserts is what one side of a conversation does with a sentence from the other.
 */

const flat: TileWorld = { heightAt: () => 1, waterAt: () => null, blocked: () => false, isRoad: () => false };

/** The client, as much of it as a `killed` message actually touches. */
function aClient() {
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene);
  const manager = new EntityManager(renderer, flat, { getTiles: () => null }, 1);
  const wildlife = new Wildlife(renderer, manager, null);
  const state = new GameState();
  const bodies: Array<{ kind: string; x: number; z: number }> = [];
  const buried: string[] = [];

  const ctx = {
    seed: 1, state, wildlife, entities: manager,
    player: { entity: { x: 0, z: 0 }, riding: false } as unknown as Authority['player'],
    chunks: {} as unknown as Authority['chunks'],
    places: { indoors: null, underground: false } as unknown as Authority['places'],
    sailing: { sailing: false } as unknown as Authority['sailing'],
    sound: { chime: () => {} } as unknown as Authority['sound'],
    floorLife: () => null,
    aloft: () => false,
    placeName: () => 'surface',
    steer: () => {},
    bitten: () => {},
    arrested: () => {},
    fallen: (who: { name: string }) => { buried.push(who.name); },
    fell: (kind: string, x: number, z: number) => { bodies.push({ kind, x, z }); },
  } as unknown as Authority;

  const authority = createAuthority(ctx);
  /** The world telling us what lives here, and then that one of them is dead. */
  const worldSays = authority.heeding;
  return { authority, worldSays, state, wildlife, bodies, buried };
}

/** One creature of the world's, standing where it can be killed. */
const wolf = (id = 7, kind = 'wolf'): CreatureSnap =>
  ({ id, kind, x: 12, z: 34, y: 1, yaw: 0, walk: 0, state: 'idle', hp: 30 });

describe('a creature the world killed for us', () => {
  it('leaves a body where it fell, so there is something to take a hide off', () => {
    /*
     * The fault the report was about. A wolf's pelt is deliberately not in the loot — it comes off
     * the body with a knife, which is what makes the knife worth carrying — so if nothing tells the
     * carcass list, a wolf killed in a shared world is worth precisely nothing to anybody.
     */
    const { worldSays, bodies } = aClient();
    worldSays.onCreatures('surface', [wolf()], []);
    worldSays.onCreatureKilled('surface', 7, true);
    expect(bodies, 'the world killed a wolf and left no body').toEqual([{ kind: 'wolf', x: 12, z: 34 }]);
  });

  it('leaves one whether or not we landed the blow', () => {
    // a carcass is a thing lying in the grass rather than a reward: somebody else's kill is still
    // a body, and walking past it with a knife is the same act
    const { worldSays, bodies } = aClient();
    worldSays.onCreatures('surface', [wolf()], []);
    worldSays.onCreatureKilled('surface', 7, false);
    expect(bodies.length).toBe(1);
  });

  it('pays the loot exactly once', () => {
    /*
     * A cow's meat is a certainty — `chance: 1` in `properties/beasts.json` — so one cow is one
     * piece of meat. It was two: `spoils` put it in the rucksack itself and this side, holding the
     * same list, put it in again.
     */
    const { worldSays, state } = aClient();
    worldSays.onCreatures('surface', [{ ...wolf(4, 'cow'), hp: 60 }], []);
    worldSays.onCreatureKilled('surface', 4, true);
    expect(state.count('meat'), 'one cow, two pieces of meat').toBe(1);
  });

  it('gives nothing at all to somebody who did not kill it', () => {
    const { worldSays, state } = aClient();
    worldSays.onCreatures('surface', [{ ...wolf(4, 'cow'), hp: 60 }], []);
    worldSays.onCreatureKilled('surface', 4, false);
    expect(state.count('meat')).toBe(0);
  });

  it('takes the creature off the screen either way', () => {
    const { worldSays, wildlife } = aClient();
    worldSays.onCreatures('surface', [wolf()], []);
    expect(wildlife.count).toBe(1);
    worldSays.onCreatureKilled('surface', 7, true);
    expect(wildlife.count, 'the body is still being drawn walking about').toBe(0);
  });

  it('says nothing about a creature on a floor nobody is standing on', () => {
    // a mine's crew and a dungeon's monsters are somebody else's flock; a message about a place we
    // are not in is not ours to act on
    const { worldSays, bodies } = aClient();
    worldSays.onCreatures('surface', [wolf()], []);
    worldSays.onCreatureKilled('mine:deep', 7, true);
    expect(bodies).toEqual([]);
  });
});

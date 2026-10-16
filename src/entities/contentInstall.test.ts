import { afterEach, describe, expect, it } from 'vitest';
import { ContentError, inventory, type ContentRecord } from '../core/content';
import { DEFAULT_CONTENT } from '../core/contentDefaults';
import { installContent } from './contentInstall';
import { KINDS } from './animals';
import { MODELS } from './models';
import { BEHAVIOUR, PERSON_KINDS, PROPERTIES, STEP_LIMIT } from './properties';
import { FLINCH_LASTS } from './motion';
import { SPAWN, SPAWN_RADIUS } from './spawning';
import { DEEP_ANIMALS, DUNGEON_MONSTERS } from './spawns';
import { allTrees } from './behaviours';

const defaults = inventory(DEFAULT_CONTENT);
const bundled = JSON.stringify(DEFAULT_CONTENT);
const bodyOf = <T>(id: string): T => structuredClone(defaults.find((record) => record.id === id)!.body) as T;
const edited = (changes: Record<string, unknown>): ContentRecord[] => {
  for (const id of Object.keys(changes)) expect(defaults.some((record) => record.id === id), id).toBe(true);
  return defaults.map((record) => record.id in changes ? { ...record, body: changes[record.id] } : record);
};

describe('installing a content revision into the running game', () => {
  // Workers are shared between test files here, so whatever this file installs it puts back.
  afterEach(() => installContent(defaults));

  it('changes the tables the game already holds, in place, and leaves the bundled JSON alone', () => {
    const wolf = bodyOf<{ speed: number; hp: number }>('creature:wolf');
    const reach = bodyOf<{ SPAWN_RADIUS: number }>('spawning:reach');
    const herds = bodyOf<{ HERD_CHANCE: number }>('spawning:herds');
    const deep = bodyOf<{ kinds: Record<string, number> }>('spawning:deep');
    const dungeon = bodyOf<{ floors: Record<string, number>[] }>('spawning:dungeon');
    const walking = bodyOf<{ STEP_LIMIT: number; TURN_RATE: number }>('tuning:walking');
    const flinch = bodyOf<{ lasts: number }>('motion:flinch');
    const wolfModel = bodyOf<{ parts?: unknown[] }>('model:wolf');
    const kind = KINDS.wolf, parts = MODELS.wolf, properties = PROPERTIES.wolf;
    const before = { parts: parts.length, trees: Object.keys(allTrees()).length };
    expect(kind.speed).toBe(wolf.speed);
    expect(SPAWN_RADIUS).toBe(reach.SPAWN_RADIUS);
    expect(DUNGEON_MONSTERS.map((s) => s.kind)).not.toContain('wolf');
    expect(PERSON_KINDS.has('wolf')).toBe(false);

    installContent(edited({
      'creature:wolf': { ...wolf, speed: wolf.speed + 2, hp: wolf.hp + 7 },
      'spawning:reach': { ...reach, SPAWN_RADIUS: reach.SPAWN_RADIUS + 1 },
      'spawning:herds': { ...herds, HERD_CHANCE: 0.25 },
      'spawning:deep': { ...deep, kinds: { orca: 1 } },
      'spawning:dungeon': { ...dungeon, floors: [{ wolf: 1 }, ...dungeon.floors.slice(1)] },
      'tuning:walking': { ...walking, STEP_LIMIT: walking.STEP_LIMIT + 0.1, TURN_RATE: walking.TURN_RATE + 1 },
      'motion:flinch': { ...flinch, lasts: flinch.lasts + 0.1 },
      'model:wolf': { ...wolfModel, parts: [...(wolfModel.parts ?? []), { box: [0.1, 0.1, 0.1], at: [0, 1.2, 0], color: '#ff0000' }] },
    }));

    expect(KINDS.wolf).toBe(kind);
    expect(PROPERTIES.wolf).toBe(properties);
    expect(MODELS.wolf).toBe(parts);
    expect(kind.speed).toBe(wolf.speed + 2);
    expect(kind.hp).toBe(wolf.hp + 7);
    expect(properties.hp).toBe(wolf.hp + 7);
    expect(parts.length).toBe(before.parts + 1);
    expect(kind.parts).toBe(parts);
    expect(SPAWN_RADIUS).toBe(reach.SPAWN_RADIUS + 1);
    expect(SPAWN.HERD_CHANCE).toBe(0.25);
    expect(DEEP_ANIMALS.map((s) => s.kind)).toEqual(['orca']);
    expect(DUNGEON_MONSTERS.map((s) => s.kind)).toEqual(['wolf']);
    expect(STEP_LIMIT).toBeCloseTo(walking.STEP_LIMIT + 0.1);
    expect(BEHAVIOUR.TURN_RATE).toBe(walking.TURN_RATE + 1);
    expect(FLINCH_LASTS).toBeCloseTo(flinch.lasts + 0.1);
    expect(Object.keys(allTrees())).toHaveLength(before.trees);
    expect(JSON.stringify(DEFAULT_CONTENT)).toBe(bundled);

    installContent(defaults);
    expect(kind.speed).toBe(wolf.speed);
    expect(parts.length).toBe(before.parts);
    expect(SPAWN_RADIUS).toBe(reach.SPAWN_RADIUS);
    expect(DUNGEON_MONSTERS.map((s) => s.kind)).not.toContain('wolf');
  });

  it('refuses a revision the game could not load, and changes nothing', () => {
    const wolf = bodyOf<{ speed: number }>('creature:wolf');
    expect(() => installContent(edited({
      'creature:wolf': { ...wolf, speed: 99 },
      'behaviour:grazer': { do: 'grazee' },
    }))).toThrow(ContentError);
    expect(KINDS.wolf.speed).toBe(wolf.speed);
    expect(PROPERTIES.wolf.speed).toBe(wolf.speed);
  });

  it('runs the tree a published revision gives a creature', () => {
    const before = allTrees().grazer;
    installContent(edited({ 'behaviour:grazer': bodyOf('behaviour:wanderer') }));
    expect(allTrees().grazer).not.toBe(before);
    expect(typeof allTrees().grazer).toBe('function');
  });
});

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/**
 * The shape of the codebase, as a test.
 *
 * Layers are only a convention until something checks them, and a convention nobody checks is a
 * convention that quietly stops being true. This walks every import in the game and fails when a
 * lower layer reaches up into a higher one — a creature reading the shop's price list, say, which
 * is exactly the kind of thing that creeps in while nobody is looking.
 *
 * Raising a number here is a decision, not a formality: it means one more thing knows about
 * something it used to be free of.
 */

/** Lower may not import higher. Same rank may import sideways where it already does. */
const RANK: Record<string, number> = {
  core: 0,       // config, seeded randomness, the game loop, the behaviour algebra
  save: 1,       // storage, which knows what a save looks like
  world: 2,      // generation: terrain, roads, structures
  workers: 2,
  entities: 3,   // creatures: movement, spawning, the vocabulary their behaviours use
  render: 3,     // drawing
  dungeon: 3,
  interior: 3,
  game: 4,       // rules: items, quests, trade, the shared world
  ui: 5,         // panels and screens
};

/** Places where the rule is already broken, with the reason and no room for more. */
const ALLOWED: Record<string, number> = {
  // chunkManager builds the meshes it streams, so world reaches into render and into the
  // creature types it hands out. Splitting the mesher from the world is the fix, when it is worth it.
  'world->render': 3,
  'world->entities': 2,
  // drawing the hero needs to know what the hero is wearing, and the sky needs the time of day
  'render->game': 8,
  // a conversation's shape is written by the game and drawn by the ui; the type lives in the ui
  'game->ui': 12,
  // A save is a picture of the game's state and of what its world had grown, so storage knows
  // those types and nothing else. The third is Old Nettle: where he is up to belongs to the
  // world rather than to the hero, because he is in a cell or he is abroad whoever is playing,
  // and the fourth is which roaming bands have been fought, for the same reason.
  'save->game': 3,
  'save->world': 1,
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.ts') && !path.includes('.test.') ? [path] : [];
  });

const layerOf = (path: string): string => relative('src', path).split('/')[0];

describe('the shape of the codebase', () => {
  it('keeps the layers pointing one way', () => {
    const broken: Record<string, string[]> = {};
    for (const path of files('src')) {
      const from = layerOf(path);
      if (RANK[from] === undefined) continue;
      for (const match of readFileSync(path, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
        const to = layerOf(normalize(join(dirname(path), match[1])));
        if (RANK[to] === undefined || RANK[to] <= RANK[from]) continue;
        const edge = `${from}->${to}`;
        (broken[edge] ??= []).push(`${path} -> ${match[1]}`);
      }
    }
    for (const [edge, uses] of Object.entries(broken)) {
      const allowed = ALLOWED[edge] ?? 0;
      expect(uses.length, `${edge}: ${uses.length} imports, ${allowed} allowed\n  ${uses.join('\n  ')}`)
        .toBeLessThanOrEqual(allowed);
    }
  });

  it('keeps a module small enough to hold in your head', () => {
    const TOO_LONG = 700;
    const big = files('src')
      .map((path) => ({ path, lines: readFileSync(path, 'utf8').split('\n').length }))
      .filter((f) => f.lines > TOO_LONG);
    // main.ts is assembly and the frame loop, and is allowed to be the longest thing here; the
    // count is not asserted, because a file being 816 lines rather than 815 is nobody's business
    expect(
      big.map((f) => f.path),
      `past ${TOO_LONG} lines:\n  ${big.map((f) => `${f.path} (${f.lines})`).join('\n  ')}`,
    ).toEqual(['src/main.ts']);
  });
});

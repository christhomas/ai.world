import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two doors into a yard, and no third one.
 *
 * A village's timber arrives one of exactly two ways: its own woodcutters cut it (`felled`), or
 * somebody carried it in and sold it (`brought`). `land` is what both of those are built out of and
 * is nobody else's business — a caller reaching past them puts wood in the yard that the village
 * has no account of, and the wright's memory of who supplied him goes quietly wrong.
 *
 * It went wrong exactly that way once: the market stall landed a player's wood with `land`, so the
 * yard filled and the tally did not, and the cart the item description promises could never be
 * built by selling at a stall. This is the kind of fault a green suite cannot see, because both
 * halves work — they just do not agree.
 */
describe('the ways wood gets into a yard', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

  const body = (file: string): string => readFileSync(file, 'utf8');

  it('are both wired to something that can actually happen', () => {
    /*
     * The fault this whole item exists to fix, guarded at the seam it happened at.
     *
     * `cartBuilt` and `woodWanted` were written, tested and green for a day with nothing anywhere
     * calling them, while the item description promised the player the mechanic in as many words.
     * A count with no caller is invisible to a suite: every test it has passes, and the feature
     * does not exist. So these assert the chain rather than the parts — a counter that lands wood,
     * a page that assembles the meeting, and a game that hands it the village's books.
     */
    expect(body('src/game/talk.ts'), 'a counter that does not land wood is a counter wood vanishes at')
      .toContain('ctx.yard?.(');
    expect(body('src/game/meeting.ts'), 'and a conversation that never gets the door').toContain('yard: landWood');
    expect(body('src/main.ts'), 'and a game that never hands one over').toContain('landWood: houses.yard.brought');
    expect(body('src/game/interact/builder.ts'), 'the wright has to be askable, or the cart is unobtainable')
      .toContain('cartChoice(');
  });

  it('are felling and bringing, and nothing calls land but timber.ts itself', () => {
    const reaching = sources('src')
      .concat(sources('server'))
      .filter((file) => !file.endsWith(join('game', 'timber.ts')))
      .filter((file) => /\byard\.land\(|timber\.land\(/.test(readFileSync(file, 'utf8')));
    expect(reaching, 'wood landed without being felled or brought is wood with no history').toEqual([]);
  });
});

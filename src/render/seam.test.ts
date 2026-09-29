import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every TypeScript file under a directory, tests and their support files included. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('the renderer boundary', () => {
  /*
   * Tests are held to it too. A rule's test that builds its own graphics scene to get a creature
   * renderer is the rule's code knowing about the graphics API by another door, and the next file
   * copies it; `render/entities.test.support.ts` hands out one that needs no scene named.
   */
  it('keeps graphics API objects in the render layer', () => {
    const leaks = sourceFiles('src').filter((path) => !path.startsWith('src/render/'))
      .filter((path) => /\bTHREE\b|from ['"]three(?:\/|['"])/.test(readFileSync(path, 'utf8')));
    expect(leaks).toEqual([]);
  });
});

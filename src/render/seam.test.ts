import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the renderer boundary', () => {
  it('keeps graphics API objects in the render layer', () => {
    const leaks = sourceFiles('src').filter((path) => !path.startsWith('src/render/'))
      .filter((path) => /\bTHREE\b|from ['"]three(?:\/|['"])/.test(readFileSync(path, 'utf8')));
    expect(leaks).toEqual([]);
  });
});

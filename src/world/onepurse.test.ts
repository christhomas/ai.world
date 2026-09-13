import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * One place writes a purse, and that place is `purses.ts`.
 *
 * Item 89. The rule the whole economy is checked against is that a coin leaving one purse arrives
 * in another, and the only way that can be true by construction rather than by everybody
 * remembering is if there is exactly one piece of code that moves money. `pay` is that piece: it
 * applies the ceiling, the floor, and — since the hall became a name money can be owed to — it
 * reports what it could not place instead of dropping it.
 *
 * A purse written anywhere else is a movement that went through none of that. It cannot be audited,
 * it cannot be capped, and it cannot be seen: `village.purse = village.purse + x` is a coin
 * arriving from wherever the reader's attention was at the time.
 *
 * Read as source, the way `chunkpump.test.ts` reads an ordering, because the rule is about *where
 * the code is* and no runtime assertion can see that.
 */
const ALLOWED = new Set(['purses.ts']);

/** Every `.ts` under `src/world` and `server`, tests aside — tests build fixtures and may say anything. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${name.name}`;
      if (name.isDirectory()) { walk(path); continue; }
      if (!name.name.endsWith('.ts') || name.name.includes('.test.')) continue;
      out.push(path);
    }
  };
  walk('src/world');
  walk('server');
  return out;
}

describe('who is allowed to move money', () => {
  it('writes a village treasury in one file and nowhere else', () => {
    const wrong: string[] = [];
    for (const file of sources()) {
      const name = file.split('/').pop()!;
      if (ALLOWED.has(name)) continue;
      const text = readFileSync(file, 'utf8').split('\n');
      text.forEach((line, at) => {
        // an assignment to a settlement's own purse, however it is spelled
        if (/\b(village|settlement|here|room)\.purse\s*=/.test(line)) {
          wrong.push(`${file}:${at + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(wrong, 'money moved without going through `pay`, so no book saw it').toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The hero's money leaves the world in one place, and that place has a name.
 *
 * It used to leave by subtraction — `state.inventory.gold -= price` — in fifteen or so places, and
 * `deeds.ts` was written to end that: a payment has a payer and a payee, and where the payee really
 * is nobody it says `AWAY` out loud so the audit can see a coin go. The conversions were done one
 * at a time and the doctor's fee was called "one of the last".
 *
 * It was not the last. The shrine's bowl was still taking a house's worth of gold out of the game
 * by subtracting it, so the one act in the world that is *meant* to be expensive was invisible to
 * every instrument that counts money.
 *
 * Arrivals are a different thing and are left alone: gold off a body, out of a chest, won at
 * archery or handed over by another player comes from outside the valley and has nowhere else to
 * come from. What this watches is money *going*.
 */
describe('where the hero\'s gold goes', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

  it('never leaves by subtraction, because a coin nobody received is a coin nobody can audit', () => {
    const spending = sources('src').concat(sources('server'))
      .filter((file) => !file.endsWith(join('world', 'deeds.ts')))
      // statements only. Two files quote the old line in prose explaining why it went, and a test
      // that cannot tell a comment from code would make writing that explanation an error
      .filter((file) => readFileSync(file, 'utf8').split('\n')
        .some((line) => /inventory\.gold\s*-=/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)));
    expect(spending, 'pay through `buy`, and name `AWAY` where the payee is genuinely nobody')
      .toEqual([]);
  });
});

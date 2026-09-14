import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { counterConfigSource, counterModuleSource, counterSetupSource } from './fallbackcounts';

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe('fallback counter capture', () => {
  it('keeps counts from every test file', () => {
    const root = mkdtempSync(join(tmpdir(), 'fallback-counts-'));
    scratchDirs.push(root);
    const core = join(root, 'src/core');
    const out = join(root, 'counts.json');
    const config = join(root, 'vitest.config.mts');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'fallbacksweep.ts'), counterModuleSource('parameters'));
    writeFileSync(join(core, 'fallbacksweep.setup.ts'), counterSetupSource(out));
    writeFileSync(config, counterConfigSource(join(process.cwd(), 'vite.config.ts'), join(core, 'fallbacksweep.setup.ts')));

    const test = (value: number) => `
import { expect, it } from 'vitest';
import { usedDefaultParameter, visitedDefaultParameter } from './core/fallbacksweep';
it('records ${value}', () => {
  visitedDefaultParameter(0);
  expect(usedDefaultParameter(0, ${value})).toBe(${value});
});
`;
    writeFileSync(join(root, 'src/first.test.ts'), test(1));
    writeFileSync(join(root, 'src/second.test.ts'), test(2));

    execFileSync('pnpm', [
      'exec', 'vitest', 'run', '--root', root,
      '--config', config, '--no-isolate', '--no-file-parallelism',
    ], { cwd: process.cwd(), stdio: 'pipe' });

    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ visits: [2], defaults: [2] });
  });
});

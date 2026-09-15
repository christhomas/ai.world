import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILDER_PAGE_BASE, buildBuilderPage } from './page';

describe('the page built for the source-host worker', () => {
  let out = '';
  afterEach(() => { if (out) rmSync(out, { recursive: true, force: true }); });

  it('bundles the real Character Builder at the path the authenticated portal serves', async () => {
    out = mkdtempSync(join(tmpdir(), 'builder-page-test-'));
    await buildBuilderPage(process.cwd(), out);

    const page = join(out, 'tools', 'character-builder.html');
    expect(existsSync(page), 'the portal has one stable document path to ask the worker for').toBe(true);
    expect(readFileSync(page, 'utf8'), 'every emitted dependency points back through the guarded route')
      .toContain(BUILDER_PAGE_BASE);
    expect(readdirSync(join(out, 'assets')).some((file) => file.endsWith('.js')),
      'the TypeScript model graph was bundled rather than exposed as source').toBe(true);
    expect(existsSync(join(out, 'src')), 'source modules are never part of the static root').toBe(false);
  }, 120_000);
});

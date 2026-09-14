export type CounterMode = 'fallbacks' | 'parameters';

/** The temporary module every instrumented source file shares during one sweep. */
export function counterModuleSource(mode: CounterMode): string {
  const lines = mode === 'parameters'
    ? [
        '/* Written by `chore fallbacks --parameters` and deleted again by it. */',
        'interface Tally { visits: number[]; defaults: number[] }',
        'const tally: Tally = ((globalThis as { __parameterSweep?: Tally }).__parameterSweep ??= { visits: [], defaults: [] });',
        'export function visitedDefaultParameter(site: number): void { tally.visits[site] = (tally.visits[site] || 0) + 1; }',
        'export function usedDefaultParameter<T>(site: number, value: T): T { tally.defaults[site] = (tally.defaults[site] || 0) + 1; return value; }',
      ]
    : [
        '/* Written by `chore fallbacks` and deleted again by it. Never commit this file. */',
        '',
        '/*',
        ' * The tallies hang off `globalThis` rather than off this module, and that is not laziness.',
        ' *',
        ' * A hundred files import this, and they reach it by whatever relative path they happen to sit',
        ' * at — `../core/...` from one directory, `../../src/core/...` from another. Those are the same',
        ' * file and can still be two module instances, and then every count is split between them and',
        ' * the whole sweep reads as though nothing ever ran. One object, found by name, cannot split.',
        ' */',
        'interface Tally { visits: number[]; defaults: number[] }',
        'const tally: Tally = ((globalThis as { __sweep?: Tally }).__sweep ??= { visits: [], defaults: [] });',
        '',
        '/** We reached this fallback, and here is what the left-hand side had in it. */',
        'export function sawAValue<T>(site: number, value: T): T {',
        '  tally.visits[site] = (tally.visits[site] || 0) + 1;',
        '  return value;',
        '}',
        '',
        '/** The left-hand side had nothing, so the default is what the expression came to. */',
        'export function usedTheDefault<T>(site: number, value: T): T {',
        '  tally.defaults[site] = (tally.defaults[site] || 0) + 1;',
        '  return value;',
        '}',
      ];
  return [...lines, '', 'export function sweepSoFar(): Tally { return tally; }', ''].join('\n');
}

/** A setup file writes cumulative counters after every test file, so the last write is complete. */
export function counterSetupSource(out: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { afterAll } from 'vitest';",
    "import { sweepSoFar } from './fallbacksweep';",
    `afterAll(() => { writeFileSync(${JSON.stringify(out)}, JSON.stringify(sweepSoFar())); });`,
    '',
  ].join('\n');
}

/** Extend the project's Vitest config without teaching ordinary test runs about the sweep. */
export function counterConfigSource(baseConfig: string, setup: string): string {
  return [
    `import baseConfig from ${JSON.stringify(baseConfig)};`,
    'export default async function fallbackSweepConfig(environment: object) {',
    "  const config = typeof baseConfig === 'function' ? await baseConfig(environment) : baseConfig;",
    `  return { ...config, test: { ...config.test, setupFiles: [${JSON.stringify(setup)}] } };`,
    '}',
    '',
  ].join('\n');
}

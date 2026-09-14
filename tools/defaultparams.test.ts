import { transformWithEsbuild } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';
import { instrumentDefaultParameters } from './defaultparams';

interface Tally { visits: number[]; defaults: number[] }

declare global {
  var __parameterSweep: Tally;
}

const COUNTERS = `
const tally = globalThis.__parameterSweep;
const visitedDefaultParameter = (site) => { tally.visits[site] = (tally.visits[site] || 0) + 1; };
const usedDefaultParameter = (site, value) => {
  tally.defaults[site] = (tally.defaults[site] || 0) + 1;
  return value;
};`;

async function executable(source: string, typescript = false): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const transformed = instrumentDefaultParameters(source, 'sample.ts');
  const withCounters = transformed.source.replace(/^import[^\n]+;\n/, COUNTERS);
  const javascript = typescript ? (await transformWithEsbuild(withCounters, 'sample.ts')).code : withCounters;
  const encoded = Buffer.from(javascript).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
}

describe('exported default parameter instrumentation', () => {
  beforeEach(() => { globalThis.__parameterSweep = { visits: [], defaults: [] }; });

  it('counts every call and only the calls which omit the argument', async () => {
    const module = await executable('export function add(value, step = 2) { return value + step; }');
    expect(module.add(3)).toBe(5);
    expect(module.add(3, 4)).toBe(7);
    expect(globalThis.__parameterSweep).toEqual({ visits: [2], defaults: [1] });
  });

  it('leaves evaluation at call time and skips it for a supplied argument', async () => {
    const module = await executable(`
      let next = 0;
      export function take(value = ++next) { return value; }
    `);
    expect(module.take(9)).toBe(9);
    expect(module.take()).toBe(1);
    expect(module.take()).toBe(2);
    expect(globalThis.__parameterSweep).toEqual({ visits: [3], defaults: [2] });
  });

  it('instruments exported arrow functions with expression bodies', async () => {
    const module = await executable('export const add = (value, step = 2) => value + step;');
    expect(module.add(3)).toBe(5);
    expect(module.add(3, 4)).toBe(7);
    expect(globalThis.__parameterSweep).toEqual({ visits: [2], defaults: [1] });
  });

  it('preserves object types nested in tuple and intersection return types', async () => {
    const module = await executable(`
      interface RoadGraph { roads: number[] }
      interface WorldMesh { faces: number[] }
      export function generate(seed: number, radius = 100): [RoadGraph & { mesh: WorldMesh }] {
        return [{ roads: [seed, radius], mesh: { faces: [] } }];
      }
    `, true);
    expect(module.generate(7)).toEqual([{ roads: [7, 100], mesh: { faces: [] } }]);
    expect(globalThis.__parameterSweep).toEqual({ visits: [1], defaults: [1] });
  });

  it('does not split defaults on regex commas or comparison operators', async () => {
    const transformed = instrumentDefaultParameters(`
      export function choose(pattern = /a,b/, flag = 1 < 2) {
        return pattern.test('a,b') && flag;
      }
    `, 'sample.ts');
    expect(transformed.sites.map(({ parameter }) => parameter)).toEqual(['pattern', 'flag']);
    const module = await executable(`
      export function choose(pattern = /a,b/, flag = 1 < 2) {
        return pattern.test('a,b') && flag;
      }
    `);
    expect(module.choose()).toBe(true);
    expect(globalThis.__parameterSweep).toEqual({ visits: [1, 1], defaults: [1, 1] });
  });

  it('ignores declaration-shaped text in comments and strings', async () => {
    const source = `
      const example = 'export function pretend(value = 1) {}';
      // export function alsoPretend(value = 2) {}
      export function real(value = 3) { return value; }
    `;
    const transformed = instrumentDefaultParameters(source, 'sample.ts');
    expect(transformed.sites.map(({ name }) => name)).toEqual(['real']);
    const module = await executable(source);
    expect(module.real()).toBe(3);
    expect(globalThis.__parameterSweep).toEqual({ visits: [1], defaults: [1] });
  });
});

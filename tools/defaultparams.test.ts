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

async function load(source: string): Promise<Record<string, (...args: number[]) => number>> {
  const transformed = instrumentDefaultParameters(source, 'sample.ts');
  const executable = transformed.source.replace(/^import[^\n]+;\n/, COUNTERS);
  const encoded = Buffer.from(executable).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
}

describe('exported default parameter instrumentation', () => {
  beforeEach(() => { globalThis.__parameterSweep = { visits: [], defaults: [] }; });

  it('counts every call and only the calls which omit the argument', async () => {
    const module = await load('export function add(value, step = 2) { return value + step; }');
    expect(module.add(3)).toBe(5);
    expect(module.add(3, 4)).toBe(7);
    expect(globalThis.__parameterSweep).toEqual({ visits: [2], defaults: [1] });
  });

  it('leaves evaluation at call time and skips it for a supplied argument', async () => {
    const module = await load(`
      let next = 0;
      export function take(value = ++next) { return value; }
    `);
    expect(module.take(9)).toBe(9);
    expect(module.take()).toBe(1);
    expect(module.take()).toBe(2);
    expect(globalThis.__parameterSweep).toEqual({ visits: [3], defaults: [2] });
  });
  it('preserves an intersection containing an object return type', async () => {
    const transformed = instrumentDefaultParameters(`
      interface RoadGraph { roads: number[] }
      interface WorldMesh { faces: number[] }
      export function generate(seed: number, radius = 100): RoadGraph & { mesh: WorldMesh } {
        return { roads: [seed, radius], mesh: { faces: [] } };
      }
    `, 'roadweb.ts');
    const executable = transformed.source.replace(/^import[^\n]+;\n/, COUNTERS);
    const compiled = await transformWithEsbuild(executable, 'roadweb.ts');
    const encoded = Buffer.from(compiled.code).toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
    expect(module.generate(7)).toEqual({ roads: [7, 100], mesh: { faces: [] } });
    expect(globalThis.__parameterSweep).toEqual({ visits: [1], defaults: [1] });
  });
});

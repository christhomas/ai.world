import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveStore, SessionSave } from './store';

/** Traverse actual runtime import/re-export edges, including dynamic imports. Type-only data
 * references do not load game/renderer modules at runtime and must not count as runtime edges. */
function dependencies(source: string): string[] {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const edges: string[] = [];
  const forbidden = new Set(['window', 'document', 'indexedDB', 'navigator', 'HTMLElement', 'process', 'require', 'Buffer']);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.type === 'string' && node.type.startsWith('TS')) {
      if (node.expression) { walk(node.expression); return; }
      if (node.type !== 'TSEnumDeclaration' && node.type !== 'TSEnumMember' && node.type !== 'TSModuleDeclaration' && node.type !== 'TSModuleBlock') return;
    }
    if (node.type === 'ImportDeclaration') {
      const imported = node as unknown as { importKind: string; specifiers: Array<{ importKind?: string }>; source: { value: string } };
      if (imported.importKind !== 'type' && (imported.specifiers.length === 0 || imported.specifiers.some(s => s.importKind !== 'type'))) edges.push(imported.source.value);
      return;
    }
    if (node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') {
      if (node.exportKind === 'type') return;
      if (node.source && typeof node.source === 'object') {
        const specifiers = node.specifiers as Array<{ exportKind?: string }> | undefined;
        if (!specifiers?.length || specifiers.some(s => s.exportKind !== 'type')) edges.push((node.source as { value: string }).value);
      }
    }
    if (node.type === 'ImportExpression') {
      const target = node.source as { type?: string; value?: string };
      if (target.type !== 'StringLiteral' || typeof target.value !== 'string') throw new Error('nonliteral runtime import');
      edges.push(target.value);
    }
    if (node.type === 'Identifier' && forbidden.has(node.name as string)) throw new Error(`host global ${node.name}`);
    if (node.type === 'MemberExpression') {
      const object = node.object as { name?: string }, property = node.property as { value?: string; name?: string };
      if (object.name === 'globalThis' && forbidden.has(property.value ?? property.name ?? '')) throw new Error('host global');
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk); else walk(child);
    }
  };
  walk(tree.program);
  return edges;
}

function runtimeGraph(entry: string, read: (path: string) => string, locate: (path: string) => string): Set<string> {
  const reached = new Set<string>();
  const visit = (path: string): void => {
    if (reached.has(path)) return;
    reached.add(path);
    for (const edge of dependencies(read(path))) {
      if (!edge.startsWith('.')) throw new Error(`external runtime dependency ${edge}`);
      visit(locate(resolve(dirname(path), edge)));
    }
  };
  visit(entry); return reached;
}

afterEach(() => vi.unstubAllGlobals());
describe('portable save boundary', () => {
  it('has no external, browser or Node runtime dependency in the production import graph', () => {
    const entry = resolve('src/save/store.ts');
    const reached = runtimeGraph(entry, path => readFileSync(path, 'utf8'), path => {
      const found = [path, `${path}.ts`, `${path}.json`, `${path}/index.ts`].find(existsSync);
      if (!found) throw new Error(`unresolved ${path}`); return found;
    });
    expect([...reached]).toEqual([entry]);
  });
  it('the graph guard rejects a transitive browser adapter and Node import, not just a direct source string', () => {
    const sources: Record<string, string> = { '/portable.ts': "export { use } from './nested';", '/nested.ts': "import { get } from 'idb-keyval'; export const use = get;" };
    expect(() => runtimeGraph('/portable.ts', path => sources[path], path => `${path}.ts`)).toThrow('external runtime dependency idb-keyval');
    expect(() => dependencies("import('node:fs')")).not.toThrow();
    expect(() => runtimeGraph('/portable.ts', () => "import('node:fs')", path => path)).toThrow('external runtime dependency node:fs');
    expect(() => dependencies('export const x = globalThis["indexedDB"];')).toThrow('host global');
    expect(() => dependencies('export const x = (window as unknown);')).toThrow('host global');
    expect(dependencies("import type { Node } from 'node:fs'; export type { Node }; ")).toEqual([]);
  });
  it('imports and applies existing world defaults with browser globals absent', async () => {
    for (const name of ['window', 'document', 'indexedDB', 'navigator']) vi.stubGlobal(name, undefined);
    vi.resetModules();
    const portable = await import('./store');
    expect(Object.keys(portable)).toEqual(['kindOf']);
    for (const unknown of [undefined, null, '', 'not-a-world', 'endless']) expect(portable.kindOf(unknown)).toBe('endless');
    expect(portable.kindOf('road')).toBe('road');
    expect(portable.kindOf('mesh')).toBe('road');
  });
  it('keeps current and legacy save fields and nested authority records without schema migration', async () => {
    const saved: SessionSave = {
      seed: 322, worldName: 'Ashford', world: 'road', cam: { x: 1.5, z: -9, rot: 0.3, zoom: 2 }, player: { x: 3, z: 4 },
      state: { hp: 72, maxHp: 100, time: 0.34, day: 3, savedAt: 1700000000000,
        inventory: { gold: 13, items: { apple: 2 }, equipped: { hand: 'sword' } },
        horse: { name: 'Ash', x: 1, z: 2, palette: 0, breed: 'horse' }, boat: { x: 7, z: 8, yaw: 0.1 },
        discovered: ['village:ashford'], explored: ['0,0'], quests: { rescue: 'active' }, prayers: [] },
      manifest: { rootSeed: 322, anchors: [{ id: 'sky:322', kind: 'skyisle', x: 3, z: 4, seed: 123, parent: null, version: 1, skySite: { radius: 24, y: 60 } }] },
      nemesis: { where: 'lull', scheme: null, held: null, next: 4, ran: 0, tolled: 0, took: 0 },
      roaming: { lost: ['band#0#1'], broken: { band: 2 }, era: { band: 1 } }, sky: 'sky:322',
      discovered: ['legacy-place'], inventory: { gold: 4, items: { bread: 1 } },
    };
    const bytes = new Map<string, string>();
    const store: SaveStore = {
      async load<T>(key: string): Promise<T | undefined> { const value = bytes.get(key); return value === undefined ? undefined : JSON.parse(value) as T; },
      async save<T>(key: string, value: T): Promise<void> { bytes.set(key, JSON.stringify(value)); },
      async remove(key: string): Promise<void> { bytes.delete(key); },
    };
    await store.save('slot', saved);
    const loaded = await store.load<SessionSave>('slot');
    expect(loaded).toEqual(saved);
    expect(loaded!.state!.horse!.name).toBe('Ash');
    expect(loaded!.manifest!.anchors[0].skySite!.y).toBe(60);
    expect(loaded!.sky).toBe('sky:322');
    const legacy: SessionSave = { seed: 4, cam: saved.cam, inventory: saved.inventory, discovered: saved.discovered };
    await store.save('legacy', legacy); expect(await store.load('legacy')).toEqual(legacy);
    expect(Object.hasOwn((await store.load<SessionSave>('legacy'))!, 'world')).toBe(false);
  });
});

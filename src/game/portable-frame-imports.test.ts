import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = new Set(['window', 'document', 'localStorage', 'indexedDB', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Worker', 'WebSocket', 'AudioContext', 'HTMLElement', 'HTMLCanvasElement',
  'process', 'Buffer', 'require']);
type Node = { type?: string; [key: string]: unknown };

/** Inspect runtime edges, including transitive ones; type-only browser declarations are erased. */
function inspect(entry: string, sources = new Map<string, string>()): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.json')) return;
    const ast = parse(sources.get(file) ?? readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
    const parameters = (pattern: Node, names: Set<string>): void => {
      if (pattern.type === 'Identifier') names.add(pattern.name as string);
      else if (pattern.type === 'AssignmentPattern') parameters(pattern.left as Node, names);
      else if (pattern.type === 'RestElement') parameters(pattern.argument as Node, names);
      else if (pattern.type === 'ArrayPattern') {
        for (const item of pattern.elements as Array<Node | null>) if (item) parameters(item, names);
      } else if (pattern.type === 'ObjectPattern') {
        for (const item of pattern.properties as Node[]) parameters((item.value ?? item.argument) as Node, names);
      }
    };
    const walk = (value: unknown, parent?: Node, key?: string, bound = new Set<string>()): void => {
      if (Array.isArray(value)) { for (const child of value) walk(child, parent, key, bound); return; }
      if (!value || typeof value !== 'object') return;
      const node = value as Node;
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'].includes(node.type ?? '')) {
        bound = new Set(bound);
        for (const parameter of node.params as Node[]) parameters(parameter, bound);
      }
      if (node.type?.startsWith('TS') && node.type !== 'TSAsExpression' && node.type !== 'TSNonNullExpression') return;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        const source = node.source as { value?: string } | undefined;
        const specifiers = node.specifiers as Node[] | undefined;
        const onlyTypes = node.importKind === 'type' || node.exportKind === 'type'
          || (specifiers && specifiers.length > 0 && specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type'));
        if (onlyTypes) return;
        if (source?.value) {
          const name = source.value;
          if (name.startsWith('.')) {
            const base = resolve(dirname(file), name);
            const found = [base, base + '.ts', base + '.json', resolve(base, 'index.ts')]
              .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
            if (!found) throw new Error(`Unresolved portable import: ${file} -> ${name}`);
            visit(found);
          } else if (name !== 'three') throw new Error(`Non-CPU portable dependency: ${file} -> ${name}`);
        }
      }
      if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && (node.callee as Node)?.type === 'Import')) {
        throw new Error(`Dynamic import requires an explicit host port: ${file}`);
      }
      if (node.type === 'Identifier' && FORBIDDEN.has(node.name as string) && !bound.has(node.name as string)) {
        const property = key === 'property' && parent?.computed !== true && parent?.type?.includes('MemberExpression')
          && (parent.object as Node)?.name !== 'globalThis';
        const declarationKey = key === 'key' && parent?.computed !== true;
        if (!property && !declarationKey) throw new Error(`Host global ${node.name} in ${file}`);
      }
      for (const [childKey, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'typeAnnotation',
          'returnType', 'typeParameters', 'typeArguments'].includes(childKey)) continue;
        walk(child, node, childKey, bound);
      }
    };
    walk(ast);
  };
  visit(resolve(entry));
  return [...seen].map((file) => relative(process.cwd(), file));
}

describe('portable frame runtime boundary', () => {
  it('keeps scene defaults and daylight free of browser and GPU adapter runtime imports', () => {
    const files = inspect('src/game/portable-scene.ts');
    expect(files).toContain('src/render/scene-state.ts');
    expect(files).toContain('src/render/daylight.ts');
    expect(files).toContain('src/render/scene-math.ts');
    expect(files).not.toContain('src/render/scene.ts');
    expect(files).not.toContain('src/render/daycycle.ts');
    expect(files).not.toContain('src/render/water.ts');
  });
  it('boots production country state without browser mounts, worker constructors or storage', () => {
    const files = inspect('src/game/portable-country.ts');
    expect(files).toContain('src/game/country-state.ts');
    expect(files).toContain('src/world/patchcountry.ts');
    expect(files).toContain('src/world/growworld.ts');
    expect(files).not.toContain('src/game/country.ts');
    expect(files).not.toContain('src/render/scene.ts');
    expect(files).not.toContain('src/world/countryworker.ts');
  });
  it('keeps owned country growth separate from platform workers', () => {
    const files = inspect('src/game/portable-country-jobs.ts');
    expect(files).toContain('src/world/grower.ts');
    expect(files).toContain('src/world/endless.ts');
    expect(files).not.toContain('src/world/countryworker.ts');
    expect(files).not.toContain('src/main.ts');
  });
  it('opens and owns production saves without browser storage or presentation imports', () => {
    const files = inspect('src/game/portable-keeping.ts');
    expect(files).toContain('src/game/keeping.ts');
    expect(files).toContain('src/game/state.ts');
    expect(files).toContain('src/save/owner.ts');
    expect(files).not.toContain('src/save/indexeddb.ts');
    expect(files).not.toContain('src/main.ts');
    expect(files).not.toContain('src/platform/browser-lifecycle.ts');
  });
  it('distinguishes local parameters from host globals without leaking bindings into siblings', () => {
    const entry = resolve('src/game/.portable-boundary-regression.ts');
    const source = (text: string) => new Map([[entry, text]]);
    expect(() => inspect(entry, source('class Scatter { sitesIn(window: { x0: number }) { return window.x0; } }'))).not.toThrow();
    expect(() => inspect(entry, source('function local(window: number) { return window; } function browser() { return window.innerWidth; }'))).toThrow('Host global window');
    expect(() => inspect(entry, source('function browser() { return globalThis.window.innerWidth; }'))).toThrow('Host global window');
    expect(() => inspect(entry, source('function node() { return process.env; }'))).toThrow('Host global process');
  });
  it('constructs the production Player without browser renderer or URL imports', () => {
    const files = inspect('src/game/portable-player.ts');
    expect(files).toContain('src/entities/player.ts');
    expect(files).toContain('src/game/player-opening.ts');
    expect(files).toContain('src/world/opening.ts');
    expect(files).not.toContain('src/render/entities.ts');
    expect(files).not.toContain('src/render/scene.ts');
    expect(files).not.toContain('src/main.ts');
  });
  it('keeps the shared offline authority free of browser and Node runtime imports', () => {
    const files = inspect('src/game/portable-world.ts');
    expect(files).toContain('server/sim.ts');
    expect(files).toContain('server/world.ts');
    expect(files).toContain('src/workers/simdoor.ts');
    expect(files).toContain('src/workers/local-world-host.ts');
    expect(files).not.toContain('src/net/link.ts');
    expect(files).not.toContain('src/net/browservault.ts');
  });
  it('keeps production terrain jobs free of host runtime globals', () => {
    const files = inspect('src/game/portable-chunks.ts');
    expect(files).toContain('src/workers/chunkmesher.ts');
    expect(files).toContain('src/world/mesher.ts');
    expect(files).toContain('src/world/endless.ts');
    expect(files).not.toContain('src/workers/chunkgen.worker.ts');
    expect(files).not.toContain('src/render/chunkworkers.ts');
  });
  it('keeps browser transport factories out of the shared world protocol client', () => {
    const files = inspect('src/game/portable-online.ts');
    expect(files).toContain('src/game/online.ts');
    expect(files).toContain('src/game/heard.ts');
    expect(files).not.toContain('src/net/link.ts');
    expect(files).not.toContain('src/platform/browser-world-link.ts');
  });
  it('keeps browser, Node, workers, networking and GPU adapters out of runtime imports', () => {
    const files = inspect('src/game/portable-frame.ts');
    expect(files).toContain('src/game/frame.ts');
    expect(files).toContain('src/game/keys.ts');
    expect(files).toContain('src/render/camera.ts');
    expect(files).not.toContain('src/render/scene.ts');
    expect(files).not.toContain('src/core/input.ts');
    expect(files).not.toContain('src/main.ts');
  });
});

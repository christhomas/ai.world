import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = new Set(['window', 'document', 'localStorage', 'indexedDB', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Worker', 'WebSocket', 'AudioContext', 'HTMLElement', 'HTMLCanvasElement',
  'process', 'Buffer', 'require']);
type Node = { type?: string; [key: string]: unknown };

/** Inspect runtime edges, including transitive ones; type-only browser declarations are erased. */
function inspect(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.json')) return;
    const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
    const walk = (value: unknown, parent?: Node, key?: string): void => {
      if (Array.isArray(value)) { for (const child of value) walk(child, parent, key); return; }
      if (!value || typeof value !== 'object') return;
      const node = value as Node;
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
            const found = [base + '.ts', base + '.json', resolve(base, 'index.ts')].find(existsSync);
            if (!found) throw new Error(`Unresolved portable import: ${file} -> ${name}`);
            visit(found);
          } else if (name !== 'three') throw new Error(`Non-CPU portable dependency: ${file} -> ${name}`);
        }
      }
      if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && (node.callee as Node)?.type === 'Import')) {
        throw new Error(`Dynamic import requires an explicit host port: ${file}`);
      }
      if (node.type === 'Identifier' && FORBIDDEN.has(node.name as string)) {
        const property = key === 'property' && parent?.computed !== true && parent?.type?.includes('MemberExpression');
        const declarationKey = key === 'key' && parent?.computed !== true;
        if (!property && !declarationKey) throw new Error(`Host global ${node.name} in ${file}`);
      }
      for (const [childKey, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'typeAnnotation',
          'returnType', 'typeParameters', 'typeArguments'].includes(childKey)) continue;
        walk(child, node, childKey);
      }
    };
    walk(ast);
  };
  visit(resolve(entry));
  return [...seen].map((file) => relative(process.cwd(), file));
}

describe('portable frame runtime boundary', () => {
  it('keeps browser, Node, workers, networking and GPU adapters out of runtime imports', () => {
    const files = inspect('src/game/portable-frame.ts');
    expect(files).toContain('src/game/frame.ts');
    expect(files).toContain('src/render/camera.ts');
    expect(files).not.toContain('src/render/scene.ts');
    expect(files).not.toContain('src/core/input.ts');
    expect(files).not.toContain('src/main.ts');
  });
});

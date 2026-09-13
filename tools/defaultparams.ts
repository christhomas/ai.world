import { parse } from '@babel/parser';
import type {
  ArrowFunctionExpression,
  FunctionDeclaration,
  FunctionExpression,
} from '@babel/types';

export interface DefaultParameterSite {
  file: string;
  line: number;
  name: string;
  parameter: string;
  source: string;
}

interface Edit { start: number; end: number; text: string }
export interface InstrumentedParameters { source: string; sites: DefaultParameterSite[] }

type ExportedFunction = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
interface NamedFunction { name: string; node: ExportedFunction }

function exportedFunctions(source: string): NamedFunction[] {
  const program = parse(source, {
    plugins: ['typescript'],
    sourceType: 'module',
  }).program;
  const found: NamedFunction[] = [];

  for (const statement of program.body) {
    if (statement.type === 'ExportNamedDeclaration') {
      const declaration = statement.declaration;
      if (declaration?.type === 'FunctionDeclaration') {
        found.push({ name: declaration.id?.name ?? 'default', node: declaration });
        continue;
      }
      if (declaration?.type !== 'VariableDeclaration') continue;
      for (const variable of declaration.declarations) {
        if (variable.id.type !== 'Identifier') continue;
        if (variable.init?.type !== 'ArrowFunctionExpression' && variable.init?.type !== 'FunctionExpression') continue;
        found.push({ name: variable.id.name, node: variable.init });
      }
      continue;
    }

    if (statement.type !== 'ExportDefaultDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration.type === 'FunctionDeclaration') {
      found.push({ name: declaration.id?.name ?? 'default', node: declaration });
    } else if (declaration.type === 'ArrowFunctionExpression' || declaration.type === 'FunctionExpression') {
      found.push({ name: declaration.type === 'FunctionExpression' ? declaration.id?.name ?? 'default' : 'default', node: declaration });
    }
  }

  return found;
}

function parameterName(source: string, start: number, initializerStart: number): string {
  return source
    .slice(start, initializerStart)
    .replace(/=\s*$/, '')
    .trim()
    .replace(/[?:].*$/, '')
    .trim();
}

/**
 * Wrap default initializers without moving them out of the parameter list, preserving call-time
 * evaluation. Function-entry counters record all calls; initializer counters record omissions.
 */
export function instrumentDefaultParameters(
  source: string,
  file: string,
  firstSite = 0,
  counterImport = './fallbacksweep',
): InstrumentedParameters {
  const sites: DefaultParameterSite[] = [];
  const edits: Edit[] = [];

  for (const { name, node } of exportedFunctions(source)) {
    const bodyStart = node.body?.start;
    const bodyEnd = node.body?.end;
    if (bodyStart === null || bodyStart === undefined || bodyEnd === null || bodyEnd === undefined) continue;
    const visits: number[] = [];

    for (const parameter of node.params) {
      if (parameter.type !== 'AssignmentPattern') continue;
      const parameterStart = parameter.start;
      const initializerStart = parameter.right.start;
      const initializerEnd = parameter.right.end;
      if (parameterStart === null || parameterStart === undefined || initializerStart === null || initializerStart === undefined || initializerEnd === null || initializerEnd === undefined) continue;
      const site = firstSite + sites.length;
      const initializerSource = source.slice(initializerStart, initializerEnd);
      sites.push({
        file,
        line: parameter.loc?.start.line ?? source.slice(0, parameterStart).split('\n').length,
        name,
        parameter: parameterName(source, parameterStart, initializerStart),
        source: initializerSource,
      });
      edits.push({
        start: initializerStart,
        end: initializerEnd,
        text: `usedDefaultParameter(${site}, ${initializerSource})`,
      });
      visits.push(site);
    }

    if (visits.length === 0) continue;
    const visitSource = visits.map((site) => `visitedDefaultParameter(${site})`).join(', ');
    if (node.body.type === 'BlockStatement') {
      edits.push({
        start: bodyStart + 1,
        end: bodyStart + 1,
        text: `\n  ${visitSource.replaceAll(', ', '; ')}; `,
      });
    } else {
      const bodySource = source.slice(bodyStart, bodyEnd);
      edits.push({
        start: bodyStart,
        end: bodyEnd,
        text: `(${visitSource}, ${bodySource})`,
      });
    }
  }

  if (sites.length === 0) return { source, sites };
  edits.sort((left, right) => right.start - left.start);
  let instrumented = source;
  for (const edit of edits) {
    instrumented = instrumented.slice(0, edit.start) + edit.text + instrumented.slice(edit.end);
  }
  return {
    source: `import { visitedDefaultParameter, usedDefaultParameter } from '${counterImport}';\n${instrumented}`,
    sites,
  };
}

export interface DefaultParameterSite {
  file: string;
  line: number;
  name: string;
  parameter: string;
  source: string;
}

interface Edit { start: number; end: number; text: string }
export interface InstrumentedParameters { source: string; sites: DefaultParameterSite[] }

/** Return delimiter positions at the outer level of a TypeScript fragment. */
function outerDelimiters(text: string, from: number, to: number, wanted: string): number[] {
  const found: number[] = [];
  let round = 0, square = 0, curly = 0, angle = 0;
  let quote = '', lineComment = false, blockComment = false;
  for (let at = from; at < to; at++) {
    const char = text[at], next = text[at + 1] ?? '';
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; at++; } continue; }
    if (quote) {
      if (char === '\\') { at++; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; at++; continue; }
    if (char === '/' && next === '*') { blockComment = true; at++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    const outer = round === 0 && square === 0 && curly === 0 && angle === 0;
    if (outer && wanted.includes(char)) found.push(at);
    if (char === '(') round++; else if (char === ')') round--;
    else if (char === '[') square++; else if (char === ']') square--;
    else if (char === '{') curly++; else if (char === '}') curly--;
    else if (char === '<') angle++; else if (char === '>' && angle > 0) angle--;
  }
  return found;
}

function closingParen(text: string, open: number): number {
  let depth = 0, quote = '', lineComment = false, blockComment = false;
  for (let at = open; at < text.length; at++) {
    const char = text[at], next = text[at + 1] ?? '';
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; at++; } continue; }
    if (quote) { if (char === '\\') at++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '/') { lineComment = true; at++; continue; }
    if (char === '/' && next === '*') { blockComment = true; at++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return at;
  }
  return -1;
}

/** Find the declaration body, skipping object types embedded in the return type. */
function functionBody(text: string, afterParameters: number): number {
  let at = afterParameters;
  while (at < text.length) {
    const brace = text.indexOf('{', at);
    const semicolon = text.indexOf(';', at);
    if (brace < 0 || (semicolon >= 0 && semicolon < brace)) return -1;
    const before = text.slice(at, brace).trimEnd();
    const wholeReturn = text.slice(afterParameters, brace).trim();
    const opensReturnObject = wholeReturn === ':' || /(?:=>|[&|<,?=(])\s*$/.test(before);
    if (!opensReturnObject) return brace;

    let depth = 1, end = brace + 1;
    let quote = '', lineComment = false, blockComment = false;
    for (; end < text.length && depth > 0; end++) {
      const char = text[end], next = text[end + 1] ?? '';
      if (lineComment) { if (char === '\n') lineComment = false; continue; }
      if (blockComment) { if (char === '*' && next === '/') { blockComment = false; end++; } continue; }
      if (quote) { if (char === '\\') end++; else if (char === quote) quote = ''; continue; }
      if (char === '/' && next === '/') { lineComment = true; end++; continue; }
      if (char === '/' && next === '*') { blockComment = true; end++; continue; }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    at = end;
  }
  return -1;
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
  const declarations = source.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g);
  for (const declaration of declarations) {
    const name = declaration[1];
    const open = source.indexOf('(', declaration.index + declaration[0].length);
    const close = open < 0 ? -1 : closingParen(source, open);
    const body = close < 0 ? -1 : functionBody(source, close + 1);
    if (open < 0 || close < 0 || body < 0) continue;
    const commas = outerDelimiters(source, open + 1, close, ',');
    const starts = [open + 1, ...commas.map((position) => position + 1)];
    const ends = [...commas, close];
    const visits: number[] = [];
    for (let part = 0; part < starts.length; part++) {
      const equals = outerDelimiters(source, starts[part], ends[part], '=')
        .find((position) => source[position + 1] !== '>' && source[position + 1] !== '=' && source[position - 1] !== '=');
      if (equals === undefined) continue;
      const initializerStart = equals + 1 + (source.slice(equals + 1, ends[part]).match(/^\s*/)?.[0].length ?? 0);
      const initializerEnd = ends[part] - (source.slice(starts[part], ends[part]).match(/\s*$/)?.[0].length ?? 0);
      const parameter = source.slice(starts[part], equals).trim().replace(/[?:].*$/, '').trim();
      const site = firstSite + sites.length;
      const initializerSource = source.slice(initializerStart, initializerEnd);
      sites.push({
        file,
        line: source.slice(0, starts[part]).split('\n').length,
        name,
        parameter,
        source: initializerSource,
      });
      edits.push({
        start: initializerStart,
        end: initializerEnd,
        text: `usedDefaultParameter(${site}, ${initializerSource})`,
      });
      visits.push(site);
    }
    if (visits.length > 0) {
      edits.push({
        start: body + 1,
        end: body + 1,
        text: `\n  ${visits.map((site) => `visitedDefaultParameter(${site});`).join(' ')} `,
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

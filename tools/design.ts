import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The design canvas, from the terminal.
 *
 * There are two halves of this project that have to agree about what the game looks like, and they
 * do not speak the same language. One is `design/` — a Claude Design canvas, artboards of `.dc.html`
 * with a `canvas.json` laying them out — and the other is `src/ui/`, which is the interface people
 * actually play. Nothing has ever compared them.
 *
 * What this is *not*: a client for Claude Design's own service. It does not need to be one. Claude
 * Design speaks MCP at `https://api.anthropic.com/v1/design/mcp` — added with
 * `claude mcp add --scope user --transport http claude-design <url>` and authorised by the same
 * claude.ai login — so an agent that wants to *talk to the design tool* already can, without a line
 * of code here.
 *
 * This is the other half of that, and it is the half no protocol provides: the design and the game
 * live in one repository and nothing has ever compared them. A canvas is read by opening it; a
 * codebase is read by grepping it; and the question "does this drawing still describe this game" has
 * no owner. It has one now.
 *
 * Three things it does.
 *
 * `list` says what the canvas holds: the artboards, their sizes, where they sit and what the notes
 * pinned to it say. A canvas is a picture and a picture is not readable from a terminal, so this is
 * the index — enough to know what exists and which file to open.
 *
 * `read <artboard>` prints the words on one. A design is mostly words: the labels, the readouts,
 * the sentences a villager says, the key hints. Those are exactly the parts that go stale, and they
 * are the parts a terminal can show honestly.
 *
 * `check` is the one worth having. It reads the artboards and the game and reports where they have
 * drifted apart — a key hint for a key that does nothing any more, a world type that was retired, a
 * readout the game has since grown. Designs go stale silently: nobody notices until somebody builds
 * from one and ships an interface that describes a game that no longer exists.
 */

const CANVAS = 'design';

interface Artboard {
  file: string;
  title?: string;
  x: number;
  z?: number;
  y?: number;
  w: number;
  h: number;
  page?: string;
}

interface Canvas {
  artboards: Artboard[];
  annotations?: Array<{ id: string; text: string }>;
}

/** The canvas manifest, or nothing if this project has no design in it. */
function canvasOf(dir: string): Canvas | null {
  const path = join(dir, 'canvas.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Canvas;
}

/**
 * The words on an artboard, in the order they are drawn.
 *
 * Scripts, styles and comments are dropped before the tags are, because a stylesheet is full of
 * words that are not writing — and what is being looked for here is the writing.
 */
export function wordsIn(source: string): string {
  const withoutCode = source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ');
  return withoutCode.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Where an artboard and the game disagree.
 *
 * Each entry is a thing the design says and a reason the game no longer says it. Deliberately
 * shallow: it looks for *words*, because a design is words and a false positive here costs somebody
 * ten seconds while a missed one costs an interface built against a game that has moved.
 */
export interface Drift {
  artboard: string;
  said: string;
  why: string;
}

/** What a design is checked against: things the game used to have and no longer does. */
const GONE: Array<{ said: RegExp; why: string }> = [
  {
    said: /with mountains|flat country|the land comes out more regular/i,
    why: 'the polygon world was retired — a seed grows one country now, and the choice on the title screen is gone',
  },
  { said: /\bM map\b|\bM\b *· *map/i, why: 'the map is on 5 (M still works), and the little map opens it when pressed' },
  { said: /\bJ\b *journal/i, why: 'the panels moved to the number row: journal is 3' },
  { said: /\bI\b *rucksack/i, why: 'the panels moved to the number row: rucksack is 4' },
];

/**
 * And things the *interface* has grown that a design made before them cannot know about.
 *
 * Only asked of artboards that are drawing the interface. A title screen has no health bar and no
 * business mentioning one, and a check that complained about it would be a check nobody reads —
 * which is the failure mode of every staleness tool ever written.
 */
const SINCE: Array<{ said: RegExp; why: string }> = [
  { said: /breath|air|lungs/i, why: 'breath is a meter beside health now, in the same twenty blocks' },
  { said: /see through|cutaway/i, why: 'seeing through what is in front of you is a switch, on 2 and in Options' },
  { said: /registry|domesday/i, why: 'the Domesday Book has a page of its own' },
];

/** Whether this artboard is drawing the interface, and can therefore be short of a part of it. */
export const drawsTheHud = (file: string, title = ''): boolean => /hud/i.test(`${file} ${title}`);

/** Read every artboard and say where it has drifted from the game. */
export function driftIn(dir = CANVAS): { drift: Drift[]; missing: string[] } {
  const canvas = canvasOf(dir);
  const boards = canvas
    ? canvas.artboards.map((a) => ({ file: a.file, title: a.title ?? '' }))
    : readdirSync(dir).filter((f) => f.endsWith('.dc.html')).map((file) => ({ file, title: '' }));
  const drift: Drift[] = [];
  const missing: string[] = [];
  for (const { file, title } of boards) {
    const path = join(dir, file);
    if (!existsSync(path)) { missing.push(file); continue; }
    const words = wordsIn(readFileSync(path, 'utf8'));
    for (const { said, why } of GONE) {
      const hit = words.match(said);
      if (hit) drift.push({ artboard: file, said: hit[0], why });
    }
    // the other way round: an interface that never mentions something the interface has grown
    if (!drawsTheHud(file, title)) continue;
    for (const { said, why } of SINCE) {
      if (!said.test(words)) drift.push({ artboard: file, said: '—', why: `nothing about it: ${why}` });
    }
  }
  return { drift, missing };
}

function list(dir: string): void {
  const canvas = canvasOf(dir);
  if (!canvas) { console.log(`no canvas in ${dir}/ — nothing has been designed here yet`); return; }
  console.log(`${canvas.artboards.length} artboards in ${dir}/`);
  for (const board of canvas.artboards) {
    const where = `${board.x},${board.y ?? board.z ?? 0}`;
    console.log(`  ${board.file.padEnd(20)} ${String(board.w).padStart(5)}×${String(board.h).padEnd(5)} at ${where.padEnd(12)} ${board.title ?? ''}`);
  }
  for (const note of canvas.annotations ?? []) {
    console.log(`\n  note "${note.id}":`);
    for (const line of note.text.split('\n')) console.log(`    ${line}`);
  }
}

function read(dir: string, which: string): void {
  const file = which.endsWith('.dc.html') ? which : `${which}.dc.html`;
  const path = join(dir, file);
  if (!existsSync(path)) { console.log(`no ${file} in ${dir}/`); process.exitCode = 1; return; }
  console.log(wordsIn(readFileSync(path, 'utf8')));
}

function check(dir: string): void {
  const { drift, missing } = driftIn(dir);
  for (const file of missing) console.log(`MISSING  ${file} — the canvas lists it and it is not there`);
  if (drift.length === 0 && missing.length === 0) {
    console.log('the design and the game agree, as far as this knows how to look');
    return;
  }
  for (const d of drift) console.log(`DRIFT    ${d.artboard}: "${d.said}" — ${d.why}`);
  console.log(`\n${drift.length} things to look at. A design is words, and words are what goes stale.`);
}

const [what = 'list', ...rest] = process.argv.slice(2);
const dir = process.env.DESIGN_DIR ?? CANVAS;
if (what === 'list') list(dir);
else if (what === 'read') read(dir, rest[0] ?? 'Main');
else if (what === 'check') check(dir);
else {
  console.log('usage: chore design [list | read <artboard> | check]');
  process.exitCode = 1;
}

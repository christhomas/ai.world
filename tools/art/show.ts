import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compare, type Panel } from './compare';
import { showImage, supportOf } from './terminal';
import { faces } from './subjects/faces';
import { CANDIDATES, candidate, committed, filesOf, working, type Version } from './versions';
import type { Subject } from './subject';

/**
 * `chore art` — look at the game's artwork, and at what you are about to change it to.
 *
 * The loop this exists to close: ask for a new version of something, see it beside the old one
 * without leaving the terminal, and either take it or throw it away. Judging art by reading a
 * diff of hex colours does not work, and neither does rebuilding the game every time you nudge a
 * number.
 *
 * Two things can be compared against, because two questions get asked. "What have I just done to
 * this?" wants the last commit. "Which of these three should it be?" wants named candidates,
 * which sit unapproved in art/candidates until one is chosen.
 */

const SUBJECTS: Subject[] = [faces];

const HELP = `
chore art <subject> [--try <name>]...   look at a subject, beside the version it is replacing
chore art list                          what can be looked at
chore art approve <name> [subject]      take a candidate: copy its files into the game
chore art discard [subject]             throw away uncommitted changes to a subject's files

  chore art faces                       working tree, beside the last commit
  chore art faces --try warmer          working tree, beside a candidate
  chore art faces --try warmer --try cold      two proposals at once
  chore art faces --only                just the art, with nothing to compare it to
  chore art faces --out sheet.png       write the picture to a file as well
`.trim();

async function main(argv: string[]): Promise<number> {
  const repo = resolve(process.cwd());
  const [command = '', ...rest] = argv;

  if (command === '' || command === 'help' || command === '--help') { console.log(HELP); return 0; }
  if (command === 'list') return list();
  if (command === 'approve') return approve(repo, rest);
  if (command === 'discard') return discard(repo, rest);

  const subject = SUBJECTS.find((s) => s.name === command);
  if (!subject) {
    console.error(`no artwork called "${command}". Try: ${SUBJECTS.map((s) => s.name).join(', ')}`);
    return 1;
  }
  return show(repo, subject, rest);
}

function list(): number {
  console.log('artwork this can draw:\n');
  for (const subject of SUBJECTS) {
    console.log(`  ${subject.name.padEnd(10)} ${subject.what}`);
    console.log(`  ${' '.repeat(10)} ${subject.files.join(', ')}`);
  }
  return 0;
}

async function show(repo: string, subject: Subject, args: string[]): Promise<number> {
  const tries = args.flatMap((arg, at) => (arg === '--try' ? [args[at + 1]] : [])).filter(Boolean);
  const alone = args.includes('--only');
  const out = args[args.indexOf('--out') + 1];

  const versions: Version[] = [];
  try {
    if (!alone && tries.length === 0) versions.push(committed(repo));
    for (const name of tries) versions.push(candidate(repo, name, subject));
    versions.push(working(repo));

    const panels: Panel[] = [];
    for (const version of versions) {
      panels.push({
        label: version.label,
        note: noteFor(repo, subject, version),
        art: await subject.render(version.root),
      });
    }

    const sheet = compare(panels);
    const png = sheet.png();
    if (args.includes('--out') && out) {
      writeFileSync(resolve(repo, out), png);
      console.log(`written to ${out}`);
    }
    if (!showImage(png)) {
      const path = join(repo, `art-${subject.name}.png`);
      writeFileSync(path, png);
      console.log(`this terminal cannot show pictures. Written to ${path}`);
      console.log(`(Ghostty, Kitty, WezTerm and iTerm2 can. In tmux you also need: set -g allow-passthrough on)`);
      return 0;
    }
    console.log(advice(subject, tries));
    return 0;
  } finally {
    for (const version of versions) version.done();
  }
}

/** A word under each panel: whether it is what the game currently draws, and what differs. */
function noteFor(repo: string, subject: Subject, version: Version): string | undefined {
  if (version.label === 'working') {
    const changed = uncommitted(repo, subject);
    return changed.length === 0 ? 'same as committed' : `${changed.length} file${changed.length === 1 ? '' : 's'} changed`;
  }
  if (version.label === 'committed') return 'in the game now';
  return `${filesOf(repo, version.label, subject).length} file(s) proposed`;
}

function advice(subject: Subject, tries: string[]): string {
  if (tries.length > 0) return `take one:  chore art approve <name> ${subject.name}`;
  return `keep it:  git commit\nthrow it away:  chore art discard ${subject.name}`;
}

/** Which of a subject's files differ from the last commit. */
function uncommitted(repo: string, subject: Subject): string[] {
  const out = execFileSync('git', ['status', '--porcelain', '--', ...subject.files], { cwd: repo }).toString();
  return out.split('\n').map((line) => line.slice(3).trim()).filter(Boolean);
}

function approve(repo: string, args: string[]): number {
  const [name, which] = args;
  if (!name) { console.error('which candidate? chore art approve <name> [subject]'); return 1; }

  const subjects = which ? SUBJECTS.filter((s) => s.name === which) : SUBJECTS;
  let taken = 0;
  for (const subject of subjects) {
    for (const file of filesOf(repo, name, subject)) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      cpSync(join(repo, CANDIDATES, name, file), join(repo, file));
      console.log(`  took ${file}`);
      taken++;
    }
  }
  if (taken === 0) { console.error(`"${name}" had nothing to take`); return 1; }
  console.log(`\n${taken} file(s) are now what the game draws. Check them: chore check`);
  return 0;
}

function discard(repo: string, args: string[]): number {
  const [which] = args;
  const subjects = which ? SUBJECTS.filter((s) => s.name === which) : SUBJECTS;
  const files = subjects.flatMap((s) => s.files).filter((f) => existsSync(join(repo, f)));
  if (files.length === 0) { console.error('nothing to discard'); return 1; }

  execFileSync('git', ['checkout', '--', ...files], { cwd: repo });
  console.log(`put back to the last commit:\n  ${files.join('\n  ')}`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));

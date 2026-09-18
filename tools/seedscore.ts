import { writeFileSync } from 'node:fs';
import { GRID, readSeed, type Reading } from '../src/world/seedscore';
import { PATCH } from '../src/world/patchwork';
import { reportAt } from './reports';

/**
 * The spread of what many seeds are worth, on a page.
 *
 * The measuring itself is `src/world/seedscore.ts`, because the game rejects seeds with it and
 * nothing under `src` may import from here. This is the half that only a person at a terminal
 * wants: a distribution, and the ten worst and ten best worlds in the sample.
 *
 * **It chooses nothing.** #323 is explicit about the order the work goes in —
 *
 * > *Worth writing the measuring tool first and looking at a few hundred seeds before choosing a
 * > single threshold.*
 *
 * — and the cut that came out of looking is in `world/goodseed.ts`, next to the thing that applies
 * it, with the numbers from a run of this recorded beside it.
 *
 *   chore seeds          # 200 seeds
 *   chore seeds -- 1000  # or as many as you like
 */

/** The value at a place in a sorted list, so a spread can be described without a mean hiding it. */
export function at(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[i];
}

/** One column of the distribution, from lowest to highest. */
function column(name: string, values: readonly number[], places = 2): string {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const say = (n: number): string => (Number.isFinite(n) ? n.toFixed(places) : '—');
  const missing = values.length - sorted.length;
  return `${name.padEnd(10)} ${say(at(sorted, 0)).padStart(9)} ${say(at(sorted, 0.05)).padStart(9)}`
    + ` ${say(at(sorted, 0.25)).padStart(9)} ${say(at(sorted, 0.5)).padStart(9)}`
    + ` ${say(at(sorted, 0.75)).padStart(9)} ${say(at(sorted, 0.95)).padStart(9)}`
    + ` ${say(at(sorted, 1)).padStart(9)}${missing ? `   (${missing} with no village)` : ''}`;
}

export function report(readings: readonly Reading[]): string {
  const lines = [
    `${readings.length} seeds, each measured on its home patch (${PATCH} tiles square, ${GRID * GRID} probes).`,
    '',
    'No threshold is chosen here. See #323: the cut goes where the tail plainly is, and nobody can',
    'see where that is until the spread is on a page.',
    '',
    `${''.padEnd(10)} ${'lowest'.padStart(9)} ${'5%'.padStart(9)} ${'25%'.padStart(9)} ${'half'.padStart(9)} ${'75%'.padStart(9)} ${'95%'.padStart(9)} ${'highest'.padStart(9)}`,
    column('land', readings.map((r) => r.land), 3),
    column('whole', readings.map((r) => r.whole), 3),
    column('villages', readings.map((r) => r.villages), 0),
    column('spread', readings.map((r) => r.spread), 0),
    column('home', readings.map((r) => r.home), 0),
    '',
    /*
     * The emptiest worlds, which is where the only bad tail in this measurement actually is.
     *
     * Two hundred seeds put no tail in `land` or `whole` at all — the thinnest is half dry land and
     * the most broken-up is one continent — and a plain floor of nought villages in this column.
     * So the ten thinnest by land, below, answer a question the data says is not the question; this
     * is the one that is. See `world/goodseed.ts`, where the bar that came out of it lives.
     */
    'The ten emptiest worlds, which is where the only bad tail in this measurement is:',
    ...[...readings].sort((a, b) => a.villages - b.villages || a.spread - b.spread).slice(0, 10).map(
      (r) => `  ${String(r.seed).padStart(11)}  villages ${String(r.villages).padStart(2)}`
        + `  spread ${r.spread.toFixed(0).padStart(4)}  home ${Number.isFinite(r.home) ? r.home.toFixed(0) : '—'}`
        + `  land ${r.land.toFixed(3)}`,
    ),
    '',
    `Of these, ${readings.filter((r) => r.villages < 2).length} of ${readings.length} have fewer than two villages,`,
    'which is the bar `world/goodseed.ts` draws again on: nobody to meet, or nowhere to walk to.',
    '',
    'The ten thinnest worlds by land, which is where a bad seed shows first:',
    ...[...readings].sort((a, b) => a.land - b.land).slice(0, 10).map(
      (r) => `  ${String(r.seed).padStart(11)}  land ${r.land.toFixed(3)}  villages ${String(r.villages).padStart(2)}`
        + `  spread ${r.spread.toFixed(0).padStart(4)}  home ${Number.isFinite(r.home) ? r.home.toFixed(0) : '—'}`,
    ),
    '',
    'And the ten fattest, for the other end of the same question:',
    ...[...readings].sort((a, b) => b.land - a.land).slice(0, 10).map(
      (r) => `  ${String(r.seed).padStart(11)}  land ${r.land.toFixed(3)}  villages ${String(r.villages).padStart(2)}`
        + `  spread ${r.spread.toFixed(0).padStart(4)}  home ${Number.isFinite(r.home) ? r.home.toFixed(0) : '—'}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/* c8 ignore start -- the command line, which the test does not run */
if (process.argv[1]?.endsWith('seedscore.ts')) {
  const many = Number(process.argv[2]) || 200;
  const readings: Reading[] = [];
  const began = Date.now();
  for (let i = 0; i < many; i++) readings.push(readSeed((i * 2654435761) >>> 0));
  const text = `${report(readings)}\nMeasured in ${((Date.now() - began) / 1000).toFixed(1)}s.\n`;
  const to = reportAt('seeds-report.txt');
  writeFileSync(to, text);
  process.stdout.write(`${text}\nWritten to ${to}\n`);
}
/* c8 ignore stop */

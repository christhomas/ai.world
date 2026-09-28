/* Reproducible comparison of the live village model with and without contact transmission.
 * Run: pnpm exec tsx tools/illness-benchmark.ts
 * Both arms use the same seeds, founding villages, daily roll rules and economy. The sole switch
 * is `Register`'s contact counterfactual; spontaneous illness remains active in both arms.
 */
import { performance } from 'node:perf_hooks';
import { wellEnough } from '../src/world/ailments';
import { Register } from '../src/world/register';

const SEEDS = [11, 23, 42, 77, 101];
const VILLAGES = ['Ashford', 'Pine'];
const HORIZONS = [30, 90, 180];

interface Score {
  cases: number;
  sickDays: number;
  workDays: number;
  population: number;
  elapsedMs: number;
}

function run(horizon: number, contacts: boolean): Score {
  const score: Score = { cases: 0, sickDays: 0, workDays: 0, population: 0, elapsedMs: 0 };
  const start = performance.now();
  for (const seed of SEEDS) {
    const book = new Register(seed, 1, () => {}, 'instant', contacts);
    for (const name of VILLAGES) book.settle(name, 8, ['farmer', 'doctor', 'smith', 'baker']);
    const illBefore = new Set<string>();
    for (let day = 2; day <= horizon; day++) {
      // Work is settled before the evening's recovery/new infections in `liveADay`.
      for (const name of VILLAGES) for (const person of book.living(name)) {
        if (person.trade && wellEnough(person)) score.workDays++;
      }
      book.advance(day);
      const illNow = new Set<string>();
      for (const name of VILLAGES) for (const person of book.living(name)) {
        if ((person.ill ?? 0) > 0) {
          illNow.add(person.id);
          score.sickDays++;
          if (!illBefore.has(person.id)) score.cases++;
        }
      }
      illBefore.clear();
      for (const id of illNow) illBefore.add(id);
    }
    for (const name of VILLAGES) score.population += book.living(name).length;
  }
  score.elapsedMs = Math.round(performance.now() - start);
  return score;
}

console.log('Seeds:', SEEDS.join(', '), '| villages:', VILLAGES.join(', '));
console.log('Days | mode | cases | sick person-days | observed days/case | healthy workdays | final population | elapsed ms');
for (const days of HORIZONS) for (const [name, contacts] of [['isolated', false], ['contact', true]] as const) {
  const score = run(days, contacts);
  console.log(`${days} | ${name} | ${score.cases} | ${score.sickDays} | ` +
    `${(score.sickDays / Math.max(1, score.cases)).toFixed(2)} | ${score.workDays} | ` +
    `${score.population} | ${score.elapsedMs}`);
}

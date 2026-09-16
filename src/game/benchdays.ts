/**
 * How long a bench run is, which is a question rather than a constant.
 *
 * `DAYS` was 100, and both benches read it. A hundred days is barely more than one lifetime —
 * people live 60 to 90 — so a world breeding under replacement has not had time to show what that
 * does to it, and every question of the form *does this village recover, or does it flatten out*
 * stopped before its answer arrived. Item #248 is waiting on exactly that, and no constant in the
 * economy should move until it can be tried rather than argued about.
 *
 * Through the environment rather than an argument, and the reason is `RUNS`: the runs are a module
 * constant that every bench imports, built once when the module loads, and threading a parameter
 * up through that would mean every caller passing a length it does not care about. `chore economy
 * 400` sets it; nothing else changes.
 *
 * A longer run costs proportionally more time. That is the trade being bought rather than a problem
 * to solve, so there is deliberately no cap: a cap would silently answer a different question from
 * the one that was asked, which is the one thing worse than a slow bench.
 */

/**
 * The length every bound in these benches was tuned at.
 *
 * Bounds phrased as absolutes — a purse of so many coins, a village at day 101, a window from the
 * thirtieth to the fortieth — are only true at this length. Asked a longer question they are not
 * wrong, they are answering a different one, and a bench that goes red because somebody asked it a
 * longer question is a bench somebody turns off. So a bound that depends on the length reports at
 * any other length rather than failing. See `economy.test.ts`.
 */
export const TUNED_FOR = 100;

/**
 * How many days to live, from `BENCH_DAYS`, or a hundred.
 *
 * Refuses anything that is not a whole number of days rather than running for `NaN` of them: a
 * bench that silently ran for no days at all would report every bound as met, which is the most
 * expensive way this could fail.
 */
export function daysAsked(): number {
  const asked = process.env.BENCH_DAYS;
  if (asked === undefined) return TUNED_FOR;
  const days = Number(asked);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`BENCH_DAYS must be a whole number of days, at least one — got ${JSON.stringify(asked)}`);
  }
  return days;
}

import type { Owner } from './holdings';
import type { HoldingIncome } from './holdingbook';
import { whoFed, type Trading } from './livelihoods';
import type { Person } from './people';

/** Sources the economy has already assigned to particular farms during the morning. */
export interface HoldingIncomeSource {
  fields: readonly { holding: string; owner: Owner; meals: number }[];
  cattle: readonly { holding: string; owner: Owner; take: number }[];
}

/**
 * Attribute the evening's actual food payout without paying it again.
 * `paidForFood` pools a person's field crop with their garden, fish and meat before sharing the
 * dinner money. A farm owns the field's share of that pool, not the entire purse receipt, so its
 * crop take is the already-paid receipt times its meals divided by all of that owner's meals.
 * Cattle here means the farm's outside sale after its hand's wage; local meat stays a farmer's
 * trade receipt in the existing economy and is not assigned to a holding. Shops likewise are
 * trades rather than holdings. Both exclusions keep the report from inventing owner income.
 */
export function holdingIncomeFor(
  day: number, people: readonly Person[], work: Trading, paid: ReadonlyMap<Owner, number>,
): HoldingIncome[] {
  const rows = new Map<string, HoldingIncome>();
  const add = (holding: string, owner: Owner, cattle: number, crop: number): void => {
    const key = JSON.stringify([holding, owner]);
    const row = rows.get(key) ?? { type: 'income', day, holding, owner, cattle: 0, crop: 0 };
    row.cattle += cattle;
    row.crop += crop;
    rows.set(key, row);
  };
  for (const sale of work.holdingIncome.cattle) add(sale.holding, sale.owner, sale.take, 0);
  const contributed = whoFed(people, work.meat, work.shore, work.fish, work.fields);
  for (const field of work.holdingIncome.fields) {
    const total = contributed.get(field.owner) ?? 0;
    add(field.holding, field.owner, 0,
      total > 0 ? (paid.get(field.owner) ?? 0) * field.meals / total : 0);
  }
  return [...rows.values()].sort((a, b) => a.holding.localeCompare(b.holding)
    || a.owner.localeCompare(b.owner));
}

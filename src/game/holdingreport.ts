import type { Holding } from '../world/holdings';
import type { HoldingBook } from '../world/holdingbook';

/** Pages for the hall's account of one owner's holdings, read from recorded mornings only. */
export function holdingReport(
  village: string, owner: string, holdings: readonly Holding[], book: HoldingBook,
  after: number, through: number, nameOf: (id: string) => string,
): string[] {
  const mine = holdings.filter((holding) => holding.owner === owner);
  if (mine.length === 0) return [`The hall of ${village} has no holdings in your name.`];
  const noNewMornings = after >= through;
  const interval = noNewMornings ? `No new mornings have passed since day ${through}.`
    : `The clerk reads the recorded work from day ${after + 1} through day ${through}.`;
  const pages = [`${mine.length} holding${mine.length === 1 ? '' : 's'} in your name in ${village}. ${interval}`];
  const gold = (amount: number) => `${Math.round(amount * 100) / 100} gold`;
  for (const holding of mine) {
    const from = Math.max(holding.founded - 1, after);
    const facts = book.on(holding.id).filter((fact) => fact.day > from && fact.day <= through);
    const income = book.incomeOn(holding.id).filter((fact) => fact.owner === owner
      && fact.day > from && fact.day <= through);
    if (facts.length === 0) {
      pages.push(noNewMornings
        ? `${holding.kind} ${holding.id}: no new mornings of work. No wages were earned or paid on this holding.`
        : `${holding.kind} ${holding.id}: no work was recorded from day ${from + 1} through day ${through}. No wages were earned or paid on this holding.`);
    } else {
      const valued = facts.reduce((sum, fact) => sum + fact.wage, 0);
      const paid = facts.reduce((sum, fact) => sum + fact.paid, 0);
      pages.push(`${holding.kind} ${holding.id}: ${facts.length} morning${facts.length === 1 ? '' : 's'} of work. Workers earned ${gold(valued)} in wages; ${gold(paid)} changed hands. The daybook records work and wages, not crop or shop takings.`);
      const lines = facts.map((fact) => `Day ${fact.day}: ${fact.kind} — ${nameOf(fact.who)}, ${gold(fact.wage)} earned${fact.paid > 0 ? `, ${gold(fact.paid)} paid` : ', no coin moved'}.`);
      for (let i = 0; i < lines.length; i += 5) pages.push(lines.slice(i, i + 5).join('\n'));
    }
    const cattle = income.reduce((sum, fact) => sum + fact.cattle, 0);
    const crop = income.reduce((sum, fact) => sum + fact.crop, 0);
    pages.push(income.length === 0 || cattle + crop === 0
      ? `${holding.kind} ${holding.id}: no owner income was recorded for these days.`
      : `${holding.kind} ${holding.id}: ${gold(cattle + crop)} in owner takings: ${gold(cattle)} from cattle, ${gold(crop)} from crops. These are shares of payments already made, before any purse limit.`);
    const earnings = income.filter((fact) => fact.cattle + fact.crop > 0)
      .map((fact) => `Day ${fact.day}: farm earned ${gold(fact.cattle + fact.crop)} (${gold(fact.cattle)} cattle, ${gold(fact.crop)} crops).`);
    for (let i = 0; i < earnings.length; i += 5) pages.push(earnings.slice(i, i + 5).join('\n'));
  }
  return pages;
}

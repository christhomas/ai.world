import type { Probed } from './probes';
import { theBirths, theCharges, theRoll, theStones } from './records';
import { dialogueFor } from './talk';

/**
 * The handles onto the paper world: who lives where, who came from whom, and what the books say.
 *
 * Split out of `probes.ts` when that file outgrew what a person can hold in their head, and split
 * along this line because these are the probes that never touch the ground. Everything here reads
 * the register or the village's books rather than the world the hero is standing in — the roll, the
 * churchyard, the charge sheet, the family tree, a purse, whether anybody has eaten — and each of
 * them answers a question a screenshot cannot.
 *
 * They are how the economy gets checked at all. A village that simulates a hundred lives is only
 * worth having if somebody can look at them, and a browser probe is the only thing that looks at a
 * hundred lives a hundred times a day.
 */
export function installPeopleProbes(ctx: Probed): void {
  const { state, player, structures, entities, register, jail, talkCtx, commandWorld, drawLineage } = ctx;
  const debug = window as unknown as Record<string, unknown>;

  (debug as { __thin?: (village: string, n: number) => unknown }).__thin = (village, n) => commandWorld.thin(village, n);
  (debug as { __fortunes?: () => unknown }).__fortunes = () =>
    structures.villages.map((v) => ({ village: v.name, living: register.living(v.name).length, fortune: register.fortune(v.name) }));
  (debug as { __lineage?: (village?: string) => unknown }).__lineage = (village) => {
    const where = village ?? structures.villages[0]?.name;
    if (!where) return null;
    drawLineage(where);
    return { village: where };
  };
  (debug as { __pass?: (days: number) => unknown }).__pass = (days) => {
    state.day += Math.max(1, Math.floor(days));
    const changes = register.advance(state.day);
    return changes.map((c) => `day ${c.day}: ${c.name} ${c.kind}${c.cause ? ` (${c.cause})` : ''} in ${c.village}`);
  };
  (debug as { __talkTo?: (name: string) => unknown }).__talkTo = (name) => {
    const who = entities.within(player.x, player.z, 120).find((e) => e.name === name);
    if (!who) return null;
    talkCtx.day = state.day;
    const node = dialogueFor(who, talkCtx);
    return { speaker: node.speaker, pages: node.pages, choices: (node.choices ?? []).map((c) => c.label) };
  };
  /*
   * What a village's books say, without walking into the building that keeps them.
   *
   * The same numbers the clerk, the priest, the sergeant and the apothecary read out — the roll,
   * the stones, the charge sheet, the births — as rows rather than as sentences. This is how the
   * economy is checked: whether anybody is earning, whether purses grow, who is starving, who is
   * being buried and of what. A village that simulates a hundred lives is only worth having if
   * somebody can look at them.
   */
  (debug as { __records?: (village?: string) => unknown }).__records = (village) => {
    const where = village ?? structures.villages
      .map((v) => ({ name: v.name, away: Math.hypot(v.x - player.x, v.z - player.z) }))
      .sort((a, b) => a.away - b.away)[0]?.name;
    if (!where) return null;
    const today = state.day;
    return {
      village: where,
      roll: theRoll(register, where, today),
      stones: theStones(register, where, today),
      births: theBirths(register, where, today),
      // never wanted, because nobody is standing at the counter: that line is the sergeant looking
      // up at you, and there is no you here
      charges: theCharges(jail.charges(), where, today, false),
    };
  };
  (debug as { __register?: (village?: string) => unknown }).__register = (village) => {
    const here = village ?? structures.villages
      .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
      .sort((a, b) => a.d - b.d)[0]?.v.name ?? '';
    return {
      village: here, day: register.today,
      people: register.living(here).map((p) => ({
        name: p.name, sex: p.sex, trade: p.trade, born: p.born, lives: p.lives,
        // what they have and whether they have eaten: the economy is the reason for this probe as
        // much as the family tree is, and a village's health is a column of numbers
        purse: p.purse, hungry: p.hungry,
        mother: p.mother, father: p.father, knows: p.knows.length, memories: p.memories,
      })),
      /** Who this village has buried, and what took them: the other half of a population. */
      buried: register.churchyard(here).slice(-8).map((b) => ({ name: b.name, day: b.day, cause: b.cause })),
      /** Everybody the register holds, wherever they live: the whole world in one count. */
      world: (() => {
        const all = register.everybody();
        return {
          alive: all.length,
          purse: all.reduce((sum, p) => sum + p.purse, 0),
          hungry: all.filter((p) => p.hungry > 0).length,
          villages: register.settled().length,
        };
      })(),
    };
  };
}

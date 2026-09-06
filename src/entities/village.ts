import { stageOf } from '../world/people';
import type { Register } from '../world/register';
import type { Entity, Herd } from './entity';

/**
 * Keeping the people on the street the same people the register knows about.
 *
 * A village shows a handful of its residents at a time, and the register — who was born, who died,
 * who took which trade — moves on underneath them. These are the two moments where the street has
 * to be brought back into line with the book: a new day, and the law being wanted.
 *
 * Kept apart from the manager because they are about a village rather than about a creature, and
 * because they are the sort of thing somebody looks for by name.
 */

/**
 * Give the street a fresh set of faces after a day has passed.
 *
 * Somebody standing outside who has died in the night is either replaced by a neighbour who is not
 * already out, or taken off the street. Without it a village goes on showing the dead, and a player
 * who buried somebody yesterday meets them at the well this morning.
 */
export function reseatVillagers(
  herds: Iterable<Herd>, register: Register, despawn: (e: Entity) => void,
): void {
  for (const herd of herds) {
    for (const villager of [...herd.members]) {
      if (villager.person === '' || register.find(villager.person)) continue;

      const taken = new Set([...herds].flatMap((h) => h.members.map((e) => e.person)));
      const free = register.living(herd.tag)
        .find((p) => !taken.has(p.id) && stageOf(p, register.today) !== 'baby');
      if (!free) { despawn(villager); continue; }

      villager.person = free.id;
      villager.name = free.name;
      if (free.trade !== '') villager.trade = free.trade;
    }
  }
}

/**
 * Put a constable on the street in every village that has one and is not already showing it.
 *
 * A village shows only a few of its people at once, so without this the police force is usually
 * indoors when it is wanted — which reads as no police force at all rather than as bad luck. The
 * villager with least to do takes the part.
 */
export function callOutTheLaw(herds: Iterable<Herd>, register: Register): void {
  for (const herd of herds) {
    if (herd.tag === '' || herd.members.length === 0) continue;
    if (herd.members.some((e) => e.trade === 'constable')) continue;

    const shown = new Set(herd.members.map((e) => e.person));
    const law = register.living(herd.tag).find((p) => p.trade === 'constable' && !shown.has(p.id));
    if (!law) continue;

    const spare = herd.members.find((e) => e.person !== '' && e.role === 'villager');
    if (!spare) continue;
    spare.person = law.id;
    spare.name = law.name;
    spare.trade = law.trade;
  }
}

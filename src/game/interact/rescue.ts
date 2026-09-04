import { GAMEPLAY } from '../../core/config';
import { faceFor } from '../talk';
import { counts, contractFor, takenTonight, troubleNear, type Contract, type Rescues } from '../rescue';
import type { Change } from '../../world/register';
import type { Entity } from '../../entities/entity';
import type { Kindness } from '../gifts';
import type { Surroundings } from './context';

/**
 * What Enter does in front of the elder of a village that is burying too many: take the work on,
 * be reminded of it, and come back to be paid for it.
 *
 * The elder already has one errand to hand out and this is deliberately not a second one. An
 * ordinary quest is a favour; this is the village asking a stranger to stop it dying, so it comes
 * first, it says what the village can actually afford, and it is settled face to face rather than
 * by a marker going green somewhere.
 *
 * The two things that are not a conversation are here as well, because they belong to the same
 * idea and nothing else would own them: a kill out at the named place counts towards the work,
 * and a night that passes with the cause still out there costs the village people. Both are the
 * caller's to trigger, and neither is in the Enter chain.
 *
 * The rescues come in beside the rest of the surroundings rather than inside them until the field
 * is wired into `context.ts`; the rest of this file will not notice when it is.
 */
export function rescueInteractions(ctx: Surroundings & { rescues: Rescues }) {
  const {
    player, state, entities, register, structures, rescues, standing, online,
    dialogue, hud, sound, seed, persist,
  } = ctx;

  /**
   * The last day the country has been made to pay for its troubles. Held here rather than on the
   * save because the register is replayed forward from its founding anyway: a world reopened a
   * week later catches up in one go, exactly as the births and the burials do.
   */
  let lastNight = state.day;

  /** The village a person on the register belongs to, as the world generator laid it out. */
  const villageNamed = (name: string) => structures.villages.find((v) => v.name === name) ?? null;

  /** The nearest elder standing in the street, or null. */
  const elderNear = (): Entity | null => {
    for (const e of entities.within(player.x, player.z, GAMEPLAY.TALK_RANGE)) {
      if (e.role === 'elder' && !e.indoors) return e;
    }
    return null;
  };

  /**
   * What a village is offering, or null. The fortune comes off the register, which is the only
   * place that knows how many of them are left.
   */
  const contractIn = (name: string): Contract | null => {
    const village = villageNamed(name);
    if (!village) return null;
    return contractFor(seed, village, structures, register.fortune(name));
  };

  /** Hand over what was agreed, in coin or in the only other currency a village has. */
  const settleUp = (contract: Contract): void => {
    const settled = rescues.settle(contract, state.day);
    if (!settled) return;
    state.inventory.gold += settled.gold;
    state.version++;
    // a village that could pay nothing has done the largest good in the game a favour, and the
    // scale is the only place that can say so out loud
    if (standing.gave(settled.goodwill)) hud.flash(`The country has changed its mind about you: ${standing.words}.`);
    state.standing = standing.value;
    sound.jingle();
    hud.flash(settled.words);
    persist();
  };

  /** The village has agreed to this, and everybody in the square knows it. */
  const agree = (contract: Contract): void => {
    rescues.take(contract, state.day);
    state.version++;
    sound.chime();
    hud.flash(`${contract.trouble.said}, out at ${contract.trouble.place}, ${contract.trouble.dir} of ${contract.village}.`);
    persist();
  };

  /**
   * Enter in front of an elder whose village is losing people. Anybody else, and any elder whose
   * village is doing well enough, falls through to the ordinary conversation exactly as before.
   */
  const tryRescue = (): boolean => {
    const e = elderNear();
    if (!e) return false;
    const name = e.herd.tag;
    const contract = contractIn(name);
    if (!contract) return false;

    const speaker = `Elder ${e.name}`;
    const emoji = '🧓';
    const face = faceFor(e, { register, day: state.day });

    if (rescues.owed(name)) {
      dialogue.start({ speaker, emoji, face, pages: contract.done.slice(0, -1), choices: [
        { label: 'Take what they can give', next: () => { settleUp(contract); return null; } },
      ] });
      return true;
    }
    if (rescues.taken(name)) {
      const left = rescues.left(contract.trouble);
      dialogue.start({ speaker, emoji, face, pages: [
        contract.reminder,
        left > 1 ? `There are ${left} of them left out there, by our counting.` : 'One more, and we will believe it.',
      ] });
      return true;
    }
    dialogue.start({ speaker, emoji, face, pages: contract.intro, choices: [
      { label: 'I will go', next: () => { agree(contract); return { speaker, emoji, face, pages: ['Then go now, and come back to me.'] }; } },
      { label: 'Not today', next: () => ({ speaker, emoji, face, pages: ['Then we will bury another one, and ask the next stranger.'] }) },
    ] });
    return true;
  };

  /**
   * Something was killed out in the country. Whichever village asked for exactly this, at exactly
   * this place, is one nearer to being able to sleep.
   */
  const onKill = (kind: string, x: number, z: number): void => {
    for (const village of structures.villages) {
      if (!rescues.taken(village.name) || !rescues.stands(village.name)) continue;
      const trouble = troubleNear(seed, village, structures);
      if (!trouble || !counts(trouble, kind, x, z)) continue;
      const left = rescues.strike(trouble);
      sound.chime();
      hud.flash(left > 0
        ? `That is one. ${left} more before ${village.name} will sleep.`
        : `It is finished. Go and tell ${village.name}.`);
      persist();
    }
  };

  /**
   * The nights the world has just lived through, in the villages that have something out there.
   * Hands back the deaths so the caller can put them on the log and in the chat beside the ones
   * the register worked out for itself.
   *
   * Only villages the register has been told about can lose anybody, which is the register's own
   * rule and not a new one: a place nobody has walked into has no people in it yet.
   */
  const nightfall = (): Change[] => {
    const changes: Change[] = [];
    while (lastNight < Math.floor(state.day)) {
      lastNight++;
      for (const name of register.settled()) {
        if (!rescues.stands(name)) continue;
        const village = villageNamed(name);
        const trouble = village ? troubleNear(seed, village, structures) : null;
        if (!trouble) continue;
        for (const who of takenTonight(seed, trouble, register.living(name), lastNight)) {
          const death = register.bury(who, lastNight);
          if (!death) continue;
          changes.push(death);
          online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
        }
      }
    }
    return changes;
  };

  /**
   * The standing arrangement a village made with somebody who saved it, for whoever has to honour
   * it at the inn door or the apothecary's counter. Shaped like `favourFrom` in gifts.ts, because
   * it is the same idea one street wider: a village that owes you does not go back to charging.
   */
  const welcomeAt = (village: string): Kindness | null => rescues.welcomeIn(village);

  return { tryRescue, onKill, nightfall, welcomeAt };
}

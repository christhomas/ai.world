import { GAMEPLAY } from '../../core/config';
import { Biome } from '../../world/biomes';
import type { Person } from '../../world/people';
import type { Entity } from '../../entities/entity';
import { worthOf, type Gifts, type Kindness } from '../gifts';
import { ITEMS } from '../items';
import { tradableItems } from '../online';
import { faceFor } from '../talk';
import type { Surroundings } from './context';

/**
 * Giving something to somebody who lives here.
 *
 * The same gesture as offering goods to another player, pointed at a villager instead, so it
 * hangs off the same key and reads the same way: stand beside somebody, look at what is in the
 * pack, hand one thing over. What is different is only that this one is remembered.
 *
 * The choices are sorted by what they would want most, which is the whole system taught without
 * a word of explanation: walk up to a soldier and the sword is at the top of the list.
 */

const GIVING = {
  /** How many things to put in front of the player. More than this is a menu, not a decision. */
  SHOWN: 6,
  /** How close you have to stand. The same reach as talking, because it is the same gesture. */
  REACH: GAMEPLAY.TALK_RANGE,
} as const;

/**
 * The two things a gift needs that Surroundings does not carry yet: who you have been good to,
 * and the scale that generosity nudges. Both belong in context.ts beside `handover`; until they
 * are there this says so in one place rather than making a private copy of either, which would be
 * a friendship nobody remembers tomorrow.
 */
type Giving = Surroundings & {
  gifts: Gifts;
  standing: { gave(by: number): boolean; words: string; value: number };
};

export function giftInteractions(ctx: Surroundings) {
  const { player, state, entities, register, structures, dialogue, hud, sound, online, persist } = ctx;
  const { gifts, standing } = ctx as Giving;

  /** The nearest person who actually lives here, as opposed to the nearest wolf. */
  const nearestResident = (): { e: Entity; person: Person } | null => {
    for (const e of entities.within(player.x, player.z, GIVING.REACH)) {
      if (e.indoors || e.person === '') continue;
      const person = register.find(e.person);
      if (person) return { e, person };
    }
    return null;
  };

  /** The country somebody lives in, which decides half of what a gift is worth to them. */
  const homeOf = (person: Person): Biome =>
    structures.villages.find((v) => v.name === person.village)?.biome ?? Biome.Plains;

  /** Take up whatever they have put by, in whatever coin their trade keeps. */
  const takeFavour = (name: string, person: Person, favour: Kindness): void => {
    if (!gifts.claim(person, state.day)) return;
    if (favour.kind === 'goods') {
      state.give(favour.item, favour.count);
      sound.jingle();
      hud.flash(`${name} ${favour.words}`);
    } else if (favour.kind === 'word') {
      standing.gave(favour.standing);
      state.standing = standing.value;
      sound.chime();
      hud.flash(`${name} ${favour.words} People are calling you ${standing.words}.`);
    }
    persist();
  };

  /** Hand one thing over, and say how it was taken. */
  const handOver = (name: string, person: Person, itemId: string): void => {
    const given = gifts.give(state, person, homeOf(person), itemId, state.day, online.name);
    if (!given) { hud.flash('You are not carrying that.'); return; }
    sound.chime();
    hud.flash(`${name} ${given.words}`);
    if (given.turned) hud.flash(`${name} counts you ${gifts.wordsFor(person.id)} now.`);
    // said last so it is the line left on the screen: the country changing its mind about you is
    // the larger of the two pieces of news, however quietly it happened
    const moved = standing.gave(given.standing);
    state.standing = standing.value;
    if (moved) hud.flash(`People are beginning to call you ${standing.words}.`);
    persist();
  };

  /**
   * Enter beside somebody who lives here: offer them something out of the pack, and collect
   * whatever they have put by for you if you two stand that way.
   */
  const tryGive = (): boolean => {
    const near = nearestResident();
    if (!near) return false;
    const { e, person } = near;
    const biome = homeOf(person);

    // sorted by what this person would want most, which is the whole judgement made visible
    const worth = (id: string): number => worthOf(ITEMS[id], person, biome, state.day);
    const goods = tradableItems(state).sort((a, b) => worth(b[0]) - worth(a[0])).slice(0, GIVING.SHOWN);

    const favour = gifts.favourFrom(person);
    const spare = gifts.spareToday(person, state.day);
    const pages = [`${e.name} counts you ${gifts.wordsFor(person.id)}.`];
    if (favour && !spare) pages.push(`${e.name} ${favour.words}`);
    pages.push(goods.length > 0 ? 'What do you hand over?' : 'You have nothing in the pack to give.');

    dialogue.start({
      speaker: e.name, emoji: '🎁', face: faceFor(e, { register, day: state.day }), pages,
      choices: [
        ...(spare ? [{ label: `Take what ${e.name} put by`, next: () => { takeFavour(e.name, person, spare); return null; } }] : []),
        ...goods.map(([id, n]) => ({
          label: `Give ${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (of ${n})` : ''}`,
          next: () => { handOver(e.name, person, id); return null; },
        })),
        { label: 'Never mind', next: () => null },
      ],
    });
    return true;
  };

  return { tryGive };
}

import { GAMEPLAY } from '../../core/config';
import { HIRE, quoteFor, wordsFor, type Bargain, type Hires, type Quote, type Terms } from '../hire';
import { faceFor } from '../talk';
import type { Entity } from '../../entities/entity';
import type { Surroundings } from './context';

/**
 * What Enter does in front of a soldier: agree a price, and later agree to part.
 *
 * Standing in front of somebody who is for hire is the only place the question can sensibly be
 * asked, so a willing soldier answers with his price rather than with the weather. Everybody else
 * on the register, and every soldier who will not leave his gate, falls through to the ordinary
 * conversation exactly as before.
 *
 * The hires come in beside the rest of the surroundings rather than inside them until the field
 * is wired into `context.ts`; the rest of this file will not notice when it is.
 */
export function hireInteractions(ctx: Surroundings & { hires: Hires }) {
  const {
    player, state, entities, register, structures, hires, online, dialogue, hud, sound, seed, persist,
  } = ctx;

  /**
   * The side a soldier hired here is fighting for. Asked as a question rather than assumed to be
   * the hero, because the same road will shortly have somebody else's hired men on it.
   */
  const side = (): string => online.id || HIRE.ALONE;

  /** Whose face to draw, when the speaker is somebody the register knows. */
  const speakerFor = (e: Entity) => faceFor(e, { register, day: state.day });

  /** The village somebody belongs to, which is what sets the going rate there. */
  const homeOf = (village: string) => structures.villages.find((v) => v.name === village) ?? null;

  /** The nearest person on the register who is out on the street to be spoken to. */
  const nearestResident = (): Entity | null => {
    for (const e of entities.within(player.x, player.z, GAMEPLAY.TALK_RANGE)) {
      if (e.person !== '' && !e.indoors) return e;
    }
    return null;
  };

  /** Take one soldier on, if the purse runs to it. */
  const agree = (e: Entity, quote: Quote, terms: Terms): void => {
    const bargain = hires.strike(quote, terms, state.inventory.gold, side());
    if (!bargain) {
      // a refusal costs nothing: the fee is still in the purse and he is still watching the road
      sound.thud();
      hud.flash(`${quote.name} looks at what you are carrying, and goes back to watching the road.`);
      return;
    }
    state.inventory.gold -= bargain.fee;
    state.version++;
    // a man's trade is what decides his day, so buying his day is a change of trade
    e.trade = HIRE.TREE;
    sound.chime();
    hud.flash(`${bargain.name} falls in beside you: ${wordsFor(bargain)}.`);
    persist();
  };

  /** What one soldier is asking, and the three ways of settling it. */
  const offerTerms = (e: Entity, quote: Quote): void => {
    dialogue.start({
      speaker: quote.name, emoji: '⚔️', face: speakerFor(e),
      pages: [
        'Coin buys a sword arm, if you were asking.',
        `${quote.asking} gold is what a day of me is worth. Take it whichever way suits you.`,
      ],
      choices: [
        ...quote.terms.map((terms) => ({
          label: wordsFor(terms),
          next: () => { agree(e, quote, terms); return null; },
        })),
        { label: 'Not today', next: () => null },
      ],
    });
  };

  /** The one already walking with you: what was agreed, and how to end it. */
  const partCompany = (e: Entity, bargain: Bargain): void => {
    dialogue.start({
      speaker: bargain.name, emoji: '⚔️', face: speakerFor(e),
      pages: [`We said ${wordsFor(bargain)}. Say the word and I will turn back for the gate.`],
      choices: [
        { label: 'Part company here', next: () => {
          hires.part(bargain.who);
          // back to whatever day his own trade gives him, wherever he is standing when it ends
          e.trade = register.find(bargain.who)?.trade ?? HIRE.TRADE;
          sound.select();
          hud.flash(`${bargain.name} turns for home. What you paid is paid.`);
          persist();
          return null;
        } },
        { label: 'Keep walking', next: () => null },
      ],
    });
  };

  /**
   * Enter in front of somebody: your own hired man, or a soldier who would be. Anybody else, and
   * anybody already in somebody else's pay, is left to the ordinary conversation.
   */
  const tryHire = (): boolean => {
    const e = nearestResident();
    if (!e) return false;

    const mine = hires.roster(side()).find((b) => b.who === e.person);
    if (mine) { partCompany(e, mine); return true; }
    if (hires.has(e.person)) return false;      // somebody else's sword arm is their business

    const person = register.find(e.person);
    const village = person ? homeOf(person.village) : null;
    const quote = person && village ? quoteFor(seed, person, village) : null;
    if (!quote) return false;
    offerTerms(e, quote);
    return true;
  };

  /**
   * Coin has come in: a kill, or the bottom of a chest. Whoever is walking with you on those terms
   * takes their cut of it before you have finished counting, which is what agreeing a share meant.
   */
  const takeShare = (gold: number): void => {
    if (gold <= 0) return;
    const payout = hires.divide(gold, side());
    if (payout.paid <= 0) return;
    state.inventory.gold -= payout.paid;
    state.version++;
    hud.flash(`${payout.cuts.map((c) => `${c.name} takes ${c.gold}`).join(', ')} of it.`);
    persist();
  };

  /**
   * Put the hired back on the tree they are following.
   *
   * A villager is despawned as soon as you walk far enough off and spawned again later as somebody
   * with their own working day, so a bargain has to be pressed back onto whoever is standing there
   * now; the register is what says which day they had before you bought it. Cheap enough for a
   * slow tick, and not worth doing every frame.
   */
  const muster = (): void => {
    for (const e of entities.within(player.x, player.z, HIRE.EARSHOT)) {
      if (e.person === '') continue;
      const own = register.find(e.person)?.trade ?? '';
      if (own === '') continue;
      e.trade = hires.follows(e.person, own);
    }
  };

  /**
   * A hired man has been killed. He comes off the register like any other villager, and the people
   * who knew him are left to tell you about it; all that happens here is that the bargain ends.
   */
  const fallen = (who: string): Bargain | null => hires.part(who);

  /** Who is walking with you, and on what terms. */
  const hireMenu = (): void => {
    const roster = hires.roster(side());
    dialogue.start({
      speaker: 'Your Company', emoji: '⚔️',
      pages: [
        `You have ${hires.describe(side())}.`,
        ...roster.map((b) => `${b.name}: ${wordsFor(b)}.`),
      ],
      choices: [{ label: 'Close', next: () => null }],
    });
  };

  return { tryHire, takeShare, muster, fallen, hireMenu };
}

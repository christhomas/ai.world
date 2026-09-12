import { GAMEPLAY } from '../../core/config';
import { buy, give, holds } from '../../world/deeds';
import { personTill } from '../tills';
import { HIRE, ORDERS, quoteFor, wordsFor, type Bargain, type Hires, type Order, type Quote, type Terms } from '../hire';
import { faceFor } from '../talk';
import { COMPANY } from '../../entities/manager';
import { bodyForTrade } from '../../entities/trades';
import { hashString } from '../../core/rng';
import { StructureKind } from '../../world/structures';
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
    player, state, entities, register, structures, hires, online, places, dialogue, hud, sound, seed, persist,
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

  /** The nearest watchtower worth pointing at, or nothing if there is none in sight. */
  const towerNear = (): { x: number; z: number } | null => {
    let best: { x: number; z: number } | null = null;
    let away = TOWER_IN_SIGHT;
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Tower) continue;
      const off = Math.hypot(poi.x - player.x, poi.z - player.z);
      if (off > away) continue;
      away = off;
      best = { x: poi.x, z: poi.z };
    }
    return best;
  };

  /** The nearest person on the register who is out on the street to be spoken to. */
  const nearestResident = (): Entity | null => {
    for (const e of entities.within(player.x, player.z, GAMEPLAY.TALK_RANGE)) {
      if (e.person !== '' && !e.indoors) return e;
    }
    return null;
  };

  /** Take one soldier on, if the purse runs to it. */
  const agree = (e: Entity, quote: Quote, terms: Terms): void => {
    const bargain = hires.strike(quote, terms, state.inventory.gold, side(), state.day);
    if (!bargain) {
      // a refusal costs nothing: the fee is still in the purse and he is still watching the road
      sound.thud();
      hud.flash(`${quote.name} looks at what you are carrying, and goes back to watching the road.`);
      return;
    }
    // to the man himself. A fee that left the world was a soldier who fought for nothing and a
    // village no richer for having a sword in it worth buying
    buy(holds(state.inventory), personTill(ctx.register, e.person), bargain.fee);
    state.version++;
    // a man's trade is what decides his day, so buying his day is a change of trade
    e.trade = HIRE.TREE;
    sound.chime();
    hud.flash(`${bargain.name} falls in beside you: ${wordsFor(bargain)}, for ${HIRE.TERM} days.`);
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

/**
 * What you can tell a man in your pay, in the words you would tell him in.
 *
 * A list rather than three choices written out where they are used, because the words and the
 * orders have to stay together: a button reading "Wait here" that sends `fight` is the kind of
 * mistake that only shows up as a bear eating somebody.
 */
const ORDER_WORDS: ReadonlyArray<{ order: Order; said: string }> = [
  { order: ORDERS.FOLLOW, said: 'Stay at my shoulder' },
  { order: ORDERS.HOLD, said: 'Wait here' },
  { order: ORDERS.FIGHT, said: 'Go in first' },
  { order: ORDERS.WATCH, said: 'Take the tower' },
];

/**
 * How far a tower may be and still be the tower he is being told to take, in tiles.
 *
 * Far enough that you can point at one you can see, and near enough that "take the tower" is never
 * an order to walk half a day. Out of sight of one, the choice is not offered at all — which is
 * better than a man agreeing and then setting off over the horizon.
 */
const TOWER_IN_SIGHT = 70;

  /** The one already walking with you: what was agreed, how long is left, and how to end it. */
  const partCompany = (e: Entity, bargain: Bargain): void => {
    const left = Math.max(0, Math.ceil(bargain.until - state.day));
    const again = hires.askingAgain(bargain);
    const nearly = hires.nearlyUp(bargain.who, state.day);
    dialogue.start({
      speaker: bargain.name, emoji: '⚔️', face: speakerFor(e),
      pages: [
        `We said ${wordsFor(bargain)}. Say the word and I will turn back for the gate.`,
        nearly
          ? `That is the last of the days you paid for. ${again} gold keeps me another ${HIRE.TERM}, if you want me.`
          : `${left === 1 ? 'One day' : `${left} days`} of me left on what you paid.`,
      ],
      choices: [
        ...ORDER_WORDS
          .filter(({ order }) => order !== hires.orderFor(bargain.who))
          // a man cannot be sent to a tower that is not there, so the order is not offered
          .filter(({ order }) => order !== ORDERS.WATCH || towerNear() !== null)
          .map(({ order, said }) => ({
          label: said,
          next: () => {
            // where he is standing when he is told, for the orders that mean somewhere. "Wait" and
            // "wait *there*" are different instructions, and the second is the one anybody means.
            // "Take the tower" means a particular tower, which is the nearest one either of you
            // can see
            const at = order === ORDERS.HOLD ? { x: e.x, z: e.z }
              : order === ORDERS.WATCH ? towerNear() ?? undefined
              : undefined;
            hires.tell(side(), bargain.who, order, at);
            e.told = hires.toldTo(bargain.who);
            sound.select();
            hud.flash(`${bargain.name}: ${said.toLowerCase()}.`);
            persist();
            return null;
          },
        })),
        // only while it is nearly up: a man does not ask to be paid again on the first morning
        ...(nearly ? [{ label: `Keep him on (${again}g)`, next: () => {
          if (state.inventory.gold < again) {
            sound.thud();
            return { speaker: bargain.name, emoji: '⚔️', pages: [`${again} gold, and you have ${state.inventory.gold}. I will wait as long as the day does.`] };
          }
          // the same act as striking it in the first place, and paid the same way: to the man
          buy(holds(state.inventory), personTill(ctx.register, e.person), again);
          hires.extend(bargain.who, state.day);
          state.version++;
          sound.chime();
          hud.flash(`${bargain.name} stays on, another ${HIRE.TERM} days.`);
          persist();
          return null;
        } }] : []),
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
    // each man takes his own cut into his own purse, which is what agreeing a share meant. `who`
    // is his row on the register, so it is still his the week after you part company
    for (const cut of payout.cuts) give(holds(state.inventory), personTill(ctx.register, cut.who), cut.gold);
    state.version++;
    hud.flash(`${payout.cuts.map((c) => `${c.name} takes ${c.gold}`).join(', ')} of it.`);
    persist();
  };

  /**
   * The bodies this client stands up for the men it has paid, by the id on the register.
   *
   * Empty in a game where the villagers are this page's own, which is a game with nothing behind
   * it: there is a body in the street already and the bargain is pressed onto it.
   */
  const company = new Map<string, Entity>();

  /**
   * Put the hired back on the tree they are following.
   *
   * A villager is despawned as soon as you walk far enough off and spawned again later as somebody
   * with their own working day, so a bargain has to be pressed back onto whoever is standing there
   * now; the register is what says which day they had before you bought it. Cheap enough for a
   * slow tick, and not worth doing every frame.
   */
  const muster = (): void => {
    /*
     * Whose day has come.
     *
     * Done here rather than on a clock of its own because this already runs on the slow tick and
     * already walks the people near you, and because the one thing that must happen when a bargain
     * ends is that the man standing there stops following you — which is a `trade` on an entity,
     * which is what this loop is for.
     *
     * He is told about out loud. A man who leaves without a word is indistinguishable from a man
     * who has fallen down a hole, and the difference matters to somebody about to walk into a
     * fight expecting two swords.
     */
    for (const gone of hires.ranOut(state.day)) {
      hud.flash(`${gone.name} has served the days you paid for, and turns for home.`);
      const body = entities.within(player.x, player.z, HIRE.EARSHOT).find((e) => e.person === gone.who);
      if (body) body.trade = register.find(gone.who)?.trade ?? HIRE.TRADE;
      persist();
    }
    for (const e of entities.within(player.x, player.z, HIRE.EARSHOT)) {
      if (e.person === '') continue;
      const own = register.find(e.person)?.trade ?? '';
      if (own === '') continue;
      e.trade = hires.follows(e.person, own);
      // and what he has been told, pressed back on for the same reason his trade is: the body is
      // destroyed when you walk off and built again later, so the contract is what remembers and
      // this is the copy the tree can read
      // empty for the standing arrangement as well as for everybody who is nobody's, so there is
      // one state for "nobody has told him anything" rather than two. The `told` ask matches
      // nothing against an empty string, which is what makes an unbidden man behave exactly as he
      // did before there were orders at all
      e.told = hires.toldTo(e.person);
    }
    if (entities.toldWhatLives) keepTheCompany();
    else disbandTheCompany();
  };

  /**
   * Stand up the men this page has hired, where the villagers belong to a world.
   *
   * A hired man leaves his village, and that is not a figure of speech — it is the reason this
   * exists. He follows *you*: indoors, down a staircase into a cellar the world has never grown,
   * onto a boat it does not know the position of, and past three other players it would have to
   * choose between if it were the one walking him. None of that is a thing a shared world can do,
   * and all of it is a thing this page does for the horse and the boat already.
   *
   * So the world is told to take him off the street and this page stands one of its own up in his
   * place — the same man off the same register, wearing the body his trade wears, walking the tree a
   * bought day gives him. When the bargain ends he is despawned here and the world puts him back
   * where he came from, which is a village that has been one man short for as long as you had him.
   */
  const keepTheCompany = (): void => {
    // Not while the hero is somewhere they cannot follow him. A hired man walks the country; he does
    // not come down a staircase or into a shop, and the hero's coordinates in either of those are a
    // different world's — putting him beside them would drop a soldier into a field at whatever
    // point of the map a cellar happens to be laid out around.
    if (places.indoors !== null || places.underground) return;
    const roster = hires.roster(side());
    const paid = new Set(roster.map((b) => b.who));
    for (const [who, body] of [...company]) {
      if (paid.has(who) && !body.dead && body.dying <= 0) {
        // and if the hero got somewhere in one step that no walk could cover — a teleport, a
        // staircase, a landing off a ferry — the man he is paying catches up. Out past earshot he is
        // frozen along with the rest of the far country, so without this he stands where he was left
        // for the rest of the game, which is not what being in somebody's pay looks like.
        if (Math.hypot(body.x - player.x, body.z - player.z) > HIRE.EARSHOT) {
          body.x = player.entity.x;
          body.z = player.entity.z;
        }
        continue;
      }
      entities.despawnEntity(body);
      company.delete(who);
      online.retain(who, false);
    }
    for (const bargain of roster) {
      if (company.has(bargain.who)) continue;
      const person = register.find(bargain.who);
      if (!person) continue;
      // where the world is still drawing him, if it is, so he does not blink across the square on
      // the way into your pay; beside the hero otherwise, which is where somebody you hired belongs
      const drawn = entities.within(player.x, player.z, HIRE.EARSHOT).find((e) => e.person === bargain.who);
      const at = drawn ?? player.entity;
      const [stood] = entities.spawnPack(
        bodyForTrade(person.trade, person.sex), at.x, at.z, 0, seed ^ hashString(bargain.who), COMPANY, 1,
      );
      if (!stood) continue;
      stood.person = person.id;
      stood.name = person.name;
      stood.role = 'villager';
      stood.trade = HIRE.TREE;
      stood.herd.tag = person.village;
      company.set(bargain.who, stood);
      online.retain(bargain.who, true);
    }
  };

  /**
   * The world has stopped talking, so the villages are this page's own again.
   *
   * The men in your pay go back to being what they were before there was anything to tell: whoever
   * the street happens to be showing, with the bargain pressed onto him by `muster` above. Nothing
   * is said to anybody, because there is nobody to say it to — that is what the silence means.
   */
  const disbandTheCompany = (): void => {
    for (const body of company.values()) entities.despawnEntity(body);
    company.clear();
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

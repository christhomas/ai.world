import { whoIsAsked, whoWantsSomething, wouldBringItTo } from '../world/wants';
import type { Rng } from '../core/rng';
import { capitalise, pick, stepWithin } from './dials';
import { shopDialogue } from './counter';
import { personTill } from './tills';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueChoice, DialogueNode, Speaker } from '../ui/dialogue';
import { ITEMS } from './shops';
import { CLERK_LINES, CONGREGATION_LINES, HOW_PEOPLE_GET_BY, SERGEANT_LINES } from './talkwords';
import type { Biome } from '../world/biomes';
import type { GameState } from './state';
import type { Quest } from './quests';
import { gossipFor } from './gossip';
import { bookRows, type Enquiry, type Keeper } from './enquiry';
import { grownUp, type Person } from '../world/people';
import { whoTheyCameFrom } from './descent';
import type { Register } from '../world/register';

export interface TalkCtx {
  state: GameState;
  /** Fraction of the day; shops keep hours. */
  time: number;
  rng: Rng;
  /** Quest offered by each village, keyed by village name. */
  quests: Map<string, Quest>;
  /** Called after a purchase so the HUD and save can refresh. */
  onInventoryChange: () => void;
  /** Called when a quest is accepted or completed. */
  onQuestChange: (quest: Quest, status: 'active' | 'done') => void;
  /** The inn's post shelf, when this world is shared with other people. */
  post?: Post;
  /** Taking a room for the night, which only an innkeeper can offer. */
  room?: Room;
  /**
   * What this village adds to a price for the look of you, as a share. A shopkeeper who has heard
   * what you did to somebody's animals takes their opinion out of your purse.
   */
  markup?: number;
  /** Being patched up, which only a doctor can offer. */
  mending?: Mending;
  /** What country this counter stands in: a fur is worth more in one with no wolves. See `furs.ts`. */
  country?: () => Biome;
  /**
   * The books kept in the room this conversation is happening in, when it is a room that keeps
   * any: the churchyard's stones, the apothecary's births.
   *
   * Set by whoever opens the conversation rather than worked out here, because it turns on where
   * the hero is standing and a dialogue has never known that. A priest asked the same question in
   * the street has no book with him and says so by not offering.
   */
  enquiry?: Enquiry;
  /** Who lives in the villages, so a resident can talk about their family and their losses. */
  register?: Register;
  /** The day it is, which is how long ago something was. */
  day?: number;
  /** What this villager has heard about Old Nettle, for the rare occasion they bring him up. */
  wordOfHim?: (person: Person) => string;
  /**
   * What this person's village believes about the mine it works, which is belief and not fact.
   *
   * A mine somebody cleared out last week is still spoken of as a death trap until word gets
   * back, and that is the point of routing it through what people say rather than through what
   * the mine is: the gap between the two is the thing the player closes by walking home.
   */
  saidOfMine?: (village: string) => string;
  /**
   * Wood carried in and sold at this counter, landed in the village it was sold in.
   *
   * A market stall already did this and a shop counter did not, which made where you happened to be
   * standing decide whether the village could build with what you sold it. Handed in rather than
   * reached for, because a dialogue has never known which village's books it is writing to — the
   * caller knows, and this file only knows that wood changed hands.
   */
  yard?: (village: string, logs: number) => void;
}

/**
 * Inns keep a shelf of parcels. Anything left there is addressed to a name, so it waits for
 * somebody who is not online, and any inn in the world will hand it over.
 */
export interface Post {
  /** Everyone this world has seen, minus you. */
  folk: string[];
  /** Ask for whatever is under your name. */
  collect: () => void;
  /** Leave one of something, with a little gold if you like, for somebody. */
  send: (to: string, itemId: string, gold: number) => void;
}

/**
 * A bed for the night. Sleeping is the answer to a long dark: full hearts, a locked door, and
 * morning. In a world shared with other people the night belongs to everybody, so it cannot be
 * skipped — there you get the bed and the healing, and the hours pass at their own pace.
 */
export interface Room {
  price: number;
  /** True when the world's clock is somebody else's to move. */
  shared: boolean;
  /** Take the room. Returns what to say about it. */
  take: () => string;
  /**
   * Leave the world from here, which is the only clean way out of it.
   *
   * A bed is where a body can be left. Everywhere else the hero is standing in a field when the
   * tab is closed, and #262 has to put him back exactly there; in a bed he is somewhere that can
   * be described, and the save says so. So the one place the game offers to quit is the one place
   * quitting is tidy.
   */
  leave: () => void;
}

/** How often a villager brings up Old Nettle unprompted. Rare, so it stays a thing people say. */
const WORD_OF_HIM = 0.22;

/** Below this much gold, somebody will tell you how people here get by. */
const POOR = 60;   // a hero starts with fifty, so the first person they meet tells them

/** What a doctor asks, and what waiting instead costs you. */
export const DOCTOR = {
  /** Gold a heart's worth of mending costs, which is less than a salve and much less than dying. */
  A_HEART: 7,
  /**
   * Hours the free kind takes. Long enough to lose a morning and to be worth paying to avoid,
   * short enough that having no money is an inconvenience rather than a punishment.
   */
  WAITING: 6,
} as const;

/**
 * A doctor's terms, which are the same terms they give their own village.
 *
 * Paid care is quick. The free kind costs you hours instead of coin, and the hours are real: the
 * clock winds forward and the world moves on without you. That is the whole of the doctor's
 * economy, and it means nobody who asks for help ever has to die of not having any money.
 */
export interface Mending {
  /** What they would charge, which is nothing at all for somebody they are in debt to. */
  price: number;
  /** Hearts they would put back. */
  hearts: number;
  /** How long the free kind takes, in hours of the world's clock. */
  hours: number;
  /** Be treated. Returns what to say about it. */
  take: (paid: boolean) => string;
}



/**
 * A drawn face for whoever is speaking, when they are somebody who lives here. A wolf has no
 * face on the register and keeps the emoji it always had.
 */
export function faceFor(e: Entity, ctx: { register?: Register; day?: number }): Speaker | undefined {
  const person = e.person !== '' ? ctx.register?.find(e.person) : undefined;
  if (person) {
    // a drawn face has two sizes and old age is not one of them: an elder gets the grown one,
    // which is what `grownUp` is for. See `portrait.ts`
    return {
      id: person.id, trade: person.trade || e.trade, stage: grownUp(person, ctx.day ?? 1) ? 'adult' : 'child',
      from: whoTheyCameFrom(person, ctx.register, ctx.day ?? 1),
    };
  }
  // a shopkeeper stands behind their counter rather than living on the register, but they are
  // still a person, so their name and their shop are enough to grow a face from
  if (e.kind.id !== 'villager' && e.kind.id !== 'traveller') return undefined;
  return { id: `${e.name}:${e.shop ?? e.role}`, trade: e.trade || e.shop || '', stage: 'adult' };
}

/** Build the conversation tree for whoever the player is talking to. */
export function dialogueFor(e: Entity, ctx: TalkCtx): DialogueNode {
  const k = e.kind;
  if (e.role === 'shopkeeper' && e.shop) return shopDialogue(e, ctx);
  // a doctor with somebody bleeding in front of them attends to that first, even if the village
  // also made them its elder: the errand will still be there once you can stand up straight
  if (e.trade === 'doctor' && ctx.mending && ctx.mending.hearts > 0) return doctorDialogue(e, ctx);
  if (e.role === 'elder') {
    const q = ctx.quests.get(e.herd.tag);
    if (q) return questDialogue(e, q, ctx);
  }

  if (e.role === 'congregation') return chapelDialogue(e, ctx);
  if (e.role === 'keeper') return deskDialogue(e, ctx);
  if (k.id === 'villager' || k.id === 'traveller') {
    const greeting = pick(ctx.rng, ['Hello there!', 'Oh! Hello.', 'Well met, traveller.']);
    return {
      speaker: e.name, emoji: k.emoji, face: faceFor(e, ctx),
      pages: [greeting, ...residentPages(e, ctx, e.line(ctx.rng))],
    };
  }
  return { speaker: `${e.name} the ${k.label}`, emoji: k.emoji, pages: [e.line(ctx.rng)] };
}

/**
 * Somebody at the chapel: the few gathered outside the door, and the priest stood at the altar.
 *
 * The book is what separates them: the priest is in the room where the parish keeps its dead and
 * can be asked about them, and the congregation on the step can only say it is quieter here than
 * the square. Neither is checked against where the hero stands — an enquiry only ever arrives when
 * he is already in the room.
 */
function chapelDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const who: Keeper = {
    speaker: e.trade === 'priest' ? `${e.name}, the Priest` : e.name,
    emoji: e.kind.emoji,
    face: faceFor(e, ctx),
  };
  return acrossACounter(who, ['Hello, traveller.', ...residentPages(e, ctx, pick(ctx.rng, CONGREGATION_LINES))], ctx);
}

/**
 * The clerk at the town hall and the sergeant at the watch house.
 *
 * One function for both, because they are one job: somebody stood behind a counter that is not a
 * shop's, with the book their building keeps behind them. Which book that is, this does not know
 * and must not — it is decided by the door the hero walked through, and arrives here already
 * decided, in `ctx.enquiry`.
 */
function deskDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const clerk = e.trade === 'clerk';
  const who: Keeper = {
    speaker: `${e.name}, the ${clerk ? 'Clerk' : 'Sergeant'}`,
    emoji: clerk ? '📜' : '🔒',
    face: faceFor(e, ctx),
  };
  return acrossACounter(who, [pick(ctx.rng, clerk ? CLERK_LINES : SERGEANT_LINES)], ctx);
}

/**
 * Somebody with a book behind them, and the rows for asking to see it.
 *
 * The greeting is settled once and said again on every return to it. Rebuilding it would draw a
 * fresh piece of small talk each time the player backed out of the book, so a priest who had just
 * told you about his sister would greet you by telling you about somebody else.
 */
function acrossACounter(who: Keeper, pages: string[], ctx: TalkCtx): DialogueNode {
  const enquiry = ctx.enquiry;
  if (!enquiry) return { ...who, pages };
  const root = (): DialogueNode => ({
    ...who,
    pages,
    choices: [...bookRows(who, enquiry, root), { label: 'Leave', next: () => null }],
  });
  return root();
}

/**
 * What somebody who lives here says, as opposed to what a villager-shaped thing says.
 *
 * A death they are still carrying comes first, because it would: it is the thing on their mind.
 * After that they will tell you about their family or point you at somebody worth meeting, and
 * only then fall back on the line their trade always gives.
 */
function residentPages(e: Entity, ctx: TalkCtx, fallback: string): string[] {
  if (e.person === '' || !ctx.register) return [fallback];
  const person = ctx.register.find(e.person);
  if (!person) return [fallback];

  /*
   * What they want from you, before anything they merely have to say.
   *
   * It leads, and that is the point of it: somebody who has walked over because the barrow on the
   * ridge takes everybody who goes in does not open with the weather. Everything below this is
   * small talk, and small talk is what you get on the mornings nobody needs anything — which is
   * most of them, deliberately. See `wants.ts` for why it is you being asked.
   */
  const day = ctx.day ?? 1;
  const hero = whoIsAsked(ctx.register.everybody());
  const asking = whoWantsSomething([person], day)
    .find(({ want }) => wouldBringItTo(person, hero, want));

  const talk = gossipFor(person, ctx.register, day, ctx.rng);
  if (asking) return [asking.want.asks, ...(talk.news ? [talk.news] : [])];
  // what the village believes about its mine is small talk rather than news: a fresh fright is a
  // memory and leads the conversation, but a mine everybody has been afraid of for a month is
  // only a thing people here say — and it has to keep being said, or somebody passing through can
  // never find out why the place is poor.
  const said = ctx.saidOfMine?.(person.village) ?? '';
  // one villager in a few has heard about Old Nettle, and says it the way they say anything else.
  // It has to be small talk and it has to come BEFORE he first gets away, or his escaping reads
  // as the game cheating rather than as the one thing everybody already knew about him.
  const small = [
    ...talk.small,
    ...(ctx.wordOfHim && ctx.rng() < WORD_OF_HIM ? [ctx.wordOfHim(person)] : []),
    ...(said === '' ? [] : [said]),
  ];
  // somebody plainly down to their last few coins gets told how people here get by, because a
  // world full of things to do teaches nobody anything if none of them is ever mentioned
  if (ctx.state.inventory.gold < POOR) return [pick(ctx.rng, HOW_PEOPLE_GET_BY)];
  const aside = small.length > 0 ? pick(ctx.rng, small) : fallback;
  return talk.news ? [talk.news, aside] : [aside];
}

/**
 * The doctor, for whoever is standing in front of them bleeding.
 *
 * Both doors are always open, which is the point: coin buys the quick way, and everybody else
 * gets the slow one. A player with an empty purse is never turned away, only delayed.
 */
function doctorDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const mending = ctx.mending!;
  const speaker = `${e.name}, the Doctor`;
  const emoji = '🩺';
  const face = faceFor(e, ctx);
  const settled = mending.price === 0;
  const said = (line: string): DialogueNode => ({ speaker, emoji, face, pages: [line] });

  const choices: DialogueChoice[] = [];
  if (settled) {
    choices.push({ label: 'Let them see to it', next: () => said(mending.take(true)) });
  } else {
    if (ctx.state.inventory.gold >= mending.price) {
      choices.push({ label: `Pay ${mending.price} gold`, next: () => said(mending.take(true)) });
    }
    choices.push({
      label: `Wait your turn (${mending.hours} hours)`,
      next: () => said(mending.take(false)),
    });
  }
  choices.push({ label: 'Not now', next: () => null });

  return {
    speaker, emoji, face,
    pages: [settled
      ? 'You again. Sit down, and put your purse away: I have told you before.'
      : `That wants seeing to. ${mending.price} gold and you are out in a moment, or wait your turn with everybody else and it costs you nothing but the day.`],
    choices,
  };
}

function questDialogue(e: Entity, q: Quest, ctx: TalkCtx): DialogueNode {
  const speaker = `Elder ${e.name}`;
  const emoji = '🧓';
  const face = faceFor(e, ctx);
  const status = ctx.state.quests.get(q.id);
  if (status === 'done') {
    return { speaker, emoji, face, pages: [pick(ctx.rng, ['Good to see you again, friend.', `${q.village} will not forget what you did.`, 'Safe roads to you.'])] };
  }
  if (status === 'active') {
    const complete = q.kind === 'visit' ? ctx.state.discovered.has(q.target) : ctx.state.count(q.target) >= q.count;
    if (!complete) return { speaker, emoji, face, pages: [q.reminder] };
    return {
      speaker, emoji, face,
      pages: q.done,
      choices: [{
        label: `Take ${q.reward} gold`,
        next: () => {
          if (q.kind === 'fetch') {
            const left = ctx.state.count(q.target) - q.count;
            if (left > 0) ctx.state.inventory.items.set(q.target, left); else ctx.state.inventory.items.delete(q.target);
          }
          ctx.state.inventory.gold += q.reward;
          ctx.state.quests.set(q.id, 'done');
          ctx.state.version++;
          ctx.onQuestChange(q, 'done');
          return null;
        },
      }],
    };
  }
  return {
    speaker, emoji, face,
    pages: q.intro,
    choices: [
      { label: 'Accept', next: () => { ctx.state.quests.set(q.id, 'active'); ctx.state.version++; ctx.onQuestChange(q, 'active'); return { speaker, emoji, face, pages: ['Splendid. Come find me when it is done.'] }; } },
      { label: 'Not now', next: () => ({ speaker, emoji, face, pages: ['Think on it. I am not going anywhere.'] }) },
    ],
  };
}

export { stepWithin } from './dials';

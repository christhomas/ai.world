import type { Rng } from '../core/rng';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueChoice, DialogueNode, Speaker } from '../ui/dialogue';
import { ITEMS, SHOP_DEFS, type ShopDef, itemSummary, sellPrice, sellableAt } from './shops';
import type { GameState } from './state';
import type { Quest } from './quests';
import { gossipFor } from './gossip';
import { bookRows, type Enquiry, type Keeper } from './enquiry';
import { stageOf, type Person } from '../world/people';
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

/** Gold that rides along with a parcel, so a gift can be more than a thing. */
const PARCEL_GOLD = 10;

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
}

/** How often a villager brings up Old Nettle unprompted. Rare, so it stays a thing people say. */
const WORD_OF_HIM = 0.22;

/** Below this much gold, somebody will tell you how people here get by. */
const POOR = 60;   // a hero starts with fifty, so the first person they meet tells them

/**
 * How to make a living, said by the people who make one.
 *
 * A world full of things to do teaches nobody anything if none of them is ever mentioned. These
 * are said only to somebody visibly short of money, and they name a thing that can be done with
 * what a beginner already has rather than with the tools they cannot afford yet.
 */
const HOW_PEOPLE_GET_BY = [
  'Anybody can eat who can catch a rabbit. The store buys meat, and the hide off it too if you have a knife.',
  'There are deer in the open country. Slow work with a stick, but a hide is a hide.',
  'The herbs on the wet ground by the water are worth picking. The apothecary takes them, or grind them yourself if you have the bowl.',
  'Wolves pay better than deer, and cost more too. Wait until you have a proper blade.',
  'Ask the elder if there is anything wants doing. There generally is, and it pays.',
  'Whatever you take, carry it to a village that has none of it. That is the whole of trade.',
];

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

const CONGREGATION_LINES = [
  'We gather here most mornings. It is quieter than the square.',
  'The chapel bell has not rung in years. We still come.',
  'Say a word for the travellers on the road, would you?',
  'The old priest planted that tree by the door. Or so they say.',
  'Peace be on your road, stranger.',
];

const pick = (rng: Rng, list: string[]): string => list[Math.floor(rng() * list.length)];

/**
 * A drawn face for whoever is speaking, when they are somebody who lives here. A wolf has no
 * face on the register and keeps the emoji it always had.
 */
export function faceFor(e: Entity, ctx: { register?: Register; day?: number }): Speaker | undefined {
  const person = e.person !== '' ? ctx.register?.find(e.person) : undefined;
  if (person) {
    const stage = stageOf(person, ctx.day ?? 1);
    return { id: person.id, trade: person.trade || e.trade, stage: stage === 'adult' ? 'adult' : 'child' };
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
 * They share a role and most of what they say, and what separates them is the book. The priest is
 * in the room where the parish keeps its dead, so he is the one who can be asked about them; the
 * congregation on the step can tell you only that it is quieter here than the square. Neither of
 * them is checked against where the hero is standing, because an enquiry only ever arrives when he
 * is already in the room the book is kept in.
 */
function chapelDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const who: Keeper = {
    speaker: e.trade === 'priest' ? `${e.name}, the Priest` : e.name,
    emoji: e.kind.emoji,
    face: faceFor(e, ctx),
  };
  const pages = ['Hello, traveller.', ...residentPages(e, ctx, pick(ctx.rng, CONGREGATION_LINES))];
  const enquiry = ctx.enquiry;
  if (!enquiry) return { ...who, pages };
  // the greeting is settled once and said again on every return to it. Rebuilding it would draw a
  // fresh piece of small talk each time the player backed out of the book, so a priest who had
  // just told you about his sister would greet you by telling you about somebody else.
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

  const talk = gossipFor(person, ctx.register, ctx.day ?? 1, ctx.rng);
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

/**
 * Everything one conversation across a counter is about: who is talking, what they deal in, and
 * how many of a thing the player has dialled up to sell.
 *
 * It exists so that each turn of the conversation below can be a function you read on its own.
 * The tree used to be one function of nested closures, which meant the shape of the conversation
 * was only ever visible as the shape of the code, and buying a lantern lived thirty columns in
 * from the left margin.
 */
interface Counter {
  e: Entity;
  ctx: TalkCtx;
  def: ShopDef;
  /** What the panel puts above the words, and the face it draws beside them. */
  speaker: string;
  emoji: string;
  face: Speaker | undefined;
  /** Where this counter stands, for the small talk. */
  village: string;
  /**
   * How many of each thing the player means to sell, keyed by item.
   *
   * It has to outlive a single menu because the sell list is rebuilt from scratch every time an
   * arrow nudges a number, and the number is the whole point of the arrows.
   */
  wanted: Map<string, number>;
}

/** One thing said across the counter, and whatever the player may say back to it. */
function across(s: Counter, pages: string[], choices?: DialogueChoice[]): DialogueNode {
  const node: DialogueNode = { speaker: s.speaker, emoji: s.emoji, face: s.face, pages };
  if (choices) node.choices = choices;
  return node;
}

/**
 * A shopkeeper, from hello to goodbye.
 *
 * The conversation is a handful of rooms with doors between them: the counter itself, and from
 * there the stock, the trestle you sell off, the post shelf, a bed, or the weather. Each is a
 * function below, and every door is a `next` that names the room it opens onto — so the tree is
 * read by following the names rather than by counting braces.
 */
function shopDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const def = SHOP_DEFS[e.shop!];
  const counter: Counter = {
    e, ctx, def,
    speaker: `${e.name}, ${def.title}`,
    emoji: e.kind.emoji,
    face: faceFor(e, ctx),
    village: e.herd.tag || 'town',
    wanted: new Map(),
  };
  return isDaytime(ctx.time) ? shopRoot(counter) : afterHours(counter);
}

/**
 * A shop after dark, which is a closed door — except at an inn, where the beds are the reason it
 * is open at all, so the innkeeper answers and takes your money for one.
 */
function afterHours(s: Counter): DialogueNode {
  const { ctx } = s;
  if (s.e.shop === 'inn' && ctx.room) {
    return across(s, ['The kitchen is cold and the taps are off, but the beds are made and the door locks.'], [
      { label: `Take a room (${ctx.room.price}g)`, next: () => bedMenu(s) },
      { label: 'Back out into the dark', next: () => null },
    ]);
  }
  return across(s, [`The ${s.def.name.toLowerCase()} is shut for the night. Come back after dawn.`]);
}

/** The counter itself: everything this keeper can be asked for, in one list. */
function shopRoot(s: Counter): DialogueNode {
  const { ctx } = s;
  const innkeeper = s.e.shop === 'inn';
  return across(s, [pick(ctx.rng, s.def.greetings)], [
    { label: 'Buy', next: () => buyMenu(s) },
    { label: 'Sell', next: () => sellMenu(s) },
    ...(innkeeper && ctx.room ? [{ label: `Take a room (${ctx.room.price}g)`, next: () => bedMenu(s) }] : []),
    ...(innkeeper && ctx.post ? [{ label: 'The post shelf', next: () => postMenu(s) }] : []),
    // an apothecary keeps the parish's births beside the jars, and the row for it sits with the
    // rest of what is on offer rather than being hidden under the small talk
    ...(ctx.enquiry ? bookRows(s, ctx.enquiry, () => shopRoot(s)) : []),
    { label: 'Chat', next: () => chatMenu(s) },
    { label: 'Leave', next: () => null },
  ]);
}

/** A bed for the night: the sensible answer to a dark road and no hearts left. */
function bedMenu(s: Counter): DialogueNode {
  const room = s.ctx.room!;
  const purse = s.ctx.state.inventory.gold;
  if (purse < room.price) {
    return across(s, [`A room is ${room.price} gold, and you have ${purse}.`], [
      { label: 'Back', next: () => shopRoot(s) },
    ]);
  }
  // a bed that costs nothing is one somebody decided you were not to be charged for, and saying
  // so is the whole point of having earned it
  const settled = room.price === 0 ? 'Your money is no good here, not after what you did. ' : '';
  const upstairs = room.shared
    ? 'Upstairs, first on the left. The night is the night — it will pass at its own pace — but you will pass it warm and safe.'
    : 'Upstairs, first on the left. Sleep as long as you like; I will wake you at dawn.';
  return across(s, [settled + upstairs], [
    { label: 'Sleep', next: () => across(s, [room.take()]) },
    { label: 'Not tonight', next: () => shopRoot(s) },
  ]);
}

/**
 * Names and things fit on the shelf menu. Beyond this a list stops being a list you can read and
 * starts being one you scroll, and the post shelf is not worth a scrollbar.
 */
const SHELF_ROWS = 8;

/** The inn's shelf: take what is addressed to you, or leave something for somebody else. */
function postMenu(s: Counter): DialogueNode {
  const post = s.ctx.post!;
  return across(s, ['Parcels go on the shelf behind me. Anything left is handed over at any inn in the land.'], [
    { label: 'Anything for me?', next: () => { post.collect(); return null; } },
    { label: 'Leave a parcel', next: () => parcelMenu(s) },
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/** What is going on the shelf, out of what is in the pack. */
function parcelMenu(s: Counter): DialogueNode {
  const post = s.ctx.post!;
  const carried = [...s.ctx.state.inventory.items.entries()].filter(([id]) => ITEMS[id]);
  if (carried.length === 0 || post.folk.length === 0) {
    const why = carried.length === 0 ? 'You have nothing to send.' : 'No one else has passed through this world yet.';
    return across(s, [why], [{ label: 'Back', next: () => postMenu(s) }]);
  }
  return across(s, ['What are you sending?'], [
    ...carried.slice(0, SHELF_ROWS).map(([id]) => ({
      label: `${ITEMS[id].emoji} ${ITEMS[id].name}`,
      next: () => addressMenu(s, id),
    })),
    { label: 'Back', next: () => postMenu(s) },
  ]);
}

/** Who the parcel is for, out of everybody this world has seen. */
function addressMenu(s: Counter, itemId: string): DialogueNode {
  const post = s.ctx.post!;
  return across(s, [`${ITEMS[itemId].name}, and ${PARCEL_GOLD} gold for the carriage. Who is it for?`], [
    ...post.folk.slice(0, SHELF_ROWS).map((name) => ({
      label: name,
      // the carriage is paid if it can be afforded and waived if it cannot, because a parcel that
      // refuses to go for want of ten gold is a feature nobody meets twice
      next: () => { post.send(name, itemId, s.ctx.state.inventory.gold >= PARCEL_GOLD ? PARCEL_GOLD : 0); return null; },
    })),
    { label: 'Never mind', next: () => postMenu(s) },
  ]);
}

/** What they are asking today, which is the price plus whatever they think of you. */
function asking(s: Counter, item: { price: number }): number {
  return Math.round(item.price * (1 + (s.ctx.markup ?? 0)));
}

/** What is in the purse, said aloud, because a list of prices is no use on its own. */
function purseLine(s: Counter): string {
  return `You have ${s.ctx.state.inventory.gold} gold.`;
}

/**
 * The stock, with today's price against each thing, a tick beside what you already own, and what
 * each one actually does written underneath it.
 *
 * The shelf used to be a list of names and prices, which asks the player to buy a thing to find
 * out what it is for. Every one of these notes was already written and already on screen
 * somewhere else — the rucksack shows it, and so does the journal — so a shop that withheld it was
 * not being mysterious, it was being the one place that forgot.
 */
function buyMenu(s: Counter): DialogueNode {
  const dear = (s.ctx.markup ?? 0) > 0;
  const greeting = dear
    ? `Here's the stock, and my prices are my prices. ${purseLine(s)}`
    : `Here's the stock. ${purseLine(s)}`;
  return across(s, [greeting], [
    ...s.def.items.map((id) => {
      const item = ITEMS[id];
      const owned = s.ctx.state.owns(id) ? ' ✓' : '';
      return {
        label: `${item.emoji} ${item.name} — ${asking(s, item)}g${owned}`,
        // what it gives you, and failing that what it is: a sack of ore grants nothing and still
        // wants a line, or the row reads as an item whose note went missing
        note: itemSummary(item) || item.desc,
        next: () => buyOne(s, item.id),
      };
    }),
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/** Purchases go into the rucksack; wearing them is the player's business. */
function buyOne(s: Counter, id: string): DialogueNode {
  const { ctx } = s;
  const item = ITEMS[id];
  const price = asking(s, item);
  if (ctx.state.inventory.gold < price) {
    return across(s, [`That's ${price} gold, friend. You've only got ${ctx.state.inventory.gold}.`], [
      { label: 'Back', next: () => buyMenu(s) },
      { label: 'Leave', next: () => null },
    ]);
  }
  ctx.state.inventory.gold -= price;
  ctx.state.give(item.id, 1);
  ctx.onInventoryChange();
  const note = itemSummary(item);
  return across(s, [
    `${item.name}, good choice. That's ${price} gold.`,
    `It's in your pack.${note ? ` ${capitalise(note)}.` : ''}`,
  ], [
    { label: 'Buy more', next: () => buyMenu(s) },
    { label: 'Sell something', next: () => sellMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** The trestle: everything in the pack this shop deals in, with a number against each. */
function sellMenu(s: Counter): DialogueNode {
  const { ctx } = s;
  const stock = sellableAt(s.def, ctx.state.inventory.items.entries());
  if (stock.length === 0) {
    const refusal = `Nothing in that pack I can use. ${s.def.name === 'Inn' ? 'Fish and food, mind.' : ''}`.trim();
    return across(s, [refusal], [{ label: 'Back', next: () => shopRoot(s) }]);
  }
  const all = stock.reduce((sum, row) => sum + row.price * row.count, 0);
  // anything sold, dropped or eaten since the last look may have left a number stranded above
  // what is actually in the pack, and offering to sell nine of six is how a shop loses its money
  for (const { item, count } of stock) {
    const asked = s.wanted.get(item.id);
    if (asked !== undefined) s.wanted.set(item.id, Math.max(1, Math.min(count, asked)));
  }
  return across(s, [`Let's see what you've got. ${purseLine(s)}`], [
    ...stock.map((row) => sellRow(s, row)),
    ...(stock.length > 1 || stock[0].count > 1 ? [{ label: `Sell the lot (${all}g)`, next: () => sellAll(s, stock) }] : []),
    { label: 'Back', next: () => shopRoot(s) },
  ]);
}

/**
 * One thing on the trestle, and the dial that says how many of it you mean.
 *
 * Selling a stack of twenty pelts used to mean twenty trips through the same three lines of
 * patter, and the only way out of that was "sell the lot", which empties the pack of everything —
 * no use at all when you are keeping four apples and selling the rest. Left and right on this row
 * set the number, so the common case is two taps rather than twenty.
 */
function sellRow(s: Counter, { item, count, price }: ReturnType<typeof sellableAt>[number]): DialogueChoice {
  const n = Math.max(1, Math.min(count, s.wanted.get(item.id) ?? 1));
  // the arrows are only worth drawing where there is more than one to argue about
  const dial = count > 1 ? `  ◀ ${n} of ${count} ▶` : '';
  return {
    label: `${item.emoji} ${item.name} — ${price * n}g${dial}`,
    next: () => sellSome(s, item.id, n),
    adjust: (dir: number): DialogueNode | null => {
      if (count <= 1) return null;
      // it wraps rather than stopping at the ends, for the reason stepWithin sets out below
      s.wanted.set(item.id, stepWithin(n, dir, count));
      return sellMenu(s);
    },
  };
}

/** Hand over some number of one thing and take the coin for it. */
function sellSome(s: Counter, id: string, n: number): DialogueNode {
  const { ctx } = s;
  const item = ITEMS[id];
  const sold = ctx.state.take(id, n);
  if (sold === 0) return sellMenu(s);
  const paid = sellPrice(item) * sold;
  ctx.state.inventory.gold += paid;
  ctx.onInventoryChange();
  // "4 × Wolf Pelt" rather than "4 Wolf Pelt": the names are singular and pluralising them
  // properly would mean a plural for every item in the game to avoid writing "4 Breads"
  const named = sold > 1 ? `${sold} × ${item.name}` : item.name;
  return across(s, [`${named} for ${paid} gold. Done.`], [
    { label: 'Sell more', next: () => sellMenu(s) },
    { label: 'Buy something', next: () => buyMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** Empty the pack of everything this shop deals in, in one go. */
function sellAll(s: Counter, stock: ReturnType<typeof sellableAt>): DialogueNode {
  const { ctx } = s;
  let paid = 0;
  for (const { item, count } of stock) paid += sellPrice(item) * ctx.state.take(item.id, count);
  ctx.state.inventory.gold += paid;
  ctx.onInventoryChange();
  return across(s, [`The lot for ${paid} gold. Pleasure doing business.`], [
    { label: 'Buy something', next: () => buyMenu(s) },
    { label: 'Done', next: () => null },
  ]);
}

/** The weather, more or less: a keeper's own line, and how trade is treating them. */
function chatMenu(s: Counter): DialogueNode {
  return across(s, [s.e.line(s.ctx.rng), `Business is steady here in ${s.village}.`], [
    { label: 'Back', next: () => shopRoot(s) },
    { label: 'Leave', next: () => null },
  ]);
}

/**
 * Move a quantity by one, wrapping round the ends of its range.
 *
 * Wrapping rather than stopping is the whole of what makes the sell dial usable. The key handler
 * deliberately ignores auto-repeat, so a stack of twenty would be nineteen separate presses to
 * sell whole; from one, a single press of left lands on all of them, which is the number people
 * want most often after one.
 *
 * @param n where the dial is now, from 1 to count
 * @param dir -1 or 1
 * @param count how many there are, which is the top of the range
 */
export function stepWithin(n: number, dir: number, count: number): number {
  if (count <= 1) return 1;
  return ((n - 1 + dir) % count + count) % count + 1;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

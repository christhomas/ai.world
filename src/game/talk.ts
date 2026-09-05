import type { Rng } from '../core/rng';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueChoice, DialogueNode, Speaker } from '../ui/dialogue';
import { ITEMS, SHOP_DEFS, itemSummary, sellPrice, sellableAt } from './shops';
import type { GameState } from './state';
import type { Quest } from './quests';
import { gossipFor } from './gossip';
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
export const PARCEL_GOLD = 10;

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

  if (e.role === 'congregation') {
    return {
      speaker: e.name, emoji: k.emoji, face: faceFor(e, ctx),
      pages: ['Hello, traveller.', ...residentPages(e, ctx, pick(ctx.rng, CONGREGATION_LINES))],
    };
  }
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

function shopDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const def = SHOP_DEFS[e.shop!];
  const speaker = `${e.name}, ${def.title}`;
  const emoji = e.kind.emoji;
  const face = faceFor(e, ctx);
  const village = e.herd.tag || 'town';

  /** A bed for the night: the sensible answer to a dark road and no hearts left. */
  const bed = (): DialogueNode => {
    const room = ctx.room!;
    if (ctx.state.inventory.gold < room.price) {
      // root is defined below; reaching it lazily keeps the night's first node buildable
      return { speaker, emoji, face, pages: [`A room is ${room.price} gold, and you have ${ctx.state.inventory.gold}.`], choices: [{ label: 'Back', next: () => root() }] };
    }
    // a bed that costs nothing is one somebody decided you were not to be charged for, and
    // saying so is the whole point of having earned it
    const settled = room.price === 0 ? 'Your money is no good here, not after what you did. ' : '';
    return {
      speaker, emoji, face,
      pages: [settled + (room.shared
        ? 'Upstairs, first on the left. The night is the night — it will pass at its own pace — but you will pass it warm and safe.'
        : 'Upstairs, first on the left. Sleep as long as you like; I will wake you at dawn.')],
      choices: [
        { label: 'Sleep', next: () => ({ speaker, emoji, face, pages: [room.take()] }) },
        { label: 'Not tonight', next: () => root() },
      ],
    };
  };

  if (!isDaytime(ctx.time)) {
    // an inn that shuts at night is no inn: the beds are the reason it is open
    if (e.shop === 'inn' && ctx.room) {
      return {
        speaker, emoji, face,
        pages: ['The kitchen is cold and the taps are off, but the beds are made and the door locks.'],
        choices: [
          { label: `Take a room (${ctx.room.price}g)`, next: bed },
          { label: 'Back out into the dark', next: () => null },
        ],
      };
    }
    return { speaker, emoji, face, pages: [`The ${def.name.toLowerCase()} is shut for the night. Come back after dawn.`] };
  }

  const purse = () => `You have ${ctx.state.inventory.gold} gold.`;

  const root = (): DialogueNode => ({
    speaker, emoji, face,
    pages: [pick(ctx.rng, def.greetings)],
    choices: [
      { label: 'Buy', next: buyMenu },
      { label: 'Sell', next: sellMenu },
      ...(e.shop === 'inn' && ctx.room ? [{ label: `Take a room (${ctx.room.price}g)`, next: bed }] : []),
      ...(e.shop === 'inn' && ctx.post ? [{ label: 'The post shelf', next: postMenu }] : []),
      { label: 'Chat', next: chat },
      { label: 'Leave', next: () => null },
    ],
  });

  /** The inn's shelf: take what is addressed to you, or leave something for somebody else. */
  const postMenu = (): DialogueNode => {
    const post = ctx.post!;
    return {
      speaker, emoji, face,
      pages: ['Parcels go on the shelf behind me. Anything left is handed over at any inn in the land.'],
      choices: [
        { label: 'Anything for me?', next: () => { post.collect(); return null; } },
        { label: 'Leave a parcel', next: parcelMenu },
        { label: 'Back', next: root },
      ],
    };
  };

  const parcelMenu = (): DialogueNode => {
    const post = ctx.post!;
    const carried = [...ctx.state.inventory.items.entries()].filter(([id]) => ITEMS[id]);
    if (carried.length === 0 || post.folk.length === 0) {
      return {
        speaker, emoji, face,
        pages: [carried.length === 0 ? 'You have nothing to send.' : 'No one else has passed through this world yet.'],
        choices: [{ label: 'Back', next: postMenu }],
      };
    }
    const forWhom = (itemId: string): DialogueNode => ({
      speaker, emoji, face,
      pages: [`${ITEMS[itemId].name}, and ${PARCEL_GOLD} gold for the carriage. Who is it for?`],
      choices: [
        ...post.folk.slice(0, 8).map((name) => ({
          label: name,
          next: () => { post.send(name, itemId, ctx.state.inventory.gold >= PARCEL_GOLD ? PARCEL_GOLD : 0); return null; },
        })),
        { label: 'Never mind', next: postMenu },
      ],
    });
    return {
      speaker, emoji, face,
      pages: ['What are you sending?'],
      choices: [
        ...carried.slice(0, 8).map(([id]) => ({ label: `${ITEMS[id].emoji} ${ITEMS[id].name}`, next: () => forWhom(id) })),
        { label: 'Back', next: postMenu },
      ],
    };
  };

  /** What they are asking today, which is the price plus whatever they think of you. */
  const asking = (item: { price: number }): number => Math.round(item.price * (1 + (ctx.markup ?? 0)));

  const buyMenu = (): DialogueNode => ({
    speaker, emoji, face,
    pages: [(ctx.markup ?? 0) > 0
      ? `Here's the stock, and my prices are my prices. ${purse()}`
      : `Here's the stock. ${purse()}`],
    choices: [
      ...def.items.map((id) => {
        const item = ITEMS[id];
        const owned = ctx.state.owns(id) ? ' ✓' : '';
        return { label: `${item.emoji} ${item.name} — ${asking(item)}g${owned}`, next: () => buy(item.id) };
      }),
      { label: 'Back', next: root },
    ],
  });

  /** Purchases go into the rucksack; wearing them is the player's business. */
  const buy = (id: string): DialogueNode => {
    const item = ITEMS[id];
    const price = asking(item);
    if (ctx.state.inventory.gold < price) {
      return {
        speaker, emoji, face,
        pages: [`That's ${price} gold, friend. You've only got ${ctx.state.inventory.gold}.`],
        choices: [{ label: 'Back', next: buyMenu }, { label: 'Leave', next: () => null }],
      };
    }
    ctx.state.inventory.gold -= price;
    ctx.state.give(item.id, 1);
    ctx.onInventoryChange();
    const note = itemSummary(item);
    return {
      speaker, emoji, face,
      pages: [`${item.name}, good choice. That's ${price} gold.`, `It's in your pack.${note ? ` ${capitalise(note)}.` : ''}`],
      choices: [{ label: 'Buy more', next: buyMenu }, { label: 'Sell something', next: sellMenu }, { label: 'Done', next: () => null }],
    };
  };

  const sellMenu = (): DialogueNode => {
    const stock = sellableAt(def, ctx.state.inventory.items.entries());
    if (stock.length === 0) {
      return {
        speaker, emoji, face,
        pages: [`Nothing in that pack I can use. ${def.name === 'Inn' ? 'Fish and food, mind.' : ''}`.trim()],
        choices: [{ label: 'Back', next: root }],
      };
    }
    const all = stock.reduce((sum, s) => sum + s.price * s.count, 0);
    return {
      speaker, emoji, face,
      pages: [`Let's see what you've got. ${purse()}`],
      choices: [
        ...stock.map(({ item, count, price }) => ({
          label: `${item.emoji} ${item.name}${count > 1 ? ` ×${count}` : ''} — ${price}g each`,
          next: () => sell(item.id, 1),
        })),
        ...(stock.length > 1 || stock[0].count > 1 ? [{ label: `Sell the lot (${all}g)`, next: () => sellAll(stock) }] : []),
        { label: 'Back', next: root },
      ],
    };
  };

  const sell = (id: string, n: number): DialogueNode => {
    const item = ITEMS[id];
    const sold = ctx.state.take(id, n);
    if (sold === 0) return sellMenu();
    const paid = sellPrice(item) * sold;
    ctx.state.inventory.gold += paid;
    ctx.onInventoryChange();
    return {
      speaker, emoji, face,
      pages: [`${sold > 1 ? `${sold} ${item.name}` : item.name} for ${paid} gold. Done.`],
      choices: [{ label: 'Sell more', next: sellMenu }, { label: 'Buy something', next: buyMenu }, { label: 'Done', next: () => null }],
    };
  };

  const sellAll = (stock: ReturnType<typeof sellableAt>): DialogueNode => {
    let paid = 0;
    for (const { item, count } of stock) {
      const sold = ctx.state.take(item.id, count);
      paid += sellPrice(item) * sold;
    }
    ctx.state.inventory.gold += paid;
    ctx.onInventoryChange();
    return {
      speaker, emoji, face,
      pages: [`The lot for ${paid} gold. Pleasure doing business.`],
      choices: [{ label: 'Buy something', next: buyMenu }, { label: 'Done', next: () => null }],
    };
  };

  const chat = (): DialogueNode => ({
    speaker, emoji, face,
    pages: [e.line(ctx.rng), `Business is steady here in ${village}.`],
    choices: [{ label: 'Back', next: root }, { label: 'Leave', next: () => null }],
  });

  return root();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

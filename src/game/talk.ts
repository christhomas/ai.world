import type { Rng } from '../core/rng';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueNode } from '../ui/dialogue';
import { ITEMS, SHOP_DEFS, itemSummary, sellPrice, sellableAt } from './shops';
import type { GameState } from './state';
import type { Quest } from './quests';

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

const CONGREGATION_LINES = [
  'We gather here most mornings. It is quieter than the square.',
  'The chapel bell has not rung in years. We still come.',
  'Say a word for the travellers on the road, would you?',
  'The old priest planted that tree by the door. Or so they say.',
  'Peace be on your road, stranger.',
];

const pick = (rng: Rng, list: string[]): string => list[Math.floor(rng() * list.length)];

/** Build the conversation tree for whoever the player is talking to. */
export function dialogueFor(e: Entity, ctx: TalkCtx): DialogueNode {
  const k = e.kind;
  if (e.role === 'shopkeeper' && e.shop) return shopDialogue(e, ctx);
  if (e.role === 'elder') {
    const q = ctx.quests.get(e.herd.tag);
    if (q) return questDialogue(e, q, ctx);
  }

  if (e.role === 'congregation') {
    return {
      speaker: e.name, emoji: k.emoji,
      pages: ['Hello, traveller.', pick(ctx.rng, CONGREGATION_LINES)],
    };
  }
  if (k.id === 'villager' || k.id === 'traveller') {
    return {
      speaker: e.name, emoji: k.emoji,
      pages: [pick(ctx.rng, ['Hello there!', 'Oh! Hello.', 'Well met, traveller.']), e.line(ctx.rng)],
    };
  }
  return { speaker: `${e.name} the ${k.label}`, emoji: k.emoji, pages: [e.line(ctx.rng)] };
}

function questDialogue(e: Entity, q: Quest, ctx: TalkCtx): DialogueNode {
  const speaker = `Elder ${e.name}`;
  const emoji = '🧓';
  const status = ctx.state.quests.get(q.id);
  if (status === 'done') {
    return { speaker, emoji, pages: [pick(ctx.rng, ['Good to see you again, friend.', `${q.village} will not forget what you did.`, 'Safe roads to you.'])] };
  }
  if (status === 'active') {
    const complete = q.kind === 'visit' ? ctx.state.discovered.has(q.target) : ctx.state.count(q.target) >= q.count;
    if (!complete) return { speaker, emoji, pages: [q.reminder] };
    return {
      speaker, emoji,
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
    speaker, emoji,
    pages: q.intro,
    choices: [
      { label: 'Accept', next: () => { ctx.state.quests.set(q.id, 'active'); ctx.state.version++; ctx.onQuestChange(q, 'active'); return { speaker, emoji, pages: ['Splendid. Come find me when it is done.'] }; } },
      { label: 'Not now', next: () => ({ speaker, emoji, pages: ['Think on it. I am not going anywhere.'] }) },
    ],
  };
}

function shopDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const def = SHOP_DEFS[e.shop!];
  const speaker = `${e.name}, ${def.title}`;
  const emoji = e.kind.emoji;
  const village = e.herd.tag || 'town';

  /** A bed for the night: the sensible answer to a dark road and no hearts left. */
  const bed = (): DialogueNode => {
    const room = ctx.room!;
    if (ctx.state.inventory.gold < room.price) {
      // root is defined below; reaching it lazily keeps the night's first node buildable
      return { speaker, emoji, pages: [`A room is ${room.price} gold, and you have ${ctx.state.inventory.gold}.`], choices: [{ label: 'Back', next: () => root() }] };
    }
    return {
      speaker, emoji,
      pages: [room.shared
        ? 'Upstairs, first on the left. The night is the night — it will pass at its own pace — but you will pass it warm and safe.'
        : 'Upstairs, first on the left. Sleep as long as you like; I will wake you at dawn.'],
      choices: [
        { label: 'Sleep', next: () => ({ speaker, emoji, pages: [room.take()] }) },
        { label: 'Not tonight', next: () => root() },
      ],
    };
  };

  if (!isDaytime(ctx.time)) {
    // an inn that shuts at night is no inn: the beds are the reason it is open
    if (e.shop === 'inn' && ctx.room) {
      return {
        speaker, emoji,
        pages: ['The kitchen is cold and the taps are off, but the beds are made and the door locks.'],
        choices: [
          { label: `Take a room (${ctx.room.price}g)`, next: bed },
          { label: 'Back out into the dark', next: () => null },
        ],
      };
    }
    return { speaker, emoji, pages: [`The ${def.name.toLowerCase()} is shut for the night. Come back after dawn.`] };
  }

  const purse = () => `You have ${ctx.state.inventory.gold} gold.`;

  const root = (): DialogueNode => ({
    speaker, emoji,
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
      speaker, emoji,
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
        speaker, emoji,
        pages: [carried.length === 0 ? 'You have nothing to send.' : 'No one else has passed through this world yet.'],
        choices: [{ label: 'Back', next: postMenu }],
      };
    }
    const forWhom = (itemId: string): DialogueNode => ({
      speaker, emoji,
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
      speaker, emoji,
      pages: ['What are you sending?'],
      choices: [
        ...carried.slice(0, 8).map(([id]) => ({ label: `${ITEMS[id].emoji} ${ITEMS[id].name}`, next: () => forWhom(id) })),
        { label: 'Back', next: postMenu },
      ],
    };
  };

  const buyMenu = (): DialogueNode => ({
    speaker, emoji,
    pages: [`Here's the stock. ${purse()}`],
    choices: [
      ...def.items.map((id) => {
        const item = ITEMS[id];
        const owned = ctx.state.owns(id) ? ' ✓' : '';
        return { label: `${item.emoji} ${item.name} — ${item.price}g${owned}`, next: () => buy(item.id) };
      }),
      { label: 'Back', next: root },
    ],
  });

  /** Purchases go into the rucksack; wearing them is the player's business. */
  const buy = (id: string): DialogueNode => {
    const item = ITEMS[id];
    if (!ctx.state.inventory.canAfford(item)) {
      return {
        speaker, emoji,
        pages: [`That's ${item.price} gold, friend. You've only got ${ctx.state.inventory.gold}.`],
        choices: [{ label: 'Back', next: buyMenu }, { label: 'Leave', next: () => null }],
      };
    }
    ctx.state.inventory.gold -= item.price;
    ctx.state.give(item.id, 1);
    ctx.onInventoryChange();
    const note = itemSummary(item);
    return {
      speaker, emoji,
      pages: [`${item.name}, good choice. That's ${item.price} gold.`, `It's in your pack.${note ? ` ${capitalise(note)}.` : ''}`],
      choices: [{ label: 'Buy more', next: buyMenu }, { label: 'Sell something', next: sellMenu }, { label: 'Done', next: () => null }],
    };
  };

  const sellMenu = (): DialogueNode => {
    const stock = sellableAt(def, ctx.state.inventory.items.entries());
    if (stock.length === 0) {
      return {
        speaker, emoji,
        pages: [`Nothing in that pack I can use. ${def.name === 'Inn' ? 'Fish and food, mind.' : ''}`.trim()],
        choices: [{ label: 'Back', next: root }],
      };
    }
    const all = stock.reduce((sum, s) => sum + s.price * s.count, 0);
    return {
      speaker, emoji,
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
      speaker, emoji,
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
      speaker, emoji,
      pages: [`The lot for ${paid} gold. Pleasure doing business.`],
      choices: [{ label: 'Buy something', next: buyMenu }, { label: 'Done', next: () => null }],
    };
  };

  const chat = (): DialogueNode => ({
    speaker, emoji,
    pages: [e.line(ctx.rng), `Business is steady here in ${village}.`],
    choices: [{ label: 'Back', next: root }, { label: 'Leave', next: () => null }],
  });

  return root();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

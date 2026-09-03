import type { Rng } from '../core/rng';
import { isDaytime, type Entity } from '../entities/entity';
import type { DialogueNode } from '../ui/dialogue';
import { ITEMS, SHOP_DEFS } from './shops';
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

  if (!isDaytime(ctx.time)) {
    return { speaker, emoji, pages: [`The ${def.name.toLowerCase()} is shut for the night. Come back after dawn.`] };
  }

  const root = (): DialogueNode => ({
    speaker, emoji,
    pages: [pick(ctx.rng, def.greetings)],
    choices: [
      { label: 'Buy', next: buyMenu },
      ...(e.shop === 'inn' ? [{ label: 'Sell fish', next: sellFish }] : []),
      { label: 'Chat', next: chat },
      { label: 'Leave', next: () => null },
    ],
  });

  const buyMenu = (): DialogueNode => ({
    speaker, emoji,
    pages: [`Here's what I've got. You have ${ctx.state.inventory.gold} gold.`],
    choices: [
      ...def.items.map((id) => {
        const item = ITEMS[id];
        return { label: `${item.emoji} ${item.name} — ${item.price}g`, next: () => purchase(item.id) };
      }),
      { label: 'Back', next: root },
    ],
  });

  const purchase = (id: string): DialogueNode => {
    const item = ITEMS[id];
    if (ctx.state.inventory.buy(item)) {
      ctx.state.version++;
      ctx.onInventoryChange();
      return {
        speaker, emoji,
        pages: [`${item.name}, good choice. That's ${item.price} gold.`, item.desc],
        choices: [{ label: 'Buy more', next: buyMenu }, { label: 'Done', next: () => null }],
      };
    }
    return {
      speaker, emoji,
      pages: [`That's ${item.price} gold, friend. You've only got ${ctx.state.inventory.gold}.`],
      choices: [{ label: 'Back', next: buyMenu }, { label: 'Leave', next: () => null }],
    };
  };

  /** The inn buys anything you have caught, at the item's listed price. */
  const sellFish = (): DialogueNode => {
    const fish = ['minnow', 'perch', 'pike', 'eel'].filter((id) => ctx.state.count(id) > 0);
    if (fish.length === 0) {
      return { speaker, emoji, pages: ['Bring me a fish and we will talk.'], choices: [{ label: 'Back', next: root }] };
    }
    const total = fish.reduce((sum, id) => sum + ITEMS[id].price * ctx.state.count(id), 0);
    const list = fish.map((id) => `${ctx.state.count(id)}× ${ITEMS[id].name}`).join(', ');
    return {
      speaker, emoji,
      pages: [`${list}. I will give you ${total} gold for the lot.`],
      choices: [
        { label: `Sell (${total}g)`, next: () => {
          for (const id of fish) ctx.state.inventory.items.delete(id);
          ctx.state.inventory.gold += total;
          ctx.state.version++;
          ctx.onInventoryChange();
          return { speaker, emoji, pages: ['Fresh fish for the pot. Pleasure doing business.'] };
        } },
        { label: 'Keep them', next: root },
      ],
    };
  };

  const chat = (): DialogueNode => ({
    speaker, emoji,
    pages: [e.line(ctx.rng), `Business is steady here in ${village}.`],
    choices: [{ label: 'Back', next: root }, { label: 'Leave', next: () => null }],
  });

  return root();
}

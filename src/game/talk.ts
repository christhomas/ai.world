import type { Rng } from '../core/rng';
import type { Entity } from '../entities/entity';
import type { DialogueNode } from '../ui/dialogue';
import { ITEMS, SHOP_DEFS, type Inventory } from './shops';

export interface TalkCtx {
  inventory: Inventory;
  rng: Rng;
  /** Called after a purchase so the HUD and save can refresh. */
  onInventoryChange: () => void;
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

function shopDialogue(e: Entity, ctx: TalkCtx): DialogueNode {
  const def = SHOP_DEFS[e.shop!];
  const speaker = `${e.name}, ${def.title}`;
  const emoji = e.kind.emoji;
  const village = e.herd.tag || 'town';

  const root = (): DialogueNode => ({
    speaker, emoji,
    pages: [pick(ctx.rng, def.greetings)],
    choices: [
      { label: 'Buy', next: buyMenu },
      { label: 'Chat', next: chat },
      { label: 'Leave', next: () => null },
    ],
  });

  const buyMenu = (): DialogueNode => ({
    speaker, emoji,
    pages: [`Here's what I've got. You have ${ctx.inventory.gold} gold.`],
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
    if (ctx.inventory.buy(item)) {
      ctx.onInventoryChange();
      return {
        speaker, emoji,
        pages: [`${item.name}, good choice. That's ${item.price} gold.`, item.desc],
        choices: [{ label: 'Buy more', next: buyMenu }, { label: 'Done', next: () => null }],
      };
    }
    return {
      speaker, emoji,
      pages: [`That's ${item.price} gold, friend. You've only got ${ctx.inventory.gold}.`],
      choices: [{ label: 'Back', next: buyMenu }, { label: 'Leave', next: () => null }],
    };
  };

  const chat = (): DialogueNode => ({
    speaker, emoji,
    pages: [e.line(ctx.rng), `Business is steady here in ${village}.`],
    choices: [{ label: 'Back', next: root }, { label: 'Leave', next: () => null }],
  });

  return root();
}

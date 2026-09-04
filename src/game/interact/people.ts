import { ITEMS } from '../items';
import { tradableItems, type TradeOffer } from '../online';
import { PARTY_LIMIT } from '../../../server/protocol';
import { GAMEPLAY } from '../../core/config';
import type { Surroundings } from './context';

/** Dealing with another player standing beside you: goods, company, or a friendly bout. */
export function peopleInteractions(ctx: Surroundings) {
  const { player, state, dialogue, hud, chat, online, party, duel, hires, callOut } = ctx;

  /** Somebody has offered you something: show it and let the player answer. */
  const showOffer = (offer: TradeOffer, fromName: string): void => {
    const parts = [offer.gold > 0 ? `${offer.gold} gold` : '', ...offer.items.map(([id, n]) => `${n}× ${ITEMS[id]?.name ?? id}`)].filter(Boolean);
    dialogue.start({
      speaker: fromName, emoji: '🤝',
      pages: [`${fromName} offers you ${parts.join(', ') || 'nothing at all'}.`],
      choices: [
        { label: 'Accept', next: () => { online.answer(offer.from, true); return null; } },
        { label: 'Decline', next: () => { online.answer(offer.from, false); return null; } },
      ],
    });
  };

  /** Offer the nearest player some of what you carry. */
  const offerTrade = (): void => {
    if (!online.connected) { hud.flash('Join a server first: options, then join this world online.'); return; }
    const target = online.nearest(player.x, player.z, 6);
    if (!target) { hud.flash('Nobody close enough to trade with.'); return; }
    const goods = tradableItems(state).slice(0, 5);
    dialogue.start({
      speaker: target.name, emoji: '🤝',
      pages: [`You have ${state.inventory.gold} gold and ${goods.length} kind${goods.length === 1 ? '' : 's'} of goods to hand.`],
      choices: [
        ...(duel.active ? [] : [{ label: 'Challenge to a friendly bout', next: () => {
          online.challenge(target.id);
          hud.flash(`Challenged ${target.name} to a duel.`);
          return null;
        } }]),
        // the same fight, but with whoever you have paid for standing in front of you. It is the
        // weaker player's answer to a stronger one, and it is why anybody hires a sword at all
        ...(duel.active || hires.roster(online.id).length === 0 ? [] : [{
          label: `Call them out, with your ${hires.roster(online.id).length} sword${hires.roster(online.id).length === 1 ? '' : 's'}`,
          next: () => {
            callOut(target.id);
            hud.flash(`Called ${target.name} out.`);
            return null;
          },
        }]),
        ...(state.inventory.gold >= 25 ? [{ label: 'Offer 25 gold', next: () => { online.offer(target.id, 25, []); chat.line(`You offered ${target.name} 25 gold.`, 'sys'); return null; } }] : []),
        ...goods.map(([id, n]) => ({
          label: `Offer ${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (of ${n})` : ''}`,
          next: () => { online.offer(target.id, 0, [[id, 1]]); chat.line(`You offered ${target.name} a ${ITEMS[id].name}.`, 'sys'); return null; },
        })),
        { label: 'Never mind', next: () => null },
      ],
    });
  };

  /** The party menu: ask the nearest traveller along, see who is with you, or go your own way. */
  const partyMenu = (): void => {
    if (!online.connected) { hud.flash('Join a world online to travel with other people.'); return; }
    const near = online.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE * 3);
    const askable = near && !party.has(near.id) ? near : null;
    const pages = [party.size ? `You are travelling ${party.describe(online.id)}.` : 'You are travelling alone.'];
    if (askable) pages.push(`${askable.name} is close by.`);
    dialogue.start({ speaker: 'Your Party', emoji: '🧭', pages, choices: [
      ...(askable && party.size < PARTY_LIMIT
        ? [{ label: `Ask ${askable.name} along`, next: () => { online.invite(askable.id); hud.flash(`Asked ${askable.name} to travel with you.`); return null; } }]
        : []),
      ...(party.size ? [{ label: 'Go your own way', next: () => { online.leaveParty(); return null; } }] : []),
      { label: 'Close', next: () => null },
    ] });
  };

  return { showOffer, offerTrade, partyMenu };
}

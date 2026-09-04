import type { Rng } from '../core/rng';
import type { Post } from './entity';

/**
 * What a villager does for a living.
 *
 * A trade is a name and the places it needs. The day itself is in `behaviours/villagers.json` —
 * this only decides who ends up with which job, and refuses to make somebody a sailor in a
 * village with no water in sight.
 */
export interface Trade {
  id: string;
  label: string;
  /** How often this trade turns up, against the others available. */
  weight: number;
  /** Places the village must actually have before anybody can hold this job. */
  needs?: Post[];
  /** What they say when you talk to them, over and above the usual village chatter. */
  lines: string[];
}

export const TRADES: Trade[] = [
  {
    id: 'seller', label: 'Market Seller', weight: 3, needs: ['market'],
    lines: ['Fresh in this morning, if you are quick.', 'Buying as well as selling, if you have anything.'],
  },
  {
    id: 'farmer', label: 'Farmer', weight: 3, needs: ['field'],
    lines: ['The field will not turn itself over.', 'Rain would be welcome. Not that much rain.'],
  },
  {
    id: 'hunter', label: 'Hunter', weight: 3, needs: ['woods', 'market'],
    lines: ['Wolves have been bold this week.', 'I take it to the market before it turns.'],
  },
  {
    id: 'soldier', label: 'Soldier', weight: 2, needs: ['gate'],
    lines: ['The road is quiet. Long may it stay so.', 'Coin buys a sword arm, if you were asking.'],
  },
  {
    id: 'sailor', label: 'Sailor', weight: 2, needs: ['shore'],
    lines: ['Tide is on the turn.', 'I have been further out than anybody here, whatever they tell you.'],
  },
  {
    id: 'climber', label: 'Mountain Climber', weight: 1, needs: ['heights'],
    lines: ['There is a way up the north face. Nobody believes me.', 'The view is worth the knees.'],
  },
  {
    id: 'explorer', label: 'Explorer', weight: 1,
    lines: ['I am only back for supplies.', 'There is a shrine four days east that nobody has opened.'],
  },
  {
    id: 'innkeeper', label: 'Innkeeper', weight: 1, needs: ['inn'],
    lines: ['Beds are made, whatever the hour.', 'You look like a person who has walked a long way.'],
  },
];

/** Which trades a village can actually support, given what is around it. */
export function tradesFor(posts: Partial<Record<Post, [number, number]>>): Trade[] {
  return TRADES.filter((trade) => (trade.needs ?? []).every((post) => posts[post] !== undefined));
}

/** Somebody's job, weighted, from what this village can support. */
export function pickTrade(posts: Partial<Record<Post, [number, number]>>, rng: Rng): string {
  const available = tradesFor(posts);
  if (available.length === 0) return '';
  const total = available.reduce((sum, trade) => sum + trade.weight, 0);
  let roll = rng() * total;
  for (const trade of available) {
    roll -= trade.weight;
    if (roll <= 0) return trade.id;
  }
  return available[available.length - 1].id;
}

/** The trade with this name, for anything that wants its label or its lines. */
export function tradeNamed(id: string): Trade | undefined {
  return TRADES.find((trade) => trade.id === id);
}

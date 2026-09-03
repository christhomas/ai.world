import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { Structures, Village } from '../world/structures';
import { ITEMS, SHOP_DEFS } from './shops';
import type { ShopType } from '../world/structures';

/**
 * One quest per village, handed out by the village elder. Two shapes:
 *  - visit: go and discover a named point of interest (the nearest one to the village)
 *  - fetch: bring N of an item this village's shops do not sell, so you must travel
 * Generated from the seed, so the same world always has the same errands.
 */
export type QuestKind = 'visit' | 'fetch';

export interface Quest {
  id: string;
  village: string;
  kind: QuestKind;
  /** POI name for visit quests, item id for fetch quests. */
  target: string;
  count: number;
  reward: number;
  intro: string[];
  reminder: string;
  done: string[];
}

const FETCHABLE: Record<ShopType, string[]> = {
  store: ['bread', 'apple', 'rope'],
  smith: ['helm'],
  inn: ['ale', 'stew'],
  apothecary: ['herbs', 'potion', 'antidote'],
};

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

export function compass(dx: number, dz: number): string {
  // north is -z on the map; angle measured from +x
  const a = Math.atan2(dz, dx);
  const idx = Math.round(a / (Math.PI / 4)) & 7;
  return DIRS[idx];
}

export function generateQuests(structures: Structures, seed: number): Quest[] {
  const rng = mulberry32(derive(seed, SALT.QUESTS));
  const quests: Quest[] = [];
  structures.villages.forEach((v, i) => {
    const q = i % 2 === 0 ? visitQuest(v, structures, rng) : fetchQuest(v, rng);
    if (q) quests.push(q);
  });
  return quests;
}

function visitQuest(v: Village, structures: Structures, rng: () => number): Quest | null {
  let best = null as (typeof structures.pois)[number] | null, bestD = Infinity;
  for (const p of structures.pois) {
    const d = Math.hypot(p.x - v.x, p.z - v.z);
    if (d > 25 && d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  const dir = compass(best.x - v.x, best.z - v.z);
  const paces = Math.round(bestD / 10) * 10;
  const reward = 20 + Math.round(bestD / 8);
  const openers = [
    `You look like someone who walks far. Have you heard of the ${best.name}?`,
    `Strangers are rare here. Do a favour for an old ${v.biome === 2 ? 'sand-rat' : 'villager'}?`,
    `Ah, a traveller! Just the person.`,
  ];
  return {
    id: `visit:${v.name}`, village: v.name, kind: 'visit', target: best.name, count: 1, reward,
    intro: [
      openers[Math.floor(rng() * openers.length)],
      `The ${best.name} lies to the ${dir}, about ${paces} paces from our square. Nobody here has been in years.`,
      `Go and see that it still stands, and I will pay you ${reward} gold for the trouble.`,
    ],
    reminder: `Found the ${best.name} yet? To the ${dir}, remember.`,
    done: [`You saw the ${best.name} with your own eyes? Wonderful.`, `Here, ${reward} gold, as promised. ${v.name} thanks you.`],
  };
}

function fetchQuest(v: Village, rng: () => number): Quest | null {
  const has = new Set(v.shops.map((s) => s.type));
  const missing = (Object.keys(FETCHABLE) as ShopType[]).filter((t) => !has.has(t));
  if (missing.length === 0) return null;
  const shopType = missing[Math.floor(rng() * missing.length)];
  const items = FETCHABLE[shopType];
  const itemId = items[Math.floor(rng() * items.length)];
  const item = ITEMS[itemId];
  const count = item.price > 20 ? 1 : 2;
  const reward = Math.round(item.price * count * 2.5) + 10;
  const shopName = SHOP_DEFS[shopType].name.toLowerCase();
  return {
    id: `fetch:${v.name}`, village: v.name, kind: 'fetch', target: itemId, count, reward,
    intro: [
      `We have no ${shopName} in ${v.name}, and I am in sore need of ${count === 1 ? `a ${item.name}` : `${count} ${item.name}`}.`,
      `Another town will have one. Bring ${count === 1 ? 'it' : 'them'} to me and I will pay ${reward} gold.`,
    ],
    reminder: `Still hoping for ${count === 1 ? `that ${item.name}` : `those ${count} ${item.name}`}. Try a ${shopName} in another town.`,
    done: [`${count === 1 ? `A ${item.name}` : `${count} ${item.name}`}! You are a wonder.`, `Take these ${reward} gold with my thanks.`],
  };
}

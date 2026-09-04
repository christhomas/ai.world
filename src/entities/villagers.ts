import { doorTile, type Village } from '../world/structures';
import type { Post, TileWorld } from './entity';

/**
 * Where a village's working day can send somebody.
 *
 * This is the one piece of a village that has to be read off the land rather than declared: a
 * shore only exists where there is water, heights only where the ground climbs, and a gate only
 * where a road comes in. Everything a villager's behaviour tree can ask for ("go to the market",
 * "go to the woods") resolves through here, so a trade that has nowhere to practise is simply
 * never offered in that village.
 *
 * It lives apart from the spawner because it is about the place, not about the people: the same
 * answers hold whether anybody is standing in the village or not.
 */

/**
 * The places a village's working day can send somebody. Whatever the land nearby actually
 * offers: a shore only where there is water, heights only where the ground climbs, and the
 * square as the fallback for everything, because a village always has a middle.
 */
export function postsOf(v: Village, world: TileWorld): Partial<Record<Post, [number, number]>> {
  const middle: [number, number] = [v.x, v.z];
  const posts: Partial<Record<Post, [number, number]>> = { square: middle };
  const inn = v.shops.find((shop) => shop.type === 'inn') ?? v.shops[0];
  if (inn) posts.inn = [inn.doorX + 0.5, inn.doorZ + 0.5];
  const shop = v.shops.find((s) => s.type === 'smith') ?? v.shops.find((s) => s.type === 'store') ?? inn;
  if (shop) posts.shop = [shop.doorX + 0.5, shop.doorZ + 0.5];
  if (v.stalls.length) posts.market = v.stalls[0];
  // the surgery is the house furthest from the market: quiet, and nobody treated in a crowd
  let quietest: [number, number] | null = null;
  let quietestAway = -1;
  for (const house of v.houses) {
    const [dx, dz] = doorTile(house);
    const away = Math.hypot(dx - v.x, dz - v.z);
    if (away > quietestAway) { quietestAway = away; quietest = [dx + 0.5, dz + 0.5]; }
  }
  if (quietest) posts.doctor = quietest;

  // walk a ring round the village and see what is out there
  let bestHeight = -Infinity;
  for (let step = 0; step < 24; step++) {
    const angle = (step / 24) * Math.PI * 2;
    for (const reach of [v.radius * 0.8, v.radius * 1.3, v.radius * 1.9]) {
      const x = v.x + Math.cos(angle) * reach, z = v.z + Math.sin(angle) * reach;
      const ground = world.heightAt(x, z);
      if (ground === null) {
        if (!posts.shore && world.waterAt(x, z) !== null) posts.shore = [v.x + Math.cos(angle) * (reach - 2), v.z + Math.sin(angle) * (reach - 2)];
        continue;
      }
      if (!posts.field && reach < v.radius * 1.4) posts.field = [x, z];
      if (!posts.woods && reach > v.radius * 1.5) posts.woods = [x, z];
      if (!posts.gate && world.isRoad(x, z)) posts.gate = [x, z];
      if (ground > bestHeight) { bestHeight = ground; posts.heights = [x, z]; }
    }
  }
  return posts;
}

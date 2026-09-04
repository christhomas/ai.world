import { PropKind } from '../../world/biomes';
import { ITEMS } from '../items';
import {
  Felling, Fire, OVER_FIRE, WOOD, standOf, timberAt, treeName, type Stand,
} from '../woodcraft';
import type { Surroundings } from './context';

/**
 * What Enter does with a saw and a pocket of fire rocks: a tree brought down for its wood, a fire
 * got going with some of it, and something raw held over the flames until it is worth eating.
 *
 * The rule the fire follows is worth saying out loud. Enter means a dozen things out in the
 * country, so a fire only answers when there is a reason for one, which is raw food in the pack;
 * otherwise a pocket of fire rocks would quietly swallow every press meant for a person, a hole
 * or a tree.
 */
export function craftInteractions(ctx: Surroundings) {
  const { player, state, sampler, hud, sound, seed, raining, persist } = ctx;

  /** The stands cut this sitting. Local for the same reason the holes are: the wood is derivable. */
  const felling = new Felling();

  /** The hero's own fire. There is one, because a person can only sit at one of them. */
  const fire = new Fire();

  /** The world day with its fraction: a fire and a stump both measure this same clock. */
  const now = (): number => state.day + state.time;

  /** One buffer for the whole search: a press looks at a dozen tiles and keeps none of them. */
  const probe = sampler.newSample();

  /** Read one tile the way somebody carrying a saw reads it. */
  const standAt = (tx: number, tz: number): Stand => {
    sampler.sampleTile(tx, tz, probe);
    return standOf(probe);
  };

  /** Every tile within a saw's reach of the hero, nearest first, because the nearest tree wins. */
  const withinReach = (): Array<[number, number]> => {
    const here: Array<[number, number]> = [];
    const span = Math.ceil(WOOD.REACH);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const tx = Math.floor(player.x) + dx, tz = Math.floor(player.z) + dz;
        // measured to the middle of the tile, since that is where the trunk is drawn
        if (Math.hypot(tx + 0.5 - player.x, tz + 0.5 - player.z) <= WOOD.REACH) here.push([tx, tz]);
      }
    }
    return here.sort((a, b) =>
      Math.hypot(a[0] + 0.5 - player.x, a[1] + 0.5 - player.z)
      - Math.hypot(b[0] + 0.5 - player.x, b[1] + 0.5 - player.z));
  };

  /** The first thing in the pack that wants a fire under it. */
  const rawInPack = (): string | null =>
    Object.keys(OVER_FIRE).find((id) => state.count(id) > 0) ?? null;

  /**
   * Enter beside a tree with a saw in the pack: bring it down for its wood.
   *
   * A stump and a whip both have something to say, but neither is allowed to speak over a tree
   * that would actually fall, so the excuse is held back until the whole reach has been searched.
   */
  const tryFell = (): boolean => {
    // no saw is not a complaint: a reminder here would fire against every tree in the wood
    if (!state.can('fell')) return false;

    let excuse: string | null = null;
    for (const [tx, tz] of withinReach()) {
      const stand = standAt(tx, tz);
      const kind = timberAt(seed, tx, tz, stand);
      if (kind === PropKind.None) continue;
      if (!felling.standing(tx, tz, now())) {
        const days = Math.ceil(felling.regrowsIn(tx, tz, now()));
        excuse ??= `A stump, and new growth ${days} day${days === 1 ? '' : 's'} off yet.`;
        continue;
      }
      // the stand is standing, so the only thing left that can refuse is the tree's own size
      const cut = felling.fell(seed, tx, tz, stand, now());
      if (!cut) {
        excuse ??= `This ${treeName(kind)} is a whip, and not worth the saw.`;
        continue;
      }
      const log = ITEMS[cut.item];
      state.give(cut.item, cut.count);
      sound.thud();
      hud.flash(`The ${treeName(kind)} comes down: ${cut.count}× ${log.name} ${log.emoji}`);
      persist();
      return true;
    }
    if (!excuse) return false;
    hud.flash(excuse);
    return true;
  };

  /**
   * Enter with wood, fire rocks and something raw: strike a fire where you are standing. Rain is
   * the only thing that can refuse once the pack has been looked through, which is why it is the
   * only refusal written down.
   */
  const tryKindle = (): boolean => {
    if (!state.can('kindle') || state.count('wood') < WOOD.FIRE_LOGS || !rawInPack()) return false;
    // a fire already burning at your feet is the cook's business, not the fire-lighter's
    if (fire.burning(now()) && fire.near(player.x, player.z)) return false;
    const lit = fire.light(player.x, player.z, now(), {
      logs: state.count('wood'), kindling: true, wet: raining(),
    });
    if (!lit) {
      hud.flash('Everything is too wet to catch. Wait the rain out.');
      return true;
    }
    state.take('wood', WOOD.FIRE_LOGS);
    sound.chime();
    hud.flash('The kindling catches. Hold something raw over it while it burns.');
    persist();
    return true;
  };

  /**
   * Enter at your own fire with something raw in the pack. The fire is the whole requirement:
   * there is no tool for cooking, only having got a fire going in the first place.
   */
  const tryCook = (): boolean => {
    if (!fire.near(player.x, player.z) || !fire.burning(now())) return false;
    const raw = rawInPack();
    if (!raw) return false;
    const done = fire.cook(raw, now())!;
    state.take(raw, 1);
    state.give(done, 1);
    sound.jingle();
    hud.flash(`${ITEMS[raw].name} over the flames: ${ITEMS[done].emoji} ${ITEMS[done].name}`);
    persist();
    return true;
  };

  return { tryFell, tryKindle, tryCook };
}

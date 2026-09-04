import { KINDS } from '../../entities/animals';
import type { Biome } from '../../world/biomes';
import { huntersOf, tilesToVillage } from '../camp';
import { ITEMS } from '../items';
import {
  CAMPS, campsIn, clearingOf, nearestCamp, takingFrom, type Clearing, type WildCamp,
} from '../wildcamps';
import type { Surroundings } from './context';

/**
 * What Enter does when you walk up to a camp that is not yours: read it, and take what is in it.
 *
 * There are two of them and they look almost the same from a distance, which is the whole point of
 * walking over. One has a banked fire and a pack inside the tent, and going through it is theft
 * however far from anywhere it is. The other went badly on a night the player was somewhere warm,
 * and everything in it belongs to whoever finds it.
 */
export function wildCampInteractions(ctx: Surroundings) {
  const { player, state, structures, sampler, dialogue, hud, sound, seed, persist } = ctx;

  /** One buffer for every tile read: working out what a clearing looks like keeps nothing. */
  const probe = sampler.newSample();

  /** Whoever wants to hear that somebody has been robbed says so here. */
  let witness: (camp: WildCamp) => void = () => {};

  /**
   * Register what to tell when a camp its owner is still using is gone through. Without one a
   * theft is only a line in the corner of the screen, which is this layer's whole opinion on it.
   */
  const onTheft = (tell: (camp: WildCamp) => void): void => { witness = tell; };

  /** The ground at a tile, as the person looking for a pitch would have read it that evening. */
  const groundAt = (tx: number, tz: number): Clearing => {
    sampler.sampleTile(tx, tz, probe);
    return clearingOf(probe, tilesToVillage(structures.villages, tx + 0.5, tz + 0.5));
  };

  /**
   * Every camp on a square of tiles, bounds included, for whatever draws them. Worth asking as a
   * chunk arrives and keeping the answer: it reads every tile in the square to work it out.
   */
  const campsAround = (minX: number, minZ: number, maxX: number, maxZ: number): WildCamp[] =>
    campsIn(seed, minX, minZ, maxX, maxZ, groundAt);

  /**
   * Has this one already been gone through? A camp is a fact about the world rather than a thing
   * that happened, so what was taken from it is remembered where the opened chests are.
   */
  const emptied = (camp: WildCamp): boolean => state.opened.has(camp.id);

  /** The camp you are standing in, if you are standing in one. */
  const underfoot = (): WildCamp | null => {
    const span = Math.ceil(CAMPS.REACH);
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    return nearestCamp(campsAround(tx - span, tz - span, tx + span, tz + span), player.x, player.z);
  };

  /** What is in it, said the way somebody counting it out would say it. */
  const worthOf = (camp: WildCamp): string => {
    const named = camp.items.map((id) => ITEMS[id]?.name ?? id);
    return [camp.gold > 0 ? `${camp.gold} gold` : '', ...named].filter(Boolean).join(', ');
  };

  /** What came through here, in the words of whatever actually lives in this country. */
  const tracks = (biome: Biome): string => {
    const hunters = huntersOf(biome).map((s) => KINDS[s.kind]?.label.toLowerCase() ?? s.kind);
    if (hunters.length === 0) return 'Nothing that lives out here should have been able to do this.';
    return `There are ${hunters.join(' and ')} prints all through the ashes.`;
  };

  /**
   * Take it. Salvage is a small grubby decision the game does not moralise about; theft is the
   * same decision with somebody still coming back for the pack, and it is said out loud.
   */
  const take = (camp: WildCamp): null => {
    state.inventory.gold += camp.gold;
    for (const id of camp.items) state.give(id, 1);
    state.opened.add(camp.id);
    state.version++;
    if (takingFrom(camp) === 'theft') {
      witness(camp);
      sound.thud();
      hud.flash(`You go through ${camp.who}'s camp and take ${worthOf(camp)}. Somebody will miss that.`);
    } else {
      sound.chime();
      hud.flash(`Salvaged ${worthOf(camp)} from ${camp.who}'s camp`);
    }
    persist();
    return null;
  };

  /**
   * Enter at somebody else's camp. The pages say what the ground says, so a player who walked up
   * to it already knows which of the two this is before reading a word.
   */
  const tryWildCamp = (): boolean => {
    const camp = underfoot();
    if (!camp) return false;
    if (emptied(camp)) {
      dialogue.start({
        speaker: `${camp.who}'s camp`, emoji: '⛺',
        pages: ['Poles, cold ash and a flattened square of grass. You have already had what there was.'],
      });
      return true;
    }
    const pages = camp.ruined
      ? [`The tent is down and torn along one side, and the fire went out days ago. ${tracks(sampler.biomeOf(camp.x, camp.z))} ${camp.who} did not pack this up. There is ${worthOf(camp)} in the pack still lying against the ridgepole.`]
      : [`The fire is banked for the night and there is a pot standing beside it. ${camp.who} is somewhere out in the dark and coming back. There is ${worthOf(camp)} in the pack inside the tent.`];
    dialogue.start({
      speaker: `${camp.who}'s camp`, emoji: camp.ruined ? '🎒' : '⛺',
      pages,
      choices: [
        { label: camp.ruined ? 'Take it' : 'Take it anyway', next: () => take(camp) },
        { label: 'Leave it be', next: () => null },
      ],
    });
    return true;
  };

  return { tryWildCamp, onTheft, campsAround, emptied };
}

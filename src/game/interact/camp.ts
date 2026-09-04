import { mulberry32 } from '../../core/rng';
import { KINDS } from '../../entities/animals';
import { isDaytime } from '../../entities/entity';
import { BIOMES } from '../../world/biomes';
import { CAMP, heartsFrom, huntersOf, nightAt, tilesToVillage, wakes, type Country } from '../camp';
import { Carcasses, paidFor } from '../furs';
import { ITEMS } from '../items';
import type { Surroundings } from './context';

/**
 * What Enter does over a body and at the end of a day's walk: take the hide off something you
 * killed, and pitch a tent where you are standing.
 *
 * The two belong together because they are the same journey. Furs are only worth carrying to the
 * far country that has none, and the far country is further than a day, so the trade exists only
 * for somebody willing to sleep out on the way there.
 */
export function campInteractions(ctx: Surroundings) {
  const {
    player, state, structures, sampler, sailing, dialogue, hud, sound, seed, persist,
  } = ctx;

  /**
   * The bodies left lying about this sitting. It lives here rather than in the world for the
   * reason the dug holes do: what a carcass gives up follows from the kind and the knife, so
   * there is nothing to save and nobody to tell.
   */
  const carcasses = new Carcasses();

  /** Whoever is able to put a creature in the world says so here. */
  let arrive: (kind: string, x: number, z: number) => void = () => {};

  /**
   * Something with a hide has fallen. Called by whoever resolved the kill, because a swing is not
   * this file's business and a body afterwards is.
   */
  const fell = (kind: string, x: number, z: number): void => { carcasses.fell(kind, x, z); };

  /** Register how a woken camp's visitor gets into the world. Without one, a bad night is only a fright. */
  const onVisitor = (put: (kind: string, x: number, z: number) => void): void => { arrive = put; };

  /** Let the bodies nobody came back for go, at the same rate everything else out here ages. */
  const age = (dt: number): void => carcasses.age(dt);

  /** The bodies still lying about, for whatever draws them. */
  const bodies = () => carcasses.all;

  /**
   * Enter over a body: take the hide. A knife makes it certain, and bare hands are worth trying
   * once, which is the closest this game comes to telling you to go and buy the knife.
   */
  const trySkin = (): boolean => {
    const body = carcasses.nearest(player.x, player.z);
    if (!body) return false;
    const kind = KINDS[body.kind];
    const knife = state.can('skin');
    dialogue.start({
      speaker: `The dead ${kind?.label.toLowerCase() ?? body.kind}`,
      emoji: kind?.emoji ?? '🐺',
      pages: [knife
        ? 'The fur is still good. Work the knife in along the belly and it will come away whole.'
        : 'The fur is still good, and you have nothing on you to cut it with. Pull at it and hope?'],
      choices: [
        { label: knife ? 'Skin it' : 'Pull at it', next: () => {
          // seeded from where it fell, so a torn hide is torn for whoever gets there first
          const hide = carcasses.take(body, knife, mulberry32(seed ^ Math.floor(body.x * 131 + body.z * 977)));
          if (!hide) {
            sound.thud();
            hud.flash('The hide comes away in strips. Worth nothing now.');
            return null;
          }
          const item = ITEMS[hide];
          state.give(hide, 1);
          state.version++;
          sound.chime();
          const here = paidFor(hide, sampler.biomeOf(player.x, player.z));
          hud.flash(`Skinned it: ${item.emoji} ${item.name}. Traders in this country pay about ${here}g.`);
          persist();
          return null;
        } },
        { label: 'Leave it', next: () => null },
      ],
    });
    return true;
  };

  /** The camp as somebody standing in it would read it before deciding to lie down. */
  const readGround = (land: Country): string => {
    const words = [`${BIOMES[land.biome].name}, and flat enough to lie down on.`];
    const hunters = huntersOf(land.biome).map((s) => `${KINDS[s.kind]?.label.toLowerCase() ?? s.kind}s`);
    if (land.toVillage <= 0) words.push('There are lamps still lit in the windows behind you.');
    else if (land.toVillage < CAMP.LONELY) words.push('The village is near enough that little comes this far out.');
    else if (hunters.length > 0) words.push(`There are ${hunters.join(' and ')} in this country.`);
    else words.push('Nothing much lives out here, which is not the same as nothing at all.');
    return words.join(' ');
  };

  /**
   * A night under canvas. You lie down in your boots with the pack beside you, so being woken
   * costs you nothing but the sleep: whatever you had is still on you when you stand up.
   */
  const sleepOut = (land: Country): void => {
    const night = nightAt(seed, state.day, Math.floor(player.x), Math.floor(player.z), land);
    const woke = wakes(night, state.time);
    state.time = woke.time;
    state.day += woke.days;
    state.heal(heartsFrom(night, state.maxHpTotal));
    persist();

    if (!night.visitor) {
      sound.chime();
      hud.flash('You sleep under canvas and wake stiff, cold and mended, at first light.');
      return;
    }
    // putting a creature in the world is not this layer's job: it says what arrived and where
    arrive(
      night.visitor,
      player.x + Math.cos(night.bearing) * night.away,
      player.z + Math.sin(night.bearing) * night.away,
    );
    sound.thud();
    const kind = KINDS[night.visitor];
    hud.flash(`${kind?.emoji ?? '🐺'} Something is in the camp. You are on your feet before you are awake.`);
  };

  /**
   * Enter with a tent on your back: sleep where you are standing. Half the healing of a bed, none
   * of the price, and whatever walks in while you are asleep.
   */
  const tryCamp = (): boolean => {
    if (!state.can('camp')) return false;
    // a tent is for the night, and a deck is not ground: by day it is only weight on your back,
    // which is also what keeps it from answering Enter presses meant for somebody standing there
    if (isDaytime(state.time) || sailing.sailing) return false;
    const land: Country = {
      biome: sampler.biomeOf(player.x, player.z),
      toVillage: tilesToVillage(structures.villages, player.x, player.z),
    };
    dialogue.start({
      speaker: 'Your Camp', emoji: '⛺',
      pages: [`${readGround(land)} Pitch the tent and sleep here?`],
      choices: [
        { label: 'Pitch the tent', next: () => { sleepOut(land); return null; } },
        { label: 'Walk on', next: () => null },
      ],
    });
    return true;
  };

  return { trySkin, tryCamp, fell, onVisitor, age, bodies };
}

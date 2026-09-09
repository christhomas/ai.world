import { hashString, mulberry32 } from '../core/rng';
import type { Player } from '../entities/player';
import type { Register } from '../world/register';
import { luxuryFor, storeysFor, type Luxury } from '../world/prosperity';
import type { Site, Structures } from '../world/structures';
import type { TerrainSampler } from '../world/terrain';
import type { Sound } from './audio';
import type { Director } from './director';
import { clockAt } from './jail';
import { MINES, mineIdOf, type Mines, type Working } from './mines';
import type { Nemesis, Realm } from './nemesis';
import type { Online } from './online';
import type { Places } from './places';
import type { Remains } from './remains';
import { ROAM, warningFor as warningOfBand, wayTo, type Roaming } from './roaming';
import type { GameState } from './state';

/**
 * The day turning over, everywhere the hero is not.
 *
 * Villages age, bands lean on the places they are camped outside, miners go down and some of them
 * do not come up. None of it needs anybody to be watching — that is the point of it — but all of
 * it has to reach the player somehow, so this is also where the world's news becomes a line in
 * the console or a word on the screen.
 */
export interface Telling {
  seed: number;
  state: GameState;
  player: Player;
  places: Places;
  structures: Structures;
  sampler: TerrainSampler;
  register: Register;
  roaming: Roaming;
  nemesis: Nemesis;
  mines: Mines;
  online: Online;
  remains: Remains;
  sound: Sound;
  director: Director;
  /** Which cave each village calls its mine. A pure function of the ground, so it never changes. */
  claimed: Map<string, Site>;
  /** What each village has built for itself, which a good year raises and a bad one does not. */
  villageLuxury: Map<string, Luxury>;
  /** Places the hero has been. News from anywhere else is news about strangers. */
  discovered: Set<string>;
  /** Everything Old Nettle's cycle reaches into, gathered when it is asked for rather than held. */
  realm: () => Realm;
  /** A builder who has finished and not been paid has said so in the pub by now. */
  builderDay: () => void;
  /** And whatever else happened in a village overnight, from the interactions that own it. */
  villageNights: () => Array<{ kind: string; village: string; name: string }>;
  /** A line into the console, which is where word from elsewhere arrives. */
  say: (line: string) => void;
  /** And onto the screen, which is where word about here does. */
  flash: (message: string) => void;
  persist: () => void;
}

export function createTidings(ctx: Telling) {
  const {
    seed, state, player, places, structures, sampler, register, roaming, nemesis, mines, online,
    remains, sound, director, claimed, villageLuxury, discovered, realm, builderDay, villageNights,
    say, flash, persist,
  } = ctx;

  /** The last thing each village was heard to say about its trouble, so it is not said twice. */
  const pressSaid = new Map<string, string>();

  /**
   * The mines being worked today, and who would hear about a bad day at one.
   *
   * Only villages the register has been told about are in it, which is the register's own rule
   * rather than a new one: a place nobody has walked into has no people in it yet, so it has no
   * miners either. Rebuilt when another village comes onto the register and not otherwise,
   * because this runs every frame and the answer only changes when somebody walks somewhere new.
   */
  let workings: Working[] = [];
  let workingsFor = -1;
  const minesWorked = (): Working[] => {
    const settled = new Set(register.settled());
    if (settled.size === workingsFor) return workings;
    workingsFor = settled.size;
    workings = [];
    for (const [village, cave] of claimed) {
      const home = structures.villages.find((v) => v.name === village);
      if (!home || !settled.has(village)) continue;
      // the story reaches the village that works it and its nearest neighbours, which is how
      // somebody in a pub two valleys over can warn you off a hole you have never seen
      const heardIn = [village, ...structures.villages
        .filter((v) => v.name !== village && settled.has(v.name))
        .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))
        .slice(0, MINES.HEARD_IN - 1)
        .map((v) => v.name)];
      workings.push({ village, mine: mineIdOf(cave), name: cave.name, x: cave.x, z: cave.z, heardIn });
    }
    return workings;
  };

  /**
   * What each village has made of itself, everywhere, once a day.
   *
   * Houses grow a storey when the people living in them can afford one, and a village raises a
   * bath house out of everything it holds between it; the chunks pick up both the next time they
   * are built, which is why nothing has to be told that a place has got richer.
   *
   * This used to be four lines inside the loop over `roaming.pressings`, so a village was assessed
   * only on a day a warband happened to be standing over it. A place nobody was raiding was never
   * looked at at all — which is to say the case the whole feature is about, a village left alone
   * long enough to prosper, was the one case that could never reach it. Peace is the normal
   * condition of most of the country and it was the condition with no code behind it.
   *
   * Gated on the day, because `theDaysNews` runs out of the frame loop and this walks every person
   * in every village the register knows about; sixty times a second that is real work for an
   * answer that changes once. The number of villages is watched as well as the day, and that is
   * not belt and braces: walking into a new place settles it on the spot, and a village first
   * assessed tomorrow would build its houses a storey short all this afternoon.
   */
  let assessedOn = -1;
  let assessedVillages = -1;
  const whatTheyHaveMadeOfThemselves = (): void => {
    const settled = register.settled();
    if (assessedOn === state.day && assessedVillages === settled.length) return;
    assessedOn = state.day;
    assessedVillages = settled.length;
    for (const village of settled) {
      const folk = register.living(village);
      const worth = folk.reduce((sum, p) => sum + p.purse, 0);
      sampler.storeys.set(village, storeysFor(worth / Math.max(1, folk.length)));
      villageLuxury.set(village, luxuryFor(worth, hashString(village)));
    }
  };

  return {
    minesWorked,
    /** Everything the country did while nobody was looking, once a frame. */
    theDaysNews: (): void => {
      // a day turning over is a day in the villages too: lives run out, and children are born
      for (const word of nemesis.advance(clockAt(state), realm())) say(word.said);
      for (const band of roaming.advance(state.day)) flash(warningOfBand(band));
      // a band camped on a village's doorstep costs it people, and the same people on every client
      for (const press of roaming.pressings(structures.villages, state.day)) {
        const pick = mulberry32(press.band.seed ^ hashString(press.village) ^ state.day);
        const living = [...register.living(press.village)];
        for (let n = 0; n < press.toll && living.length > 0; n++) {
          const [taken] = living.splice(Math.floor(pick() * living.length), 1);
          const death = register.bury(taken.id, state.day);
          if (death) online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
        }
        // a village under the same band says so once, not every morning until it is dealt with:
        // news repeated daily stops being news and starts being wallpaper
        // nobody trades while their neighbours are being buried, which is what makes a village's
        // prosperity something the player can protect rather than a number that only goes up
        register.leanedOn(press.village, press.pressure);
        if (press.pressure >= ROAM.PRESS_BLED && pressSaid.get(press.village) !== press.said) {
          pressSaid.set(press.village, press.said);
          // the news is remembered without the direction, because the direction changes with every
          // step the player takes and would make the same news new again for ever
          const where = structures.villages.find((v) => v.name === press.village);
          const way = where ? wayTo(where, player) : null;
          say(way ? `${press.said} ${way}` : press.said);
          director.saw('trouble');
        }
      }
      // a builder who has finished and not been paid has said so in the pub by now, and the village
      // holds it against you for every day it goes on standing there unsettled
      builderDay();
      for (const change of [...register.advance(state.day), ...villageNights()]) {
        if (change.kind === 'died' && discovered.has(change.village)) {
          say(`Word from ${change.village}: ${change.name} has died.`);
        }
      }
      /**
       * A day at the face, in every village that has a mine.
       *
       * After the register has caught up, because a mine is worked by people and the register is
       * who they are. What comes up goes into the miners' own purses, so it leaves again through
       * their dinner and their upkeep the way anybody else's money does — which is the whole reason
       * to mint it there rather than crediting a village a number nobody spends.
       */
      for (const dug of mines.advance(state.day, minesWorked(), (v) => register.living(v))) {
        if (dug.lost) {
          // what he had on him was minted this morning and is now on the floor where he fell, which
          // is the only reason anybody would go down a mine that has just killed somebody
          remains.leave(dug.lost.name, 'miner', dug.x, dug.z, dug.dropped, 'nugget', seed ^ Math.floor(dug.x * 131 + dug.z * 977));
          const death = register.bury(dug.lost.id, dug.day);
          if (death) online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
        }
        if (dug.scared && discovered.has(dug.village)) {
          say(dug.lost
            ? `Word from ${dug.village}: ${dug.lost.name} did not come up out of ${dug.name}.`
            : `Word from ${dug.village}: they came running up out of ${dug.name} today.`);
        }
      }
      // and last, because a day's wages and a day's gold are both in the purses by now: what every
      // village in the country is worth this evening, and what it has managed to build with it
      whatTheyHaveMadeOfThemselves();
      // and the other half of it: a mine the player has fought through is still a mine nobody will
      // go down until somebody walks into the village and says otherwise. Standing in the square is
      // that somebody, which is why this is proximity and not a menu
      for (const working of places.outdoors ? minesWorked() : []) {
        const home = structures.villages.find((v) => v.name === working.village);
        if (!home || Math.hypot(home.x - player.x, home.z - player.z) > home.radius) continue;
        const said = mines.told(working.mine, working.name);
        if (said !== null) {
          flash(said); sound.chime();
          // a village that has been reassured is reassured for everybody, not only for whoever walked in
          online.report({ kind: 'told', mine: working.mine });
          persist();
        }
      }
    },
  };
}

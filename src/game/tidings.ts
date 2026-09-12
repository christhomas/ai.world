import { hashString, mulberry32 } from '../core/rng';
import type { Player } from '../entities/player';
import type { Register } from '../world/register';
import { luxuryFor, storeysFor, type Luxury } from '../world/prosperity';
import type { Site, Structures } from '../world/structures';
import type { Around } from '../world/around';
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
  /**
   * Everything this world holds, for looking a village up by the name a working, a pressing or a
   * roaming band already gave it — which is a different question from what is near the hero.
   */
  structures: Structures;
  /** And what is near a place, for how far a piece of news travels. See `world/around.ts`. */
  around: Around;
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
    seed, state, player, places, structures, around, sampler, register, roaming, nemesis, mines, online,
    remains, sound, director, claimed, villageLuxury, discovered, realm, builderDay, villageNights,
    say, flash, persist,
  } = ctx;

  /**
   * The last thing each band was heard to say about the village it is leaning on.
   *
   * Keyed by the band *and* the village, and the key is the whole of a bug that put twenty-seven
   * lines a second into the chat. `Roaming.pressings` hands back one entry per band **per village**,
   * so two bands camped on Stonedale are two pressings with two different sentences. Keyed by the
   * village alone, each band's line was forever unlike the one the other band had just stored, so
   * each was "new" again on every frame, for ever — the same two sentences about bears and the
   * walking dead, appended until the tab was closed, every one of them forcing two synchronous
   * layouts in `chat.ts` on the way past.
   *
   * A memo keyed by less than the thing it is remembering does not merely forget: it alternates,
   * and alternating is indistinguishable from news.
   */
  const pressSaid = new Map<string, string>();

  /** What one band has to say about one village, which is the thing above being remembered. */
  const heardOf = (band: string, village: string): string => `${band}:${village}`;

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
      const heardIn = [village, ...around.villages(home.x, home.z, MINES.HEARD_WITHIN)
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

  /**
   * Everything the country did overnight, worked out once for the day it belongs to.
   *
   * Every line of it is about `state.day` and nothing else: the nemesis floors the clock it is
   * handed, a band's round is a pure function of the day, a toll is rolled from the band, the
   * village and the day, and the register advances to a whole day or does nothing at all. So all
   * of it gave the same answer sixty times a second and paid for it sixty times a second —
   * measured at half a millisecond a frame, thirty milliseconds a second, most of it rebuilding
   * every band in the country from the seed to ask where it was standing.
   *
   * Worse than the cost, and the reason this is a fix rather than a tidying: the toll loop below
   * *buries people*, and it buried a fresh handful on every frame. `tollOf` is deterministic, so
   * every frame took the same number again off a village that was one shorter than it had been a
   * sixtieth of a second earlier — a village under real pressure emptied in the time it takes to
   * read this sentence. It went unnoticed because the villages being pressed in the measured runs
   * were ones nobody had walked into, and a village nobody has settled has no people in it to take.
   */
  const theDayTurning = (): void => {
    // a day turning over is a day in the villages too: lives run out, and children are born
    for (const word of nemesis.advance(clockAt(state), realm())) say(word.said);
    for (const band of roaming.advance(state.day)) flash(warningOfBand(band));
    /** The worst thing leaning on each village today, which is what the register is told. */
    const worst = new Map<string, number>();
    // a band camped on a village's doorstep costs it people, and the same people on every client
    // and what each village has grown into, because a band leans harder on a place worth leaning
    // on: a town has more in its granary than a hamlet. See `worthPressing`
    for (const press of roaming.pressings(
      structures.villages, state.day, (v) => register.rankOf(v), (v) => register.herdOf(v),
    )) {
      // and what a dragon takes instead of people: the herd the farmers' whole living is made of,
      // so a village it passes over gets poorer in a way anybody living there could explain
      const carried = press.cattle > 0 ? register.cattleLost(press.village, press.cattle) : 0;
      if (carried > 0) online.report({ kind: 'herd', village: press.village, head: register.herdOf(press.village) });
      const pick = mulberry32(press.band.seed ^ hashString(press.village) ^ state.day);
      const living = [...register.living(press.village)];
      for (let n = 0; n < press.toll && living.length > 0; n++) {
        const [taken] = living.splice(Math.floor(pick() * living.length), 1);
        const death = register.bury(taken.id, state.day);
        if (death) online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
      }
      /*
       * Nobody trades while their neighbours are being buried, which is what makes a village's
       * prosperity something the player can protect rather than a number that only goes up.
       *
       * Told once per village and not once per pressing, and it is the same fault as the memo
       * above wearing different clothes. `pressings` comes back worst first and `leanedOn`
       * overwrites, so a village with two bands over it was recorded at whichever pressure came
       * *last* — the lightest of them. Two bands made a place safer than one: the register
       * believed the gentler of the two, and a village being bled by a dragon went on trading
       * and bearing children because a wolf pack was also in the neighbourhood.
       */
      if (!worst.has(press.village)) {
        worst.set(press.village, press.pressure);
        register.leanedOn(press.village, press.pressure);
      }
      // a band says its piece about a village once, not every morning until it is dealt with:
      // news repeated daily stops being news and starts being wallpaper
      const heard = heardOf(press.band.id, press.village);
      if (press.pressure >= ROAM.PRESS_BLED && pressSaid.get(heard) !== press.said) {
        pressSaid.set(heard, press.said);
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
    /*
     * And the same word again, now that the register has lived the day.
     *
     * A pressing is deliberately about one day and expires, so `Pressings` keeps the day it was
     * told on and answers two different questions from it: what to charge the village while it
     * lives that day, which wants the telling to have come *before* the day was lived, and what is
     * standing over the place *now*, which the clerk's book and the domesday report both ask and
     * which wants a telling dated today.
     *
     * Saying it every frame satisfied both by accident — the first frame of a morning told the
     * register before it advanced and every frame after it told the register again, from the far
     * side. Once a day is the honest version, so it is said twice on purpose and the comment is
     * here rather than the accident being left to be rediscovered.
     */
    for (const [village, pressure] of worst) register.leanedOn(village, pressure);
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
  };

  /** The day whose news has been told. Nought would be a day, and day one is the first there is. */
  let toldOn = -1;

  return {
    minesWorked,
    /** Everything the country did while nobody was looking, once a frame. */
    theDaysNews: (): void => {
      if (toldOn !== state.day) {
        toldOn = state.day;
        theDayTurning();
      }
      /*
       * And the two things that are not about the day at all, which is why they are out here where
       * the gate cannot reach them.
       *
       * The first is what every village is worth this evening. It keeps its own gate — the day
       * *and* the number of villages — because walking into a new place settles it on the spot,
       * and a village first assessed tomorrow would stand its houses a storey short all afternoon.
       * It runs after the day's news for the reason it always did: a day's wages and a day's gold
       * are both in the purses by now.
       */
      whatTheyHaveMadeOfThemselves();
      // and the other half of it: a mine the player has fought through is still a mine nobody will
      // go down until somebody walks into the village and says otherwise. Standing in the square is
      // that somebody, which is why this is proximity and not a menu — and why it is asked every
      // frame rather than every morning
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

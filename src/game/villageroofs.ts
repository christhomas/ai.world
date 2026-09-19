import { whichFieldClears, type FieldClearing } from '../world/fieldbuilds';
import { clearedFieldTiles } from '../world/fields';
import type { Settlement } from '../world/settlement';
import type { TerrainSampler } from '../world/terrain';
import { RAISING_TAKES, beganOn, isARoof } from '../world/roofs';
import { civicFor, whereItStands } from '../world/civics';
import { BUILD } from './building';
import type { Village } from '../world/structures';

/**
 * The houses a village has raised for itself, as things a player can walk up to.
 *
 * The whole of item 44 was invisible until this existed. A village fills its houses, saves, raises
 * another and grows into it — and a player standing in the square saw the same ten roofs for two
 * hundred days, because the houses that are *drawn* come from the seed's own list and nothing ever
 * added to one. Thirty-one souls became ninety-three with nothing built that anybody could see.
 *
 * The route was argued for in the work list before any of this was written, and it is the one a
 * player's own commissions already take: a commission is drawn from the list of commissions rather
 * than from the world's structures, *precisely because it was not there when the terrain was
 * generated*. A village's raised roof is the same object on the same plot rules, so it goes through
 * the same door.
 *
 * Where they stand is the seed's business rather than this file's: `structures.ts` finds the plots
 * a village has not built on when it lays the place out, after everything else is standing, so the
 * eleventh house is where the country always said it would be and two machines agree about it
 * without a word crossing the wire.
 */

/** One roof, in the shape the building site draws a commission in. */
export interface Raised {
  id: string;
  x: number;
  z: number;
  rot: number;
  what: string;
  stage: 'marked' | 'begun' | 'nearly' | 'done';
  storeys: number;
}

/**
 * How far along a village's roof is today: the four stages a passer-by reads any site by.
 *
 * Item 79. The ledger records the morning a roof was begun, so the same subtraction a player's own
 * commission gets is available here — and a frame going up in a village you are walking through,
 * which is most of why the stages exist at all, is a thing that can happen.
 *
 * A roof with no morning written against it is finished, and that is a real answer rather than a
 * missing one: every roof raised before the day was recorded was already standing when anybody
 * started counting, and saying so is the truth about it. The thresholds are `building.ts`'s, because
 * a village's six days and a builder's six days are the same six days and a player watching both go
 * up should not be reading two different clocks.
 */
export function raisedStage(work: string, today: number): Raised['stage'] {
  const began = beganOn(work);
  if (began === null) return 'done';
  const done = Math.max(0, Math.min(1, (today - began) / RAISING_TAKES));
  if (done >= 1) return 'done';
  if (done >= BUILD.NEARLY_AT) return 'nearly';
  if (done >= BUILD.BEGUN_AT) return 'begun';
  return 'marked';
}

/**
 * Every roof every village near the hero has raised, at whatever stage of building it has reached.
 *
 * It was finished-always until the 13th, because a village's building work was a day's wages in a
 * ledger rather than a site with pegs in it and nothing anywhere said which morning of its six a
 * village house was on. The ledger records the morning now — item 79 — so a frame going up in a
 * village you are walking through is a thing that happens, which is the whole of why the four
 * stages exist. A roof with no morning against it was already standing before anybody counted, and
 * is drawn finished.
 *
 * Capped at the plots the founding found, so a village whose books have run ahead of its ground
 * draws what it has room for and no more. A roof with nowhere to stand is a roof nobody can see
 * anyway, and inventing a plot here would put a house through a paddock wall.
 */
export function raisedRoofs(
  villages: readonly Village[],
  worksOf: (village: string) => readonly string[],
  /** What day it is, for deciding how far along each one is. Left out, everything is finished. */
  today?: number,
): Raised[] {
  const out: Raised[] = [];
  for (const village of villages) {
    const works = worksOf(village.name);
    const raised = works.filter(isARoof);
    const hallWork = latestHallWork(works);
    if (hallWork && village.hall) {
      const building = village.hall.building;
      out.push({
        id: `${village.name}-hall`,
        x: building.tx + 0.5, z: building.tz + 0.5, rot: building.rot,
        what: `civic-townhall-${village.biome}`,
        stage: today === undefined ? 'done' : raisedStage(hallWork, today),
        storeys: 1,
      });
    }
    /*
     * And the things a village bought that are not roofs.
     *
     * Six things a hall spends its treasury on and, until this line, one of them appeared: a
     * village could pay 3,800 gold for a watchtower, carry the watchman's wage from that morning
     * on, and a player walking in would see a field. Where each of them stands is `civics.ts`'s
     * business, because a well belongs on the square and a tower belongs at the rim and one rule
     * for all of them would be right about one and visibly wrong about the others.
     *
     * Queued behind the roofs on purpose: a bath house standing on the plot the next family was
     * going to live on is a village that spent its money twice.
     */
    let after = raised.length;
    for (const work of works) {
      const civic = civicFor(beforeTheColon(work));
      if (!civic) continue;
      const at = whereItStands(civic, village, village.spare, after);
      if (!at) continue;
      if (civic.stands === 'plot') after++;
      out.push({
        id: `${village.name}-${civic.id}`,
        x: at.x, z: at.z, rot: at.rot,
        what: `civic-${civic.id}`,
        stage: today === undefined ? 'done' : raisedStage(work, today),
        storeys: 1,
      });
    }
    for (let n = 0; n < raised.length && n < village.spare.length; n++) {
      const plot = village.spare[n];
      out.push({
        id: `${village.name}-roof-${n}`,
        x: plot.tx + 0.5,
        z: plot.tz + 0.5,
        rot: plot.rot,
        /*
         * Drawn as that country's own cottage whatever size it is, for now.
         *
         * A village raises four sizes — cottage, house, longhouse, great house — and the renderer
         * has one house per biome. Drawing a great house as a cottage would be a lie about a thing
         * a player can walk up to; drawing all four as the house that exists is the truthful
         * version of the same compromise, and the day there are four models this line reads
         * `roofOfWork(...)`. The biome goes in the name because that is how `render/site.ts` is
         * told which of the six to put up, the same way the terrain is told.
         */
        what: `raised-${plot.biome}`,
        stage: today === undefined ? 'done' : raisedStage(raised[n], today),
        storeys: 1,
      });
    }
  }
  return out;
}

/**
 * The same list, worked out about once a day instead of sixty times a second.
 *
 * What a village has raised usually changes when the register advances. A vote is the exception:
 * it adds hall work immediately, on the same day, so the cache also watches each book's identity
 * and length. The register only appends work; a replay replaces the array, and both are caught.
 */
export function roofWatch(
  villagesNow: () => readonly Village[],
  worksOf: (village: string) => readonly string[],
  /**
   * Told, once a day, which tiles have been cleared into fields.
   *
   * The same book answers both questions — `works` is where a raised roof and a cleared acre are
   * both written down — and both are wanted at the same moment and at the same rate: once a day,
   * rather than sixty times a second. Keeping it here rather than wrapping this function at the
   * boot file means the day is decided in one place, and `main.ts` goes on asking for the roofs.
   */
  fieldsCleared: (works: readonly string[]) => void = () => {},
): (day: number) => readonly Raised[] {
  let surveyed = Number.NaN;
  let asked = Number.NaN;
  let names: string[] = [];
  let books: readonly (readonly string[])[] = [];
  let lengths: number[] = [];
  let built: readonly Raised[] = [];
  return (day) => {
    const villages = villagesNow();
    const today = Math.floor(day);
    if (today !== surveyed) {
      surveyed = today;
      fieldsCleared(villages.flatMap((village) => worksOf(village.name)));
    }
    let changed = today !== asked || villages.length !== names.length;
    for (let at = 0; at < villages.length; at++) {
      const book = worksOf(villages[at].name);
      if (villages[at].name !== names[at] || book !== books[at] || book.length !== lengths[at]) changed = true;
    }
    if (changed) {
      asked = today;
      names = villages.map((village) => village.name);
      books = villages.map((village) => worksOf(village.name));
      lengths = books.map((book) => book.length);
      built = raisedRoofs(villages, worksOf, today);
    }
    return built;
  };
}

/** The latest declaration work on this hall; a city vote rebuilds the same body rather than cloning it. */
function latestHallWork(works: readonly string[]): string | null {
  for (let at = works.length - 1; at >= 0; at--) {
    const id = works[at].split('@')[0];
    if (id === 'townhall' || id === 'cityhall') return works[at];
  }
  return null;
}

/**
 * The work's own name, without the day written after it.
 *
 * A `works` entry is `watchtower` or `watchtower:412` depending on whether the morning it was begun
 * was recorded, which is the same shape a roof entry has and for the same reason — see `roofs.ts`.
 */
function beforeTheColon(work: string): string {
  const at = work.indexOf(':');
  return at < 0 ? work : work.slice(0, at);
}

/**
 * What the villages have raised and what they have cleared, as one thing to ask.
 *
 * Both are written in the same book — `works` holds a raised roof and a cleared acre alike — and
 * both are wanted at the same moment and at the same rate: once a day rather than sixty times a
 * second. So the register is told who may clear an acre this morning, the ground is told which
 * trees the cleared acres took, and the caller gets the roofs, from one call.
 *
 * It is here rather than at the boot file because `main.ts` is assembly and nothing else: a
 * feature that needs six lines of it has put its wiring in the wrong place, and the module that
 * already owns "what has this village built, and when did the day turn" is this one.
 */
export function whatTheVillagesRaised(
  register: {
    worksOf: (village: string) => readonly string[];
    fieldsAreSurveyedBy: (
      survey: (village: string, settlement: Settlement) => FieldClearing | null,
    ) => void;
  },
  villagesNow: () => readonly Village[],
  sampler: TerrainSampler,
  ground: { clearFields: (tiles: Iterable<{ x: number; z: number }>) => void },
): (day: number) => readonly Raised[] {
  register.fieldsAreSurveyedBy((name, settlement) => {
    const village = villagesNow().find((at) => at.name === name);
    return village ? whichFieldClears(village, settlement, sampler) : null;
  });
  return roofWatch(villagesNow, (village) => register.worksOf(village),
    (works) => ground.clearFields(clearedFieldTiles(works)));
}

import miner from '../../models/creatures/miner.json';
import priest from '../../models/creatures/priest.json';
import doctor from '../../models/creatures/doctor.json';
import constable from '../../models/creatures/constable.json';
import mayor from '../../models/creatures/mayor.json';
import farmer from '../../models/creatures/farmer.json';
import cowboy from '../../models/creatures/cowboy.json';
import ogre from '../../models/creatures/ogre.json';
import wight from '../../models/creatures/wight.json';
import nettle from '../../models/creatures/nettle.json';
import dragon from '../../models/creatures/dragon.json';
import cow from '../../models/creatures/cow.json';
import sheep from '../../models/creatures/sheep.json';
import horse from '../../models/creatures/horse.json';
import chicken from '../../models/creatures/chicken.json';
import deer from '../../models/creatures/deer.json';
import rabbit from '../../models/creatures/rabbit.json';
import fox from '../../models/creatures/fox.json';
import bear from '../../models/creatures/bear.json';
import camel from '../../models/creatures/camel.json';
import lizard from '../../models/creatures/lizard.json';
import vulture from '../../models/creatures/vulture.json';
import frog from '../../models/creatures/frog.json';
import duck from '../../models/creatures/duck.json';
import shark from '../../models/creatures/shark.json';
import orca from '../../models/creatures/orca.json';
import heron from '../../models/creatures/heron.json';
import goat from '../../models/creatures/goat.json';
import eagle from '../../models/creatures/eagle.json';
import hare from '../../models/creatures/hare.json';
import wolf from '../../models/creatures/wolf.json';
import elk from '../../models/creatures/elk.json';
import traveller from '../../models/creatures/traveller.json';
import villager from '../../models/creatures/villager.json';
import rat from '../../models/creatures/rat.json';
import bat from '../../models/creatures/bat.json';
import slime from '../../models/creatures/slime.json';
import skeleton from '../../models/creatures/skeleton.json';
import troll from '../../models/creatures/troll.json';
import yeti from '../../models/creatures/yeti.json';
import bigfoot from '../../models/creatures/bigfoot.json';
import shopkeeper from '../../models/creatures/shopkeeper.json';
import hero from '../../models/creatures/hero.json';
import { Fields, PropertiesError, asNumber } from '../core/properties';
import {
  ANIM_ROLES, biped, box, cone, cyl, ico, quadruped,
  type BipedOpts, type PartDef, type QuadOpts,
} from './rigs';

/**
 * Every body in the game, one file each, in `models/creatures/`.
 *
 * They used to be TypeScript: three source files holding thirty-five part lists between them, and
 * `animals.ts` alone was five hundred lines of arithmetic nobody could scan. The argument for
 * moving them out is the one `properties/` already won. A rig is data. It is edited far more often
 * than the code around it — by a person nudging a hat, and by Claude through the character builder,
 * which is the loop this change is really for — and neither of them should have to find the right
 * entry in the right one of three files first. `models/creatures/wolf.json` is where the wolf is,
 * and that sentence is now short enough to hand to something that has to act on it.
 *
 * A file is not a hand-expanded part list unless it has to be. Most of the bestiary comes out of
 * `biped` or `quadruped`, so most files are a recipe — the generator by name and the arguments it
 * was called with — and the shapes that make that animal itself are laid on top:
 *
 *     { "from": "quadruped", "with": { "body": [0.9, 0.5, 0.48], ... },
 *       "parts": [ { "box": [0.16, 0.14, 0.2], "at": [0.72, 0.62, 0], "color": "#f0b8a8" } ] }
 *
 * `from` and `parts` are each optional and it needs one of them: a chicken is `parts` alone, a
 * villager is `from` alone, a cow is both. What `parts` holds is exactly what the generators used
 * to take as `extras` — the horns, the muzzle, the hero's hat — laid on in the same order, so the
 * two forms are one list by the time anything downstream sees them.
 *
 * Everything is checked on the way in and every complaint names the file, the field and what was
 * expected, because these files are written by hand and by Claude and both make the same mistakes:
 * a colour as a number, a misspelt `anim` that quietly stops a leg swinging, a part with two shapes
 * on it. A rig that loads wrong is a fortnight of nobody noticing.
 */

/** Where a creature's model lives. The convention, so nothing has to search for it or guess. */
export const MODEL_DIR = 'models/creatures';

/**
 * The file a creature's body is in.
 *
 * A real function rather than a sentence written out wherever it is needed, because three things
 * want the answer and only one of them is a person: the character builder tells Claude which file
 * to open, the tests hold the directory and `KINDS` to each other, and a shell one-liner should be
 * able to ask. It answers for any name, including one nothing has drawn yet, because "where would
 * this go" is the same question as "where is this" and is asked at exactly the moment the file
 * does not exist.
 */
export function modelFile(id: string): string {
  return `${MODEL_DIR}/${id}.json`;
}

/** Which generators a model may be built `from`. Adding one is a function and a line here. */
const GENERATORS = ['biped', 'quadruped'] as const;

/** Everything a model file may say. Anything else is a typo, and a typo is worth stopping for. */
const MODEL_KEYS = ['from', 'with', 'parts'];

/** The four shapes, named by the key that carries the size. */
const SHAPES = ['box', 'ico', 'cone', 'cyl'] as const;

/** Everything a part may say: its shape, where it sits, and how it is painted and moved. */
const PART_KEYS = [...SHAPES, 'at', 'color', 'tint', 'anim', 'pivot', 'rot', 'tag'];

/** A place, a size or a pivot: three numbers, always in that order. */
function triple(f: Fields, key: string): [number, number, number] {
  const list = f.numbers(key);
  if (list.length !== 3) {
    throw new PropertiesError(`${f.where}.${key}`, `expected three numbers — x, y, z — found ${list.length}`);
  }
  return [list[0], list[1], list[2]];
}

/** Two numbers describing a shape, in the order the shape is spoken about. */
function measures(f: Fields, key: string, what: string): [number, number] {
  const list = f.numbers(key);
  if (list.length !== 2) throw new PropertiesError(`${f.where}.${key}`, `expected ${what}, found ${list.length} numbers`);
  return [list[0], list[1]];
}

/**
 * One angle, in radians — or as a fraction of a full turn, which is how the ones that matter read.
 *
 * Almost every rotation in the bestiary is a lean or a droop and is a small number of radians:
 * `0.45` for the ogre's log, `-0.6` for a horse's neck. The handful that are not are all right
 * angles — a beak swung to point forwards, a wight's hem turned upside down — and written in
 * radians those are `-1.5707963267948966`, which is a number no reader can check and no editor
 * would dare change. `"-1/4"` is the same angle said out loud, and the arithmetic is exact: a turn
 * halved or quartered is a division by a power of two, so the double that comes out is the double
 * `-Math.PI / 2` used to put there.
 */
function angle(value: unknown, where: string): number {
  if (typeof value === 'string') {
    const split = /^(-?\d+)\/(\d+)$/.exec(value);
    if (!split) throw new PropertiesError(where, `expected radians, or a fraction of a turn like "-1/4", found "${value}"`);
    return Math.PI * 2 * (Number(split[1]) / Number(split[2]));
  }
  return asNumber(value, where);
}

/** The three angles a part is turned by, about x, y and z. */
function rotation(f: Fields, key: string): [number, number, number] {
  const list = f.list(key, angle);
  if (list.length !== 3) {
    throw new PropertiesError(`${f.where}.${key}`, `expected three angles — about x, y and z — found ${list.length}`);
  }
  return [list[0], list[1], list[2]];
}

/** Nothing but the keys a thing is allowed, so a misspelt one is caught rather than ignored. */
function onlyKnown(f: Fields, allowed: string[], what: string): void {
  for (const key of f.keys()) {
    if (!allowed.includes(key)) {
      throw new PropertiesError(`${f.where}.${key}`, `is not something ${what} has; try one of: ${[...allowed].sort().join(', ')}`);
    }
  }
}

/** One shape, painted and placed. */
function readPart(value: unknown, where: string): PartDef {
  const f = new Fields(where, value);
  onlyKnown(f, PART_KEYS, 'a part');
  const named = SHAPES.filter((shape) => f.has(shape));
  if (named.length !== 1) {
    throw new PropertiesError(where, named.length === 0
      ? `has no shape: one of ${SHAPES.join(', ')} says what it is and carries its size`
      : `is ${named.join(' and ')} at once, and a part is one shape`);
  }
  const extra: Partial<PartDef> = {};
  if (f.has('tint')) extra.tint = f.num('tint');
  if (f.has('anim')) extra.anim = f.choice('anim', ANIM_ROLES);
  if (f.has('pivot')) extra.pivot = triple(f, 'pivot');
  if (f.has('rot')) extra.rot = rotation(f, 'rot');
  if (f.has('tag')) extra.tag = f.text('tag');
  const at = triple(f, 'at');
  const paint = f.colour('color');
  switch (named[0]) {
    case 'box': return box(triple(f, 'box'), at, paint, extra);
    case 'ico': return ico(f.num('ico'), at, paint, extra);
    case 'cone': {
      const [base, height] = measures(f, 'cone', 'the radius of the base and the height');
      return cone(base, height, at, paint, extra);
    }
    case 'cyl': {
      const [radius, height] = measures(f, 'cyl', 'a radius and a height');
      return cyl(radius, height, at, paint, extra);
    }
  }
}

const QUAD_KEYS = ['body', 'bodyY', 'legH', 'legW', 'legInset', 'head', 'headOffset', 'neck', 'neckOffset',
  'neckRot', 'bodyColor', 'bodyTint', 'legColor', 'legTint', 'headColor', 'headTint', 'tail'];

/** The arguments a four-legged animal is built from. */
function readQuad(f: Fields): QuadOpts {
  onlyKnown(f, QUAD_KEYS, 'a quadruped');
  const tail = f.maybeGroup('tail');
  return {
    body: triple(f, 'body'),
    bodyY: f.num('bodyY'),
    legH: f.num('legH'), legW: f.num('legW'), legInset: f.maybeNum('legInset'),
    head: triple(f, 'head'), headOffset: triple(f, 'headOffset'),
    neck: f.has('neck') ? triple(f, 'neck') : undefined,
    neckOffset: f.has('neckOffset') ? triple(f, 'neckOffset') : undefined,
    neckRot: f.maybeNum('neckRot'),
    bodyColor: f.colour('bodyColor'), bodyTint: f.maybeNum('bodyTint'),
    legColor: f.maybeColour('legColor'), legTint: f.maybeNum('legTint'),
    headColor: f.maybeColour('headColor'), headTint: f.maybeNum('headTint'),
    tail: tail && {
      size: tail.numbers('size'),
      offset: triple(tail, 'offset'),
      color: tail.colour('color'),
      tint: tail.maybeNum('tint'),
      rot: tail.has('rot') ? rotation(tail, 'rot') : undefined,
    },
  };
}

const BIPED_KEYS = ['skin', 'hair', 'hairTint', 'shirtTint', 'pantsColor', 'pantsTint', 'bootTint', 'armTint', 'build'];

/** The arguments a person is built from. */
function readBiped(f: Fields): BipedOpts {
  onlyKnown(f, BIPED_KEYS, 'a biped');
  return {
    skin: f.colour('skin'), hair: f.colour('hair'), hairTint: f.maybeNum('hairTint'),
    shirtTint: f.num('shirtTint'), pantsColor: f.colour('pantsColor'),
    pantsTint: f.maybeNum('pantsTint'), bootTint: f.maybeNum('bootTint'), armTint: f.maybeNum('armTint'),
    build: f.maybeNum('build'),
  };
}

/**
 * One file: a recipe, a list of shapes, or a recipe with shapes laid on top of it.
 *
 * Public because reading one model is a thing worth being able to do on its own — a test proves
 * what a wrong file says by handing it one, and anything that wants to read a model off disk
 * rather than out of the bundle has the same call the game makes.
 */
export function readModel(where: string, contents: unknown): PartDef[] {
  const f = new Fields(where, contents);
  onlyKnown(f, MODEL_KEYS, 'a model');
  const parts: PartDef[] = [];
  if (f.has('from')) {
    const from = f.choice('from', GENERATORS);
    const args = f.group('with');
    parts.push(...(from === 'biped' ? biped(readBiped(args)) : quadruped(readQuad(args))));
  } else if (f.has('with')) {
    throw new PropertiesError(`${f.where}.with`, 'is the arguments to a generator, but nothing here says what to build "from"');
  }
  if (f.has('parts')) parts.push(...f.list('parts', readPart));
  if (parts.length === 0) {
    throw new PropertiesError(f.where, 'draws nothing: a model is "from" a generator, or a list of "parts", or both, and this is neither');
  }
  return parts;
}

/**
 * The files, in the order the kind table has always listed them.
 *
 * Written out rather than found on disk, because the game is bundled for a browser and a browser
 * has no directory to walk — the same reason `properties/` lists its files. The order is the only
 * thing here that is not arbitrary: it is what `KINDS` is built in, and what every report that
 * walks the bestiary comes out in.
 */
const FILES: Record<string, unknown> = {
  ogre, wight, nettle, dragon,
  cow, sheep, horse, chicken, deer, rabbit, fox, bear, camel, lizard, vulture, frog, duck,
  shark, orca, heron, goat, eagle, hare, wolf, elk,
  traveller, villager, rat, bat, slime, skeleton, troll, yeti, bigfoot, shopkeeper, hero,
  // the trades, which are the same person in different hats — and the hat is the whole of the
  // difference at the distance this camera watches a street from
  miner, priest, doctor, constable, mayor, farmer, cowboy,
};

/** Every body in the game, by the name the rest of it knows the creature under. */
export const MODELS: Record<string, PartDef[]> = Object.fromEntries(
  Object.entries(FILES).map(([id, contents]) => [id, readModel(modelFile(id), contents)]),
);

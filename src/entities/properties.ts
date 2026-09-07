import beasts from '../../properties/beasts.json';
import birds from '../../properties/birds.json';
import sea from '../../properties/sea.json';
import people from '../../properties/people.json';
import monsters from '../../properties/monsters.json';
import villain from '../../properties/villain.json';
import tuning from '../../properties/behaviour.json';
import { Fields, PropertiesError, asText, flatten, readAll } from '../core/properties';
import { BLOW_NAMES, isBlow, type Blow } from './motion';
import type { PartDef } from './animals';

/**
 * What every creature in the world is, read out of `properties/`.
 *
 * The division is the one `behaviours/` already draws, one step further along. A behaviour file
 * says what a wolf decides; these say what a wolf is — how fast, how hard, how many, worth what —
 * and the source is left holding only the two things a file cannot carry: the rig it is drawn
 * with, which is a shape and is read by looking at it, and the code that acts on any of this.
 *
 * The type below is written once and the file is parsed against it, so nothing downstream ever
 * sees an `any`: the renderer, the behaviour verbs, the tests and the server all go on reading an
 * `AnimalKind` exactly as they did when it was a table in TypeScript. What changed is only where
 * the numbers are kept, and that a wrong one now says so.
 */

/**
 * Which tree in `behaviours/` decides for a creature. Named here rather than in the rigs because
 * this is where the word is checked: the list is the type, so a behaviour nobody has written a
 * tree for cannot be spelt into a file without the compiler or the loader saying so.
 */
const BEHAVIOURS = ['graze', 'wander', 'prowl', 'fly', 'swim', 'hop', 'travel', 'hunt', 'circle'] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

/**
 * Everything about a creature except the body it is drawn with.
 *
 * Each field is explained at length in `properties/beasts.json`, where somebody changing one will
 * be looking; what is here is the shape, so that the compiler holds the file to it.
 */
export interface CreatureProperties {
  /** The name the whole game knows it by, taken from the key it is filed under. */
  id: string;
  label: string;
  emoji: string;
  scale: number;
  /** Tiles per second, walking. */
  speed: number;
  runSpeed: number;
  /** Fewest and most that turn up together. */
  herd: [number, number];
  behaviour: Behaviour;
  /** Each entry is one palette: up to 3 tints the parts can reference. */
  palettes: number[][];
  names: string[];
  lines: string[];
  /** Fliers. */
  altitude?: number;
  /** Prey flee from the player; predators do not. */
  timid: boolean;
  /** Max height difference this kind can step across (default STEP_LIMIT). The hero climbs a full terrace. */
  climb?: number;
  /** Damage per bite for predators that attack the hero. */
  dangerous?: number;
  /**
   * The shape this creature throws when it attacks. Left out for most of them: anything with an
   * arm punches and anything without bites, which covers the whole bestiary without a table. Set
   * it only where a creature fights in a way worth watching, like a bear going up on its hind
   * legs, and it applies everywhere that creature ever swings at anything.
   */
  blow?: Blow;
  /**
   * Somebody's property. It can be killed like anything else, and the village will find out.
   * Kept on the kind rather than worked out from where it is standing, because a cow that has
   * wandered off is still a cow that belongs to whoever it wandered off from.
   */
  owned?: boolean;
  /** Hit points; creatures with hp can be killed by the hero. */
  hp?: number;
  /** Gold dropped when killed. */
  gold?: [number, number];
  /** Something to carry home, and how often it drops. */
  drop?: { id: string; chance: number };
}

/**
 * A colour as a person writes one down.
 *
 * The parts of a rig hold colours as plain numbers, which is what three.js wants and what a hex
 * literal in TypeScript already looked like. JSON has no hex literals, so a palette written as
 * numbers would be six digits of decimal that nobody could read as a colour and nobody could
 * change with any confidence. `"#a06030"` is the same value written the way every other tool a
 * person might have it open in writes it.
 */
function colour(value: unknown, where: string): number {
  const text = asText(value, where);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw new PropertiesError(where, `expected a colour like "#a06030", found "${text}"`);
  return Number.parseInt(text.slice(1), 16);
}

/** One palette: the two or three colours a single animal is painted from. */
function palette(value: unknown, where: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PropertiesError(where, 'expected a list of at least one colour');
  }
  return value.map((entry, i) => colour(entry, `${where}[${i}]`));
}

/** One creature, field by field, so that a wrong one is named rather than quietly becoming NaN. */
function readCreature(f: Fields, id: string): CreatureProperties {
  // the blow is checked against motion.ts's own list rather than one written out again here, so a
  // shape added to animations/motion.json is usable from a properties file the moment it exists
  const blow = f.has('blow') ? f.text('blow') : undefined;
  if (blow !== undefined && !isBlow(blow)) {
    throw new PropertiesError(`${f.where}.blow`, `"${blow}" is not one of: ${[...BLOW_NAMES].sort().join(', ')}`);
  }
  return {
    id,
    label: f.text('label'),
    emoji: f.text('emoji'),
    scale: f.num('scale'),
    speed: f.num('speed'),
    runSpeed: f.num('runSpeed'),
    herd: f.pair('herd'),
    behaviour: f.choice('behaviour', BEHAVIOURS),
    palettes: f.list('palettes', palette),
    names: f.words('names'),
    lines: f.words('lines'),
    altitude: f.maybeNum('altitude'),
    timid: f.flag('timid'),
    climb: f.maybeNum('climb'),
    dangerous: f.maybeNum('dangerous'),
    blow,
    owned: f.maybeFlag('owned'),
    hp: f.maybeNum('hp'),
    gold: f.maybePair('gold'),
    drop: dropOf(f),
  };
}

/** What is left on the body, if anything is. */
function dropOf(f: Fields): { id: string; chance: number } | undefined {
  const drop = f.maybeGroup('drop');
  if (!drop) return undefined;
  return { id: drop.text('id'), chance: drop.num('chance') };
}

/**
 * Every creature the game ships, by name.
 *
 * The files are listed here and nowhere else, so splitting the table further — the birds went out
 * of the beasts once already — is one import beside these and nothing more. They are separate
 * because they are read separately: somebody balancing a dungeon has no reason to scroll past
 * fourteen farm animals to reach the troll.
 */
export const PROPERTIES: Record<string, CreatureProperties> = readAll({
  'properties/beasts.json': beasts,
  'properties/birds.json': birds,
  'properties/sea.json': sea,
  'properties/people.json': people,
  'properties/monsters.json': monsters,
  'properties/villain.json': villain,
}, readCreature);

/**
 * A creature, from what it is and the body that draws it.
 *
 * The two halves are joined here rather than in the files that hold the rigs, so that a rig file
 * never has to know which properties file its creature was written into — and so that asking for
 * a body with no properties beside it fails at load, naming the creature, rather than spawning
 * something with no speed and no hit points.
 */
export function creature(id: string, parts: PartDef[]): CreatureProperties & { parts: PartDef[] } {
  const properties = PROPERTIES[id];
  if (!properties) {
    throw new PropertiesError(`properties/${id}`, `there is a rig for "${id}" but nothing in properties/ that says what it is`);
  }
  return { ...properties, parts };
}

/**
 * What every creature does in the absence of an argument.
 *
 * These were always defaults — a behaviour tree that writes `with: { cooldown: 3.4 }` beats the
 * number here, which is exactly what the wolves do — so having them in the source while the trees
 * that override them were in files put the two halves of one decision in two languages. What each
 * one decides is written beside it in `properties/behaviour.json`.
 */
export interface BehaviourDefaults {
  FLEE_TIME: [number, number];
  STALK_RADIUS: number;
  ARRIVE_DISTANCE: number;
  BITE_RANGE: number;
  BITE_COOLDOWN: number;
  WIND_UP: number;
  BITE_SLIP: number;
  HURT_TIME: number;
  KNOCKBACK: number;
  PERSONAL: number;
  ELBOW: number;
  SHOVE: number;
  HERD_DRIFT: number;
  PROWL_DRIFT: number;
  HERD_DRIFT_TIME: [number, number];
  TURN_RATE: number;
  CIRCLE_RADIUS: number;
  CHARGE_TIME: number;
}

const defaults = flatten('properties/behaviour.json', tuning);

/** Behaviour tuning shared by every creature. Distances in tiles, times in seconds. */
export const BEHAVIOUR: BehaviourDefaults = {
  FLEE_TIME: defaults.pair('FLEE_TIME'),
  STALK_RADIUS: defaults.num('STALK_RADIUS'),
  ARRIVE_DISTANCE: defaults.num('ARRIVE_DISTANCE'),
  BITE_RANGE: defaults.num('BITE_RANGE'),
  BITE_COOLDOWN: defaults.num('BITE_COOLDOWN'),
  WIND_UP: defaults.num('WIND_UP'),
  BITE_SLIP: defaults.num('BITE_SLIP'),
  HURT_TIME: defaults.num('HURT_TIME'),
  KNOCKBACK: defaults.num('KNOCKBACK'),
  PERSONAL: defaults.num('PERSONAL'),
  ELBOW: defaults.num('ELBOW'),
  SHOVE: defaults.num('SHOVE'),
  HERD_DRIFT: defaults.num('HERD_DRIFT'),
  PROWL_DRIFT: defaults.num('PROWL_DRIFT'),
  HERD_DRIFT_TIME: defaults.pair('HERD_DRIFT_TIME'),
  TURN_RATE: defaults.num('TURN_RATE'),
  CIRCLE_RADIUS: defaults.num('CIRCLE_RADIUS'),
  CHARGE_TIME: defaults.num('CHARGE_TIME'),
};

/**
 * The height a walker can step up when its kind has no `climb` of its own.
 *
 * Kept out of `BEHAVIOUR` because it is not a decision anything makes: it is a fact about the
 * ground, asked by the world as often as by a creature, and half the game already imports it
 * under this name.
 */
export const STEP_LIMIT: number = defaults.num('STEP_LIMIT');

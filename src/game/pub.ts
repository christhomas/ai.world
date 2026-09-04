import { hashString, mulberry32, pick, type Rng } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Biome } from '../world/biomes';
import { compassDir, type Structures, type Village } from '../world/structures';
import { ITEMS } from './items';
import type { Quest } from './quests';

/**
 * The village pub, and the only thing it is really for: what you find out by standing in it.
 *
 * Every word of it is grown from the world seed and the village, the way the terrain is, so two
 * people drinking in the same room hear the same talk without a byte crossing between them, and
 * neither can be told something the other's world does not contain.
 *
 * The one decision worth explaining: an errand picked up here is an ordinary Quest, the same
 * shape the elder hands out, rather than a second kind of promise. That keeps a pub errand to
 * things the game can already check on its own, a place you have named or a thing in your pack,
 * and lets the journal, the compass and the save file carry it without knowing where it came
 * from. The person who asks for it is a regular of this room and not somebody on the village
 * register: a name you can go and meet is worth less than an errand that cannot dangle when its
 * asker is carried off by a wolf.
 */

/** Tuning for what a room will tell you and what it will pay. Distances in tiles. */
const PUB = {
  /** Rumours a room parts with in one visit. Two is a conversation, four is a lecture. */
  RUMOURS: 3,
  /** How far away a place can be and still be worth talking about here. */
  TALK_RANGE: 150,
  /** Nearer than this and it is not a rumour, it is out of the window. */
  TALK_MIN: 20,
  /** A visit errand pays this, plus this much again for every ten tiles of walking. */
  VISIT_PAY: 18,
  VISIT_PER_TEN: 3,
  /** A fetch errand pays this multiple of what the goods are worth, plus a few coins for the walk. */
  FETCH_PAY: 2.5,
  FETCH_TIP: 8,
  /** Only cheap things are asked for by the pair. */
  CHEAP: 20,
  /** How often the room's errand is a place to go rather than a thing to bring. */
  VISIT_SHARE: 0.5,
} as const;

/** What one pub is: its sign, its room, its talk, and the one thing somebody in it wants doing. */
export interface PubTalk {
  /** The name over the door. */
  name: string;
  /** The room as you come into it. */
  room: string;
  /** What is being said tonight, the most useful first. */
  rumours: string[];
  /** The errand going begging in here, if anybody has one. */
  errand: Quest | null;
}

/** A pub as its own part of the world knows it: what it is called and what its regulars talk about. */
interface Local {
  names: string[];
  room: string;
  talk: string[];
  /** What the room tells anybody setting out from this door. */
  warning: string;
  /** What the kitchen and the regulars here send strangers out for. */
  wants: string[];
}

/**
 * A pub belongs to its weather. The same errand asked in the snow and in the desert is a
 * different errand, so the name over the door, the room and the talk all come from the biome.
 */
const LOCAL: Record<Biome, Local> = {
  [Biome.Plains]: {
    names: ['The Barley Mow', 'The Ploughman', 'The Green Man'],
    room: 'Low beams, a good fire, and a dog across the doorway that nobody moves.',
    talk: [
      'The barley came in light this year, and the miller has opinions about why.',
      'A hare had the whole turnip row in one night and left the gate shut behind it.',
      'Somebody walks the field paths after dark. Nobody in here will say who.',
    ],
    warning: 'Keep to the field paths and you will not be walking in mud all the way back.',
    wants: ['perch', 'wheat', 'turnip'],
  },
  [Biome.Forest]: {
    names: ['The Axe and Bough', 'The Fox and Lantern', 'The Charcoal Burner'],
    room: 'Sawdust on the boards, wet coats steaming, and the fire doing most of the talking.',
    talk: [
      'The woodcutters have stopped going past the third ridge and will not be drawn on it.',
      'Wolves came down to the fence line twice this week. Twice.',
      'There is a tree out there older than this village, and older than the name of it.',
    ],
    warning: 'Stay on the track. The trees close up behind you the moment you leave it.',
    wants: ['pelt', 'herbs', 'pike'],
  },
  [Biome.Desert]: {
    names: ['The Dry Well', 'The Last Drop', 'The Shaded Door'],
    room: 'Shutters closed against the glare, and a water jug sweating on every table.',
    talk: [
      'The well went dry a year ago, and somebody still lowers a bucket into it every morning.',
      'A caravan came through at noon and would not stop for water. That tells you something.',
      'The sand moves at night. It has uncovered a door before now, and it will again.',
    ],
    warning: 'Go at first light. Nobody walks that ground at noon twice.',
    wants: ['eel', 'bone', 'gem'],
  },
  [Biome.Swamp]: {
    names: ['The Drowned Rat', 'The Reed and Rushlight', 'The Sunken Boot'],
    room: 'The floor gives a little underfoot, and everything in here smells of the water.',
    talk: [
      'Lights out over the water at night, keeping pace with you. Do not follow them and do not wave.',
      'The eels have come up shallow, which the old ones call a bad sign and a good supper.',
      'Half this village is built on the last one. Mind where you dig.',
    ],
    warning: 'Test the ground in front of you the whole way, and do not walk it after dark.',
    wants: ['eel', 'herbs', 'bone'],
  },
  [Biome.Mountain]: {
    names: ['The Broken Pick', 'The Goat and Grindstone', 'The Long Way Down'],
    room: 'Stone walls, a fire built for winter, and the wind trying the door all evening.',
    talk: [
      'A pick came back down the mountain last month. The man carrying it did not.',
      'The high pass is open a fortnight a year and shut for the rest of it.',
      'Something knocks below the old workings, and if you knock back it answers.',
    ],
    warning: 'Mind the loose scree above the path, and take the coming back slowly.',
    wants: ['gem', 'fang', 'pelt'],
  },
  [Biome.Snow]: {
    names: ['The Thawing Hearth', 'The Wolf and Lantern', 'The Long Winter'],
    room: 'Snow melting off boots by the door, and the fire banked high enough to read by.',
    talk: [
      'The lake ice is a hand thick, which is thick enough for a fool and not for a cart.',
      'Wolves ran the fence in the small hours and the dogs would not go out to them.',
      'A traveller went into the storm and never reached the next village. Nobody has been to look.',
    ],
    warning: 'Go before the light fails. The cold sees to whoever is still out in it.',
    wants: ['pelt', 'fang', 'pike'],
  },
};

/** Whoever is doing the asking. Regulars of the room, so an errand outlives the people outside. */
const REGULARS = ['Old Bram', 'Tilda', 'Sanders the carter', 'Meg from the end table', 'Halloran', 'Ned the drover'];

/**
 * What is being said in a village's pub, or null where the village is too small to keep one.
 * Takes the whole world because half of what a room talks about is what is outside it.
 */
export function pubTalk(village: Village, structures: Structures, seed: number): PubTalk | null {
  if (!village.pub) return null;
  // mixing the village name in gives every room its own stream, so no two pubs say the same thing
  const rng = mulberry32(derive(seed ^ hashString(village.name), SALT.QUESTS));
  const local = LOCAL[village.biome];
  const places = placesNear(village, structures);
  return {
    name: pick(rng, local.names),
    room: local.room,
    rumours: rumoursIn(village, structures, local, places, rng),
    errand: errandIn(village, local, places, rng),
  };
}

/**
 * Whether an errand from a pub is finished. A visit is done when the place has been named, a
 * fetch when the goods are in the pack: both things the game already knows without being told.
 */
export function errandDone(errand: Quest, discovered: ReadonlySet<string>, carried: (id: string) => number): boolean {
  return errand.kind === 'visit' ? discovered.has(errand.target) : carried(errand.target) >= errand.count;
}

/** Named places worth mentioning here, nearest first. */
function placesNear(village: Village, structures: Structures): Array<{ name: string; x: number; z: number; d: number }> {
  return [...structures.pois, ...structures.caves, ...structures.wrecks]
    .map((p) => ({ name: p.name, x: p.x, z: p.z, d: Math.hypot(p.x - village.x, p.z - village.z) }))
    .filter((p) => p.d > PUB.TALK_MIN && p.d < PUB.TALK_RANGE)
    .sort((a, b) => a.d - b.d);
}

/**
 * The room's talk: somewhere out there that nobody has been, the neighbours down the road, and
 * whatever this part of the world is worried about this year. The last of those is always said,
 * because a village with nothing around it still has weather.
 */
function rumoursIn(
  village: Village, structures: Structures, local: Local,
  places: ReturnType<typeof placesNear>, rng: Rng,
): string[] {
  const said: string[] = [];
  // the far end of what this room knows about: a place you can see from the square is not a rumour
  const far = places[places.length - 1];
  if (far) {
    said.push(`They swear there is something out at ${far.name}, ${compassDir(far.x - village.x, far.z - village.z)} of here. Nobody in this room has been.`);
  }
  const neighbour = structures.villages
    .filter((v) => v.name !== village.name)
    .sort((a, b) => Math.hypot(a.x - village.x, a.z - village.z) - Math.hypot(b.x - village.x, b.z - village.z))[0];
  if (neighbour) {
    const tiles = Math.round(Math.hypot(neighbour.x - village.x, neighbour.z - village.z));
    said.push(`${neighbour.name} is ${compassDir(neighbour.x - village.x, neighbour.z - village.z)} along the road, ${tiles} tiles. Their ale is thinner than ours.`);
  }
  said.push(pick(rng, local.talk));
  return said.slice(0, PUB.RUMOURS);
}

/** The one errand going in this room: somewhere to go, or something to bring back. */
function errandIn(village: Village, local: Local, places: ReturnType<typeof placesNear>, rng: Rng): Quest | null {
  const who = pick(rng, REGULARS);
  const wantsVisit = rng() < PUB.VISIT_SHARE;
  return (wantsVisit && places.length > 0 ? visitErrand(village, local, places, who, rng) : null)
    ?? fetchErrand(village, local, who, rng)
    ?? (places.length > 0 ? visitErrand(village, local, places, who, rng) : null);
}

/** Somebody left something out at a place nobody goes, and wants to know it is still there. */
function visitErrand(village: Village, local: Local, places: ReturnType<typeof placesNear>, who: string, rng: Rng): Quest {
  // not the place the room is already gossiping about: nobody has been there, so nobody left a pack
  const place = pick(rng, places.length > 1 ? places.slice(0, -1) : places);
  const dir = compassDir(place.x - village.x, place.z - village.z);
  const paces = Math.round(place.d / 10) * 10;
  const reward = PUB.VISIT_PAY + Math.round(place.d / 10) * PUB.VISIT_PER_TEN;
  return {
    id: `pub:${village.name}`, village: village.name, kind: 'visit', target: place.name, count: 1, reward,
    intro: [
      `${who} left a pack out at ${place.name} last autumn and has not the legs to go back for it.`,
      `It is ${dir} of here, ${paces} paces or so. Go and see the place still stands and there is ${reward} gold in it.`,
      local.warning,
    ],
    reminder: `Still not been out to ${place.name}? ${dir} of here. ${local.warning}`,
    done: [
      `You found ${place.name}. ${who} will be glad it was not a story after all.`,
      `${reward} gold, and the next one is on the house.`,
    ],
  };
}

/** The kitchen, or a regular with a standing order, wants something only the country outside has. */
function fetchErrand(village: Village, local: Local, who: string, rng: Rng): Quest | null {
  const stocked = local.wants.filter((id) => ITEMS[id]);
  if (stocked.length === 0) return null;
  const item = ITEMS[pick(rng, stocked)];
  const count = item.price > PUB.CHEAP ? 1 : 2;
  // a room that asks for "a Eel" is a room nobody believes in
  const article = 'AEIOU'.includes(item.name[0]) ? 'an' : 'a';
  const some = count === 1 ? `${article} ${item.name}` : `${count} ${item.name}`;
  const reward = Math.round(item.price * count * PUB.FETCH_PAY) + PUB.FETCH_TIP;
  return {
    id: `pub:${village.name}`, village: village.name, kind: 'fetch', target: item.id, count, reward,
    intro: [
      `${who} has been after ${some} all week and will not let the room forget it.`,
      `Put ${count === 1 ? 'one' : 'them'} on this table and ${reward} gold goes back the other way.`,
    ],
    reminder: `${who} is still waiting on ${some}. Try the water, or the wild country.`,
    done: [
      `${some.charAt(0).toUpperCase()}${some.slice(1)}, and no arguing about it. ${who} is a happy soul tonight.`,
      `${reward} gold, and the room drinks your health.`,
    ],
  };
}

/**
 * The wire between players. The world itself is grown from the seed on every client, so terrain,
 * villages and dungeons are never sent. What does travel is people, words, goods, the time of day,
 * and the short list of things players have changed about the world.
 */

export const PROTOCOL_VERSION = 13;

/**
 * Real seconds in one day of the world. An hour of it is therefore five minutes, which is the
 * unit everything timed is measured against: how long a pod of whales puts on a display, when a
 * shop shuts, how long a crop takes to come on. It was eight minutes a day early on and
 * everything happened at once — a night lasted under three minutes, a season under an hour.
 *
 * Both halves of the game read it from here. They were separate constants once, which is exactly
 * the sort of thing that agrees until the day somebody changes one.
 */
export const DAY_LENGTH = 7200;

/** Where somebody is and what they look like, sent several times a second. */
export interface Presence {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Walk animation strength, so remote heroes move their legs. */
  walk: number;
  /** Item ids worn in hand, off hand, head and body, for drawing them. */
  gear: string[];
  /** Which world they are standing in: the surface, a dungeon floor, or a building. */
  place: string;
  /** Whether they are mounted or under sail, so they are drawn on the right thing. */
  riding: 'foot' | 'horse' | 'boat';
}

export interface TradeOffer {
  from: string;
  to: string;
  gold: number;
  /** Item ids and counts. */
  items: Array<[string, number]>;
}

/**
 * The time of day everyone in a world shares. `day` counts from one; `time` is the fraction of a
 * day, so 0.5 is noon. Seasons fall out of the day counter on each client.
 */
export interface Clock {
  day: number;
  time: number;
}

/**
 * Something a player changed about the world. The world is otherwise identical on every client,
 * so this short list is all that has to be kept and replayed.
 *
 * - `chest`   a dungeon or wreck chest that has been opened, keyed by its id
 * - `key`     a vault whose locked doors have been opened
 * - `sow`     a crop planted on a tile, carrying the crop and the day it went in
 * - `reap`    that tile lifted again
 * - `found`   a place somebody named, so everyone's map agrees
 * - `died`    a villager killed by something, which no client could have worked out on its own
 */
export type WorldDelta =
  | { kind: 'chest'; id: string }
  | { kind: 'key'; id: string }
  | { kind: 'sow'; tile: string; crop: string; day: number }
  | { kind: 'reap'; tile: string }
  | { kind: 'found'; name: string }
  | { kind: 'died'; who: string; village: string; day: number }
  /**
   * Something living in a mine has been killed, and how many.
   *
   * Counted rather than named because the dungeon behind an anchor is regrown from its seed every
   * time anybody walks into it, so there is no such thing as a particular troll that stays dead.
   * What survives is how much of the place has been fought through, and that is what the danger
   * down there is made of — so it is a fact about the world and has to travel like one.
   *
   * `many` is the running total for that mine rather than the handful just killed, because the log
   * keeps one entry per key and a later entry replaces an earlier one. An increment would be
   * swallowed by that; a total survives it, arrives in any order, and can be applied twice without
   * counting anything twice.
   */
  | { kind: 'cleared'; mine: string; many: number }
  /**
   * Somebody has walked into a village and told them what is down their mine now.
   *
   * Separate from clearing it because they are separate acts: one changes the mine, the other
   * changes what a village believes about it, and a village that believes its mine is haunted
   * stays at home whatever is true. Without this a mine one player cleared and reported goes on
   * frightening everybody else's villagers for ever.
   */
  | { kind: 'told'; mine: string }
  /**
   * Somebody has paid a village's builder to put up a house, and where.
   *
   * A building is a fact about a village rather than about the player who paid for it: the village
   * is a house bigger afterwards, whoever is looking at it. It was the one thing in the economy
   * that never left the save it was made in — a player's own village grew, and on every other
   * screen the plot stayed empty grass.
   *
   * What travels is where it stands, which way it faces and the day work began, because the stage
   * it has reached is worked out from the day rather than sent: a frame is a frame on everybody's
   * screen if they all know when it was started.
   */
  | { kind: 'built'; id: string; village: string; x: number; z: number; rot: number; day: number };

/**
 * One monster as the floor's owner sees it. Everyone underground generates the same rooms from
 * the same seed, so only the creatures moving about in them have to be described.
 */
export interface MonsterSnap {
  /** Index into the floor's own monster list, which every client builds identically. */
  i: number;
  x: number;
  z: number;
  yaw: number;
  walk: number;
  hp: number;
}

/** One lot on a market stall: a stack of the same item at one asking price. */
export interface StallItem {
  id: string;
  /** Gold for one of them. */
  price: number;
  count: number;
}

/**
 * A market pitch in a village square. A pitch belongs to a name rather than a connection, so the
 * goods are still there when the trader has gone to bed, and takings wait to be collected.
 */
export interface Stall {
  /** `<village>#<pitch>`, which every client can work out from the world it grew. */
  id: string;
  village: string;
  owner: string;
  items: StallItem[];
  /** Gold from sales, waiting for the owner to come back for it. */
  takings: number;
  /** The world day the rent runs out, after which the pitch is cleared. */
  until: number;
}

/** Renting a pitch costs this, and holds it for this many days. */
export const STALL_RENT = 20;
export const STALL_DAYS = 3;
/** A trader may not stack more than this many lots on one pitch. */
export const STALL_LOTS = 6;

/**
 * A parcel left at an inn for somebody who is not here. Like a stall, it is addressed to a name
 * rather than a connection, so it waits however long it has to.
 */
export interface Letter {
  from: string;
  to: string;
  gold: number;
  items: Array<[string, number]>;
  /** The world day it was posted, so the inn can say how long it has sat there. */
  day: number;
}

/** No more parcels than this wait in one world, oldest thrown out first. */
export const MAIL_LIMIT = 500;

/** One traveller in a party, as everyone else in it sees them. */
export interface PartyMember {
  id: string;
  name: string;
}

/** A party is small on purpose: enough to travel together, not enough to fill a dungeon. */
export const PARTY_LIMIT = 6;

/**
 * The few gestures a traveller can make without words, so people who share no language can still
 * greet each other. Typed in chat as /wave and the like.
 */
export const EMOTES: Record<string, string> = {
  wave: '👋',
  bow: '🙇',
  cheer: '🎉',
  laugh: '😄',
  thanks: '🙏',
  help: '🆘',
};

/** How long a rally point stands on everyone's map, in seconds. */
export const PING_LIFE = 90;

/** A duel is a friendly bout: nobody loses gear, gold or a life over it. */
export const DUEL_RANGE = 2.4;

/**
 * A fight with sides is a duel with the men you have already paid for standing in front of you.
 * Nothing is at stake but the bragging, and nobody is in one who has not agreed to be.
 */
export const WARBAND_RANGE = DUEL_RANGE;

/**
 * One creature as the world's owner sees it.
 *
 * Sent by whatever is running the world — a server, or the simulation in the next thread — to
 * everybody near enough to see it. Unlike a monster on a dungeon floor, a creature out in the
 * country cannot be named by an index into a list both sides generated: what lives where is decided
 * by the simulation rather than by the seed alone. So it carries its own id and says what it is.
 *
 * Deliberately small. Two hundred creatures stand near a player, and every field here is paid for
 * several times a second by everybody who can see them.
 */
export interface CreatureSnap {
  /** The world's own numbering, stable while the creature lives. */
  id: number;
  /** Which animal: the id of a kind, which every client already has the drawing for. */
  kind: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Walk animation strength, so legs move. */
  walk: number;
  /** What it is doing, which decides how it is drawn. */
  state: EntityState;
  /** Hearts left, for anything that can be fought. */
  hp: number;
}

/** What a creature is doing. The client draws each of these differently. */
export type EntityState = 'idle' | 'walk' | 'graze' | 'flee' | 'hop' | 'fly' | 'swim';

export type ClientMessage =
  | { type: 'join'; seed: number; name: string; version: number; day: number; time: number }
  | { type: 'move'; x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[] }
  /**
   * What the hero was trying to do, rather than where they ended up.
   *
   * The difference is the whole of phase four. A `move` is a client telling the world where its
   * player is standing, which the world has to take on trust; a `steer` is a client saying which
   * way it pushed and for how long, and the world walks the hero itself against the ground it
   * grew. Both are sent for now — the steer while a hero is on foot out of doors, the move for
   * everything the server does not yet own — and a client sending neither still plays, which is
   * what keeps this from being a flag day.
   *
   * `seq` counts steers from one client so an answer can name which one it has caught up to.
   */
  | { type: 'steer'; seq: number; dx: number; dz: number; pace: number; ms: number }
  | { type: 'say'; text: string }
  | { type: 'trade-offer'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'trade-accept'; from: string }
  | { type: 'trade-decline'; from: string }
  | { type: 'delta'; delta: WorldDelta }
  | { type: 'monsters'; place: string; snap: MonsterSnap[]; gone: number[] }
  | { type: 'hit'; place: string; index: number; damage: number }
  /**
   * A blow landed on a creature the world owns.
   *
   * The client draws the swing and the flinch straight away, because a hit that waits for a round
   * trip does not feel like a hit; what actually happens to the animal is decided by the world, and
   * arrives back as it always does — a creature with fewer hearts, or one that has gone.
   */
  /**
   * A blow thrown at whatever is in front of the hero: how hard, how far, how wide.
   *
   * It says nothing about what it hit. The world knows where it has been walking this hero and what
   * is standing near him, so working out which creatures were in the arc is its job — the client
   * used to do it and send a list of numbers to hurt, which is a client choosing its own targets.
   * `one` is a shot rather than a swing: one creature, the first an arrow would reach, and height
   * counts towards the distance.
   */
  | { type: 'swing'; place: string; damage: number; reach: number; arc: number; one: boolean }
  /**
   * The hero has been *put* somewhere rather than having walked there, and why.
   *
   * The one thing a walk cannot account for. A teleport, a staircase, a door, a gangplank and a
   * saddle all move somebody further in one moment than any stride would, and the world has no way
   * to work out that it happened: it does not run the console, it has never grown a cellar, and it
   * does not know where a boat is. So it is told, with the reason, and it moves its own hero to
   * match — which is the difference between a world that is told about a jump and one that infers a
   * jump from how far somebody moved, and cannot tell that from a client walking through a wall.
   *
   * `why` is not checked. It is here so that the log of a world says what happened, and so that the
   * day one of these becomes the server's to run — a teleport is already a command it knows — the
   * message that has to stop being trusted is named rather than hunted for.
   */
  | { type: 'stood'; x: number; z: number; why: 'teleport' | 'place' | 'ride' }
  /**
   * The hero has gone underground, and this is the floor he is standing on.
   *
   * Enough for the world to grow the same floor: the anchor it hangs from, what kind of hole it is,
   * and how deep. The seed is *not* sent — the world derives it the way the client does, from its
   * own root seed and the anchor's name, so two people who name the same floor get the same rooms
   * and nobody can hand the world a floor of their own devising.
   *
   * Leaving is not a message. The place in `move` says where somebody is standing, and when that
   * stops being a floor they have left it.
   */
  | { type: 'floor'; place: string; anchor: string; kind: 'dungeon' | 'cave' | 'thicket'; floor: number }
  /**
   * Set the world's clock: what day it is, and how far through it.
   *
   * Refused by a world that has other people in it — the time of day is the one thing everybody in
   * a world shares, and a stranger winding it to midnight is not a thing anybody wants done to
   * them. A world running in the thread next door is nobody else's, so it takes it, which is what
   * makes the console's `time` and `day` work in single player. On a real server the way in is the
   * operator door, which is what that door is for.
   */
  | { type: 'setclock'; day: number; time: number }
  | { type: 'stall-rent'; stall: string; village: string }
  | { type: 'stall-stock'; stall: string; item: StallItem }
  | { type: 'stall-buy'; stall: string; index: number }
  | { type: 'stall-collect'; stall: string }
  | { type: 'stall-close'; stall: string }
  | { type: 'mail-send'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'mail-fetch' }
  | { type: 'party-invite'; to: string }
  | { type: 'party-answer'; from: string; yes: boolean }
  | { type: 'party-leave' }
  /** An errand one member finished, which counts for the whole party. */
  | { type: 'party-deed'; quest: string }
  | { type: 'emote'; kind: string }
  /** A rally point dropped where you stand: your party sees it, or the whole world if you have none. */
  | { type: 'ping'; x: number; z: number }
  | { type: 'duel-challenge'; to: string }
  | { type: 'duel-answer'; from: string; yes: boolean }
  /** A blow landed on the person you are dueling; they decide what it does to them. */
  | { type: 'duel-hit'; damage: number }
  /** Called off, or lost: either way the bout is over. */
  | { type: 'duel-yield' }
  /**
   * A fight with sides. The asking carries the muster, so the other player can see what he would
   * be agreeing to before he agrees to it.
   */
  | { type: 'warband-challenge'; to: string; swords: number }
  | { type: 'warband-answer'; from: string; yes: boolean; swords: number }
  /** A blow my side landed. `sword` is true when a hired man threw it rather than me. */
  | { type: 'warband-hit'; damage: number; sword: boolean }
  /** How many of my men are still standing, sent only when that number changes. */
  | { type: 'warband-muster'; swords: number }
  /** Called off, or lost: either way the fight is over. */
  | { type: 'warband-yield' };

export type ServerMessage =
  /**
   * A command from whoever is operating this world, to be run by the client that receives it.
   *
   * The door it comes through is `POST /operate`, which exists only when the server was started
   * with an operator token, so this arrives from somebody who already holds it. The client still
   * decides what it will do — the vocabulary is shared but the handlers are not, and a client that
   * does not run a given command simply says so.
   */
  | { type: 'command'; line: string; issuer: string }
  /**
   * The creatures near you, as the world's owner sees them, and the ones that have gone.
   *
   * "Gone" means gone from your sight rather than dead: walked out of your neighbourhood, or died,
   * or the world stopped holding that piece of country. What it never means is that they were never
   * there — a client that loses one simply stops drawing it.
   *
   * `place` says which world these are in: `surface`, or the name of a dungeon floor. A creature's
   * number is only unique within its own place, and a client standing on a floor is still told
   * about neither — so a snapshot for somewhere you are not is dropped rather than drawn.
   */
  | { type: 'creatures'; place: string; near: CreatureSnap[]; gone: number[] }
  /**
   * One of the world's creatures was killed, and by whom.
   *
   * The world decides that it died; what its death is worth is worked out by whoever killed it,
   * because a pelt's price and a purse belong to that player's own save and have never been the
   * server's business. Everybody else is told so that the body falls on their screen too.
   */
  | { type: 'killed'; place: string; id: number; by: string }
  /**
   * One of the world's creatures got its teeth into you, and how hard.
   *
   * Only ever sent to whoever was bitten. What it costs is not decided here: hearts, armour and
   * whether the guard was up live in the player's own save, so the world says what happened and the
   * client says what it was worth — the same division as everywhere else on this wire.
   */
  | { type: 'bitten'; place: string; id: number; damage: number }
  | { type: 'welcome'; id: string; seed: number; players: Presence[]; clock: Clock; deltas: WorldDelta[] }
  | { type: 'joined'; player: Presence }
  | { type: 'left'; id: string }
  | { type: 'presence'; players: Presence[] }
  /**
   * Where the world says you are, and which of your own steers it had run when it said so.
   *
   * The client has already walked itself there — that is what makes the game answer the keyboard —
   * so this is usually the position it already holds, and agreeing is the common case and costs
   * nothing to check. Where they differ, the client is wrong by definition: it puts the hero here
   * and walks the steers the server had not seen yet back on top.
   */
  | { type: 'youAre'; seq: number; x: number; z: number; y: number; yaw: number }
  | { type: 'clock'; clock: Clock }
  | { type: 'delta'; delta: WorldDelta; from: string }
  | { type: 'said'; id: string; name: string; text: string }
  | { type: 'trade-offered'; offer: TradeOffer; fromName: string }
  | { type: 'trade-result'; with: string; accepted: boolean; offer: TradeOffer }
  | { type: 'monsters'; place: string; snap: MonsterSnap[]; gone: number[]; from: string }
  | { type: 'hit'; place: string; index: number; damage: number; from: string }
  | { type: 'stalls'; stalls: Stall[] }
  /** Your own purchase came through: take the goods and pay for them. */
  | { type: 'stall-bought'; stall: string; item: StallItem; cost: number }
  /** Takings handed back to the trader who earned them. */
  | { type: 'stall-takings'; stall: string; gold: number }
  /** Something you asked of a stall could not be done. */
  | { type: 'stall-refused'; stall: string; reason: string }
  /** Everyone this world has ever seen, so a parcel can be addressed to somebody who is away. */
  | { type: 'folk'; names: string[] }
  /** The parcels waiting for you, now yours: take what is in them. */
  | { type: 'mail'; letters: Letter[] }
  /** Somebody has left something for you at the inn. */
  | { type: 'mail-here'; from: string }
  /** Your parcel is on the shelf, waiting for whoever it is addressed to. */
  | { type: 'mail-sent'; to: string }
  | { type: 'mail-refused'; reason: string }
  /** Who is in your party now; empty when you are travelling alone again. */
  | { type: 'party'; members: PartyMember[] }
  | { type: 'party-invited'; from: string; fromName: string }
  /** Somebody would rather travel alone. */
  | { type: 'party-declined'; name: string }
  | { type: 'party-deed'; quest: string; from: string }
  | { type: 'duel-challenged'; from: string; fromName: string }
  | { type: 'duel-begun'; withId: string; withName: string }
  | { type: 'duel-struck'; damage: number; from: string }
  /** The bout is over: `winner` is the id of whoever was left standing, or empty if called off. */
  | { type: 'duel-over'; winner: string; name: string }
  | { type: 'warband-challenged'; from: string; fromName: string; swords: number }
  | { type: 'warband-begun'; withId: string; withName: string; swords: number }
  | { type: 'warband-struck'; damage: number; sword: boolean; from: string }
  | { type: 'warband-muster'; swords: number; from: string }
  /** Over: `winner` is whoever was left standing, or empty when it was called off. */
  | { type: 'warband-over'; winner: string; name: string }
  | { type: 'emoted'; id: string; name: string; kind: string }
  | { type: 'pinged'; x: number; z: number; name: string }
  | { type: 'error'; reason: string };

/**
 * Who simulates the monsters on a shared floor: the lowest player id standing on it. Every client
 * works this out for itself from the presence it already has, so the server needs no say in it.
 */
export function ownerOfPlace(ids: string[]): string | null {
  const sorted = ids.filter(Boolean).sort();
  return sorted[0] ?? null;
}

/** Keep a number inside the range the game can deal with. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Guard a lot off the wire: an item id, a sane price, and a stack somebody could actually carry. */
export function cleanStallItem(item: StallItem): StallItem | null {
  const id = String(item?.id ?? '').slice(0, LIMITS.ITEM_ID);
  const price = Math.floor(Number(item?.price));
  const count = Math.floor(Number(item?.count));
  if (!id || !Number.isFinite(price) || !Number.isFinite(count)) return null;
  return { id, price: clamp(price, 1, LIMITS.PRICE), count: clamp(count, 1, LIMITS.STACK) };
}

/** Guard a parcel off the wire: a real recipient, sane gold, and a handful of items at most. */
export function cleanLetter(letter: Letter): Letter | null {
  const to = cleanName(String(letter?.to ?? ''));
  const gold = Math.floor(Number(letter?.gold));
  if (!Number.isFinite(gold)) return null;
  const items = (Array.isArray(letter?.items) ? letter.items : [])
    .slice(0, LIMITS.PARCEL_ITEMS)
    .map(([id, n]) => [String(id).slice(0, LIMITS.ITEM_ID), clamp(Math.floor(Number(n)) || 1, 1, LIMITS.STACK)] as [string, number])
    .filter(([id]) => id);
  if (gold <= 0 && items.length === 0) return null;
  return { from: String(letter.from ?? '').slice(0, LIMITS.NAME), to, gold: Math.max(0, gold), items, day: Math.max(1, Math.floor(Number(letter.day)) || 1) };
}

/**
 * How much of anything the server will accept. Every one of these is a defence against a client
 * sending something enormous or strange, so they live together: a reader can see the whole shape
 * of what may cross the wire without hunting through the handlers.
 */
export const LIMITS = {
  /** Hired men one side may bring to a fight. Must match HIRE.MOST in src/game/hire.ts. */
  SWORDS: 2,
  /** A line of chat. */
  CHAT: 160,
  /** A player's name. */
  NAME: 18,
  /** An item id, which is a short word like `apple`. */
  ITEM_ID: 24,
  /** The name of a world you can be standing in, like `Shrine of Echoes:1`. */
  PLACE: 60,
  /** A stall's id, a delta's id, an errand's id: anything naming a thing in the world. */
  THING_ID: 80,
  /** A village name. */
  VILLAGE: 40,
  /** The name of a gesture, like `wave`. */
  EMOTE: 12,
  /** Pieces of gear drawn on a remote hero: hand, off hand, head, body. */
  GEAR: 4,
  /** Lots in one parcel, and items in one trade offer. */
  PARCEL_ITEMS: 8,
  TRADE_ITEMS: 12,
  /** Monsters described in one snapshot of a dungeon floor. */
  MONSTERS: 64,
  /** How many of one thing can sit in a stack, on a stall or in a parcel. */
  STACK: 99,
  /** The most anybody may ask for something, and the hardest blow anybody may claim to land. */
  PRICE: 9999,
  DAMAGE: 99,
} as const;

/** Chat is short and plain; anything longer or stranger is cut here rather than downstream. */

export function cleanChat(text: string): string {
  // strip control characters, collapse the rest, and keep it short
  return [...text].filter((ch) => ch >= ' ' && ch !== '').join('').trim().slice(0, LIMITS.CHAT);
}

/** Names are how people find each other, so they are short, plain and never empty. */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, LIMITS.NAME);
  return cleaned.length > 0 ? cleaned : 'Traveller';
}

/** One line per delta, so a log can be read and a duplicate spotted. */
export function deltaKey(delta: WorldDelta): string {
  switch (delta.kind) {
    case 'chest': return `chest:${delta.id}`;
    case 'key': return `key:${delta.id}`;
    case 'sow': return `sow:${delta.tile}`;
    case 'reap': return `sow:${delta.tile}`;   // reaping clears the sowing it replaces
    case 'found': return `found:${delta.name}`;
    case 'died': return `died:${delta.who}`;
    // one entry per mine, and the newest wins: both of these carry a whole state rather than a
    // change to one, so replacing is exactly right and adding would double-count
    case 'cleared': return `cleared:${delta.mine}`;
    case 'told': return `told:${delta.mine}`;
    // one entry per building, so a house started and then described again is one house
    case 'built': return `built:${delta.id}`;
  }
}

/**
 * Guard a muster off the wire. Nobody may claim more men than anybody is allowed to hire, and
 * anything that is not a number is nobody at all.
 */
export function cleanSwords(count: unknown): number {
  const many = Math.floor(Number(count));
  if (!Number.isFinite(many)) return 0;
  return clamp(many, 0, LIMITS.SWORDS);
}

/**
 * Guard a blow off the wire: no harder than anybody may claim to hit, and no softer than a blow.
 * A blow of nothing is turned away rather than clamped up, because a hero's hide lets one through
 * for a heart all the same, and a stream of them is a way of winning without swinging.
 */
export function cleanSwing(swing: unknown): { damage: number; sword: boolean } | null {
  const sent = swing as { damage?: unknown; sword?: unknown } | null | undefined;
  const damage = Math.floor(Number(sent?.damage));
  if (!Number.isFinite(damage) || damage < 1) return null;
  return { damage: clamp(damage, 1, LIMITS.DAMAGE), sword: sent?.sword === true };
}

/** Guard against a client sending something misshapen. */
export function cleanDelta(delta: WorldDelta): WorldDelta | null {
  const id = (value: unknown) => String(value ?? '').slice(0, LIMITS.THING_ID);
  switch (delta?.kind) {
    case 'chest': return { kind: 'chest', id: id(delta.id) };
    case 'key': return { kind: 'key', id: id(delta.id) };
    case 'found': return { kind: 'found', name: id(delta.name) };
    case 'died': {
      const day = Number(delta.day);
      if (!Number.isFinite(day)) return null;
      return { kind: 'died', who: id(delta.who), village: id(delta.village), day: Math.max(1, Math.floor(day)) };
    }
    case 'sow': {
      const day = Number(delta.day);
      if (!Number.isFinite(day)) return null;
      return { kind: 'sow', tile: id(delta.tile), crop: id(delta.crop), day: Math.max(1, Math.floor(day)) };
    }
    case 'reap': return { kind: 'reap', tile: id(delta.tile) };
    case 'built': {
      const day = Number(delta.day);
      const x = Number(delta.x), z = Number(delta.z), rot = Number(delta.rot);
      if (![day, x, z, rot].every(Number.isFinite)) return null;
      return {
        kind: 'built', id: id(delta.id), village: id(delta.village),
        x, z, rot, day: Math.max(1, Math.floor(day)),
      };
    }
    default: return null;
  }
}

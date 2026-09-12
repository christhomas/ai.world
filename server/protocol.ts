/**
 * The wire between players. The world itself is grown from the seed on every client, so terrain,
 * villages and dungeons are never sent. What does travel is people, words, goods, the time of day,
 * and the short list of things players have changed about the world.
 */

import type { WorldKind } from '../src/save/store';
import type { Anchor } from '../src/world/manifest';
import type { Memory } from '../src/world/people';
import type { Opinion } from '../src/world/memory';

export const PROTOCOL_VERSION = 18;

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
  | {
      kind: 'built'; id: string; village: string; x: number; z: number; rot: number; day: number;
      /**
       * What was ordered, and what it was added to.
       *
       * Both absent on every delta written before a builder could put up anything but a house,
       * which is what a reader of an older log gets and is right: a house is what it was. Without
       * them somebody else's bathing pool is drawn on their screen as a cottage, because the stage
       * table is keyed by what the thing is.
       */
      what?: string; to?: string;
    };

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

/**
 * How close two people have to be to trade blows in a bout. A duel is a friendly one and a fight
 * with sides is the same thing with the men you have already paid for standing behind you; neither
 * costs anybody gear, gold or a life, and both are fought at arm's length.
 */
export const DUEL_RANGE = 2.4;

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
  /**
   * Who this creature is, when it is somebody rather than something.
   *
   * Sent once, when a client is first told about them, and again only when it changes — which for
   * a villager is a death, a birth, a trade taken up, or something he will not forget. Everything
   * above this line is different every third of a second and everything in here is the same for
   * days, so paying for the second at the rate of the first would be most of a villager's cost on
   * the wire spent saying his name again.
   */
  who?: VillagerSnap;
}

/**
 * A villager, as the world that owns him describes him.
 *
 * The bodies used to be worked out on every client, from the seed and the register of who has
 * died, and that was honest for as long as a villager had nothing of his own — two clients running
 * the same arithmetic over the same numbers arrive at the same man. It stopped being honest when he
 * got a memory: what he thinks of *you* depends on what you did, and what you did happened on your
 * screen. So the world holds one of him, and this is what it says about him.
 *
 * `village` is the herd's tag, which is how a conversation knows which place it is standing in.
 * `mind` is the whole of what he recalls — the last couple of things themselves, and what they have
 * added up to. It is small by construction (`LIFE.REMEMBERS` and `MIND.OPINIONS`), which is the
 * reason `memory.ts` bounds it at all: an unbounded memory is a thing that cannot be sent.
 */
export interface VillagerSnap {
  /** Which villager on the register this is, so a client can look up his family and his purse. */
  person: string;
  name: string;
  trade: string;
  role: EntityRole;
  village: string;
  /**
   * What he is presently doing, in two or three words: "with the cattle", "selling a kill".
   *
   * Written by the branch of his behaviour tree that claimed the last tick, which only the world
   * runs — so this is the one field here that a client could not possibly work out for itself. It
   * had to be sent or it did not exist off the server: a page could show it for the men it owns
   * outright, which is the hired company, and for nobody else in the country.
   *
   * Cheap enough to send whole every time. It is one short string out of a fixed list written in
   * `behaviours/`, it changes when a man changes what he is doing rather than when he moves, and a
   * difference against a copy the far end may not have is a second thing to keep in step for no
   * saving at all — the same argument `mind` is sent whole for, two fields down.
   */
  doing: string;
  /**
   * The trades this village was founded on, as the world read them off the land around it.
   *
   * Sent rather than worked out, and it is the one thing here that had to be. A village offers the
   * trades the country round it will support — a shore only where there is water, heights only where
   * the ground climbs, a gate only where a road comes in — and that answer depends on how much of
   * the country the reader has actually grown. The world holds seven chunks round each player and a
   * page holds a hundred and twenty-one, so the two would read the same village differently, found
   * it with different trades, and end up with different names on the same people.
   *
   * The founding rolls off this list, so a client that founds a village from anything but the list
   * the world used is holding a different village. It says so.
   */
  trades: string[];
  mind: Mind;
}

/** What a villager holds: the last couple of things, and what everything has come to. */
export interface Mind {
  memories: Memory[];
  opinions: Opinion[];
}

/** What a creature is doing. The client draws each of these differently. */
export type EntityState = 'idle' | 'walk' | 'graze' | 'flee' | 'hop' | 'fly' | 'swim';

/**
 * What a creature is *for*, which is the difference between a man and a body.
 *
 * Here rather than in `entities/entity.ts` for the same reason `EntityState` is: it crosses the
 * wire now, and two lists that have to agree are one list with extra steps.
 *
 * `keeper` is somebody behind a counter that is not a shop's — a clerk, a sergeant, a priest at an
 * altar; `src/game/places.ts` says which and why.
 */
export type EntityRole = 'none' | 'villager' | 'congregation' | 'shopkeeper' | 'keeper' | 'elder' | 'mount' | 'stablehand';

export type ClientMessage =
  /**
   * `world` is which country this seed grows, and it is not decoration: the same seed grows two
   * completely different lands, and the server used to build one of them for everybody. A player
   * whose save said 'road' was walked about on the polygon world — houses in different places,
   * walls where the ground was clear — and since the server owns where a hero is standing, it
   * dragged him through the walls his own game had stopped him at. He was a ghost in his own
   * village. So the client says which world it is in, and the server grows that one.
   *
   * `islands` and `x`/`z` are the rest of that same sentence, added later and for the same reason.
   *
   * A country is a function of three things — the seed, the kind, and where the islands hang — and
   * two of them travelled while the third did not. Where the islands hang is planned from the seed
   * for any world made today, so the two halves agreed; a world saved before that code existed has
   * them written into its own manifest, and there the two halves would quietly grow two different
   * countries again. Now everything the generator is given comes up the wire, so `growWorld` cannot
   * be handed different arguments on the two sides. A join that leaves them out gets the seed's own
   * answer, which is what every world made by this code has.
   *
   * `x` and `z` are where the hero is standing, and they are here so that the world can have that
   * country grown before it is asked for it. A page waits a fifth of a second for the world and then
   * draws the ground itself; a world that starts growing when the first chunk is asked for takes
   * two-thirds of a second to answer, so every new country used to begin with a view of the page's
   * own guess. Told where somebody is at the moment they join, the world grows their first view
   * while it is still saying hello and the asking is answered out of memory.
   */
  | { type: 'join'; seed: number; name: string; version: number; day: number; time: number; world: WorldKind; islands?: Anchor[]; x?: number; z?: number }
  /**
   * `guilt` is how badly the law wants this player, from nought to one.
   *
   * Sent because the constables are the world's now and guilt is not: what the hero has done wrong
   * lives in his own save, which the server has never held and has no business holding. So the one
   * number a village needs in order to turn a man out into the street is told rather than kept, and
   * it rides on the message that is already going out several times a second. Left off by a client
   * that does not send it, which reads as nought — a world where nobody is wanted, which is the
   * honest answer for a client that never mentions it.
   */
  | { type: 'move'; x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[]; guilt?: number }
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
  /**
   * A hand on the tiller: along the bow, and round it.
   *
   * A steer for somebody who is not walking. The world holds the boat while anybody is sailing one
   * — where it is and which way its bow points — and moves it with the same arithmetic the client
   * does, so a boat is where everybody watching it says it is. The hero rides along on it.
   */
  | { type: 'helm'; seq: number; forward: number; turn: number; ms: number }
  | { type: 'say'; text: string }
  | { type: 'trade-offer'; to: string; gold: number; items: Array<[string, number]> }
  | { type: 'trade-accept'; from: string }
  | { type: 'trade-decline'; from: string }
  | { type: 'delta'; delta: WorldDelta }
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
  /**
   * `carried` is waking up after a knock on the head, which is the one placing the world could not
   * be told about. A hero who goes down is carried to the nearest village and set down in the
   * square — on his own screen. The world went on holding him where he fell, and since the world
   * owns where a hero is standing, its next word put him back there: you woke in the village and
   * were dragged out to the wolf that felled you, every time.
   *
   * It is checked rather than believed. The world grows the same villages from the same seed, so it
   * can ask whether the spot named is a village square of its own world — which is the whole of
   * what being carried home means, and the whole of what a client may claim by saying it.
   */
  | { type: 'stood'; x: number; z: number; why: 'teleport' | 'place' | 'ride' | 'carried' }
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
  | {
    type: 'floor'; place: string; anchor: string; kind: 'dungeon' | 'cave' | 'thicket' | 'wreck'; floor: number;
    /**
     * What the floor is made of, when that is not the same question as what the anchor is.
     *
     * `kind` is what salts the anchor's seed and `style` is what the rooms are grown as, and for
     * three of the four they are the same word. They are not for the drowned places: a whirlpool's
     * cavern hangs off a `dungeon` anchor and a wreck's hold off a `wreck` one, and both are grown
     * as `sunken` — flooded rooms, a drowned roster, the green-black light. Sent rather than
     * inferred because the two halves have to agree about the shape of a room to agree about where
     * anything in it is standing, and a floor the world grew as a vault while the page grew it as a
     * flooded hold is monsters inside walls.
     *
     * Optional, because a page that says nothing means what pages have always meant: grow it the
     * way the anchor kind says.
     */
    style?: 'vault' | 'cave' | 'thicket' | 'sunken' | 'castle';
  }
  /**
   * Asking the world for a piece of itself.
   *
   * Both halves grow the country from the seed today, which is why they can disagree about which
   * country they are in — and the answer is for the world to grow it and the page to be told. A page
   * asks for the chunks it does not have; a page that has been here before asks for nothing at all,
   * because the ground it kept is the ground it would be sent.
   *
   * Asked for rather than pushed, and that is the difference between an endless world and a stream:
   * the world does not decide what anybody needs to see, so it cannot be wrong about it, and a page
   * with a full store is silent.
   */
  | { type: 'want-chunks'; chunks: Array<[number, number]> }
  /**
   * Something happened that a villager will not forget, and this is him being told about it.
   *
   * The one thing about a villager that no client could ever work out for itself. Who lives where,
   * what they do and when they die all follow from the seed and a short list of deaths, so every
   * client already agrees about them — but what a man thinks of *you* depends on what you did, and
   * what you did happened on your screen and nobody else's. Two clients holding their own answer to
   * that is two villages, and the one you are standing in is whichever machine you are sitting at.
   *
   * So the world keeps the register that holds it. A gift, a rescue, a robbery on the road, a bad
   * day down a mine: each is a line here, applied to the world's own villager, and it comes back
   * down to everybody as part of what he is.
   *
   * `about` is a name rather than an id, exactly as a memory is: a name still means something after
   * the person or the place it belonged to is gone, and can never dangle.
   */
  | { type: 'recall'; who: string; what: Memory['what']; about: string }
  /**
   * A villager has been paid to walk with somebody, or has stopped.
   *
   * A hired man leaves the village. He is not one of the world's villagers any more — he goes
   * indoors with you, down staircases the world has never grown and onto boats it does not know
   * about, and he follows *you* rather than whichever player the world happened to be thinking
   * about this tick. So the world takes him off the street and the client that hired him stands one
   * of its own up in his place, which is the same arrangement a horse and a boat already have.
   */
  | { type: 'retain'; who: string; on: boolean }
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
  /**
   * A constable has laid hands on you, and this is which one.
   *
   * The same division as a bite. The world decided it happened — its villages, its constables, its
   * street — and what being taken in costs is the client's own book-keeping: the hours served, the
   * fine, the cell to wake up in, none of which the server has ever held. `id` is the creature the
   * client is already drawing, so it has a name to put on the message.
   */
  | { type: 'arrested'; id: number }
  | { type: 'welcome'; id: string; seed: number; players: Presence[]; clock: Clock; deltas: WorldDelta[] }
  /**
   * The country you joined is grown, and this is its fingerprint.
   *
   * Two things at once, and they are the two things this whole seam is about.
   *
   * It is a starting gun. A page draws its own ground when the world has not answered, because a
   * page that waited would stare at nothing every time a socket hiccupped — but on a first visit the
   * world has a hundred and twenty-one chunks to grow and takes far longer than the page's patience,
   * so the guard meant for a hiccup was firing on every new country. Between the welcome and this,
   * the page knows the world is working rather than silent, and waits; after it, the ordinary
   * fifth of a second stands.
   *
   * And it is evidence. `stamp` is the world's own country hashed — see `countryStamp` — and the
   * page compares it with the hash of the country it grew. The ground itself travels, so the two
   * halves cannot disagree about the height of a tile; everything *derived* from the country still
   * does not travel, so a village, a door or an eyrie is right only for as long as the two graphs
   * are the same graph. Sending both sides' answer to one cheap question is what turns that from a
   * hope into something the game can notice and say out loud.
   *
   * Empty on a world that grows no ground at all, which is a test harness rather than a game.
   */
  | { type: 'country'; stamp: string }
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

/**
 * Guard the islands off the wire: a handful of anchors, each one plain numbers and a short name.
 *
 * These are the one part of a country a client gets to choose, so they are the one part somebody
 * could use to make the world do work on their behalf. Each anchor grows a road tree of its own,
 * so a join carrying ten thousand of them would be a world server told to grow ten thousand
 * islands by a message that costs nothing to send. Hence the cap — a world has a handful and the
 * bound is generous against that — and hence every field being taken apart and put back rather
 * than believed.
 *
 * An anchor that does not survive this is dropped rather than the whole join being refused. A join
 * with no usable islands grows the seed's own, which is the right country for every world this
 * code has ever made and the safe answer for anything else.
 */
export function cleanIslands(raw: unknown): Anchor[] {
  if (!Array.isArray(raw)) return [];
  const out: Anchor[] = [];
  for (const one of raw.slice(0, LIMITS.ISLANDS)) {
    const a = one as Partial<Anchor>;
    const id = String(a?.id ?? '').slice(0, LIMITS.THING_ID);
    const x = Number(a?.x), z = Number(a?.z), seed = Number(a?.seed);
    if (!id || a?.kind !== 'island') continue;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(seed)) continue;
    out.push({
      id, kind: 'island', x: clamp(x, -1e6, 1e6), z: clamp(z, -1e6, 1e6), seed: seed >>> 0,
      parent: null, version: Math.max(1, Math.floor(Number(a?.version)) || 1),
    });
  }
  return out;
}

/** The name two joins have to agree on to be in the same country: the islands, said the same way. */
export function islandsSaidPlainly(islands: readonly Anchor[]): string {
  return islands.map((a) => `${a.id}@${Math.round(a.x)},${Math.round(a.z)}:${a.seed}`).sort().join(' ');
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
  /** How many of one thing can sit in a stack, on a stall or in a parcel. */
  STACK: 99,
  /**
   * Islands one join may hand the world.
   *
   * A world plans four or five and the oldest saves have no more, so this is generous by a factor
   * of six. It is a cap on work rather than on size: every anchor costs the world a road tree.
   */
  ISLANDS: 32,
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
/**
 * Where in the world a change happened, when it happened anywhere in particular.
 *
 * A sown field is at a place and a reaped one is the same place; a chest, a death and the founding
 * of a village are facts about the world rather than about a spot on it. Only the first kind can be
 * kept province by province, so only the first kind says where it is — and the rest say so by
 * answering null rather than by being guessed at from a name.
 */
export function deltaAt(delta: WorldDelta): { x: number; z: number } | null {
  if (delta.kind !== 'sow' && delta.kind !== 'reap') return null;
  const [x, z] = delta.tile.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

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

/**
 * The things a villager has a word for. Anything else is not a memory, whatever a client calls it.
 *
 * Written out rather than derived from the type, because a type is gone by the time the message
 * arrives and the whole job of this file is to be the thing that is still there at run time.
 */
const RECALLS: ReadonlySet<string> = new Set(['died', 'born', 'saved', 'robbed', 'given', 'feared']);

/**
 * Guard something a villager is being asked to remember.
 *
 * A client says what happened; it does not get to say anything that is not one of the six things
 * this world knows how to be affected by, and it does not get to hand a village a name the length
 * of a book. Nothing here checks whether it is *true* — a client claiming to have saved somebody's
 * life is claiming something the server cannot see and has no way to verify, exactly as it claims
 * how hard it hit. What it may not do is make the world's state a shape nothing else can read.
 */
export function cleanRecall(sent: unknown): { who: string; what: Memory['what']; about: string } | null {
  const said = sent as { who?: unknown; what?: unknown; about?: unknown } | null | undefined;
  const who = String(said?.who ?? '').slice(0, LIMITS.THING_ID);
  const what = String(said?.what ?? '');
  const about = String(said?.about ?? '').slice(0, LIMITS.VILLAGE);
  if (!who || !about || !RECALLS.has(what)) return null;
  return { who, what: what as Memory['what'], about };
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
      const what = delta.what === undefined ? undefined : id(delta.what);
      const to = delta.to === undefined ? undefined : id(delta.to);
      return {
        kind: 'built', id: id(delta.id), village: id(delta.village),
        x, z, rot, day: Math.max(1, Math.floor(day)),
        ...(what ? { what } : {}), ...(to ? { to } : {}),
      };
    }
    default: return null;
  }
}

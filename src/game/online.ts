import { socketLink, workerLink, type Link, type LinkEvents } from '../net/link';
import {
  EMOTES, PROTOCOL_VERSION, cleanChat, cleanName,
  type ClientMessage, type Clock, type Presence, type ServerMessage,
  type Letter, type PartyMember, type Stall, type StallItem, type TradeOffer, type WorldDelta,
} from '../../server/protocol';
// What the world says is read next door, because a switch over every kind of message is a different
// job from carrying the words. The vocabulary of the listening end goes with it, and comes back
// through here because half the game asks this file for it.
import { heard, type OnlineEvents } from './heard';
export type { OnlineEvents } from './heard';
import type { WorldKind } from '../save/store';
import type { Anchor } from '../world/manifest';
import type { GameState } from './state';
import type { Memory } from '../world/people';
import { ITEMS } from './items';

export type { Clock, Letter, PartyMember, Presence, Stall, StallItem, TradeOffer, WorldDelta };

/** How often we tell the server where we are. */
const MOVE_INTERVAL = 0.12;

/**
 * How long a world may say nothing at all before it is taken to have gone, in seconds.
 *
 * Presence goes out ten times a second and the creatures three, so a world with anybody in it is
 * never quiet for long. Six seconds is far past any hiccup and well short of a player deciding the
 * game is broken — which is what the alternative looks like, because a frozen world is
 * indistinguishable from a simulation that has stopped.
 */
const QUIET = 6;

/**
 * How long to wait before trying a lost world again, in seconds, and how far that backs off.
 *
 * A connection does not usually come back on the instant it went: a wifi handover takes a couple of
 * seconds, a laptop lid takes as long as it takes, and a server being restarted takes a minute. So
 * the first try is quick, because most drops are momentary and getting straight back in is what a
 * player wants; and each try after that waits longer, because hammering a machine that is not there
 * helps nobody and a phone doing it on a train does it all the way to the terminus.
 *
 * Capped, rather than doubling for ever: somebody who leaves the tab open over lunch should be back
 * in the world within half a minute of the server returning, not an hour later.
 */
const RETRY = { FIRST: 1, GROWTH: 2, LONGEST: 30 };

/**
 * How long out of touch before the player is told about it, in seconds.
 *
 * Joining takes a moment, and so does a hiccup, and a badge that appears for two frames every time
 * a page opens is worse than no badge: it teaches people to ignore it. Two seconds is longer than
 * any handshake worth waiting for and far shorter than the point at which a frozen world starts to
 * look like a broken one.
 */
const GRACE = 2;

/**
 * The rest of what a world has to be told at the door, beyond a seed and a kind.
 *
 * Both exist because a world told nothing has to guess, and both guesses were wrong in ways nobody
 * could see. Told nothing about the islands it grows the seed's own, which is a different country
 * from a save that has its own written down. Told nothing about where the hero stands it has
 * nowhere to grow, so it waits to be asked and answers too late to be believed. Optional, because a
 * page that says neither still plays: it gets the seed's country grown on demand, as pages used to.
 */
export interface CountryHere {
  /** Where the hero is standing, so the world can have that ground ready before it is asked. */
  at?: { x: number; z: number };
  /** Where this world's islands hang, which the seed alone does not settle for an older save. */
  islands?: readonly Anchor[];
}


/**
 * The multiplayer client. Everything about the world stays local and seed-derived; the only
 * things that cross the wire are where people are, what they say, and what they hand over.
 * The connection is optional in every sense: with no server, the game is exactly as it was.
 */
export class Online {
  private link: Link | null = null;
  /**
   * True when the world is the one in this tab rather than one on a server.
   *
   * It changes nothing about the protocol and one thing about the manners: joining your own world
   * is not news. Without this, every solo game opens with "Joined world 3 as Traveller. 0 other
   * travellers here", which is the game announcing itself to itself.
   */
  private local = false;
  private sinceMove = 0;
  /**
   * How long since the world last said anything, in seconds.
   *
   * A world talks constantly — presence ten times a second, the creatures near you three times —
   * so silence means it has gone, whatever the socket believes. And a socket can believe a great
   * deal: a phone that sleeps, a wifi handover, a laptop lid, all leave a connection that is open
   * and dead at once, with nothing arriving and no close ever fired. What the player sees then is
   * a world that has frozen — every animal standing exactly where it was, because the client is
   * faithfully drawing the last thing it was told.
   */
  private sinceHeard = 0;
  private url = '';
  /** What was joined last, so a world that goes quiet can be rejoined rather than merely mourned. */
  private joined: { seed: number; clock: Clock; world: WorldKind } | null = null;
  /** Other people in this world, by id. */
  readonly players = new Map<string, Presence>();
  id = '';
  name = 'Traveller';
  /** Everyone else this world has seen, whether or not they are here now. */
  folk: string[] = [];
  status: 'offline' | 'connecting' | 'online' = 'offline';
  /**
   * Whether the player means to be in a world, which is a different question from being in one.
   *
   * Everything that gets between a page and a server — a lid, a tunnel, a server being restarted —
   * looks from in here exactly like the player pressing leave, and the two want opposite treatment.
   * So the intent is kept: while this is true a lost connection is something to keep trying, and it
   * is only put down when somebody actually asks to leave.
   */
  private wanted = false;
  /** Seconds until the next attempt, and how many have failed, which is what makes it back off. */
  private retryIn = 0;
  private tries = 0;
  /**
   * How long this attempt has been knocking, in seconds.
   *
   * A socket that is refused fires a close and is dealt with; a socket that is *ignored* does
   * neither — a server whose machine is up but whose process is gone, a captive portal swallowing
   * the handshake — and the connect sits in `connecting` for as long as the tab is open. Timed, so
   * that a knock nobody answers is a knock to try again rather than a state to live in.
   */
  private knocking = 0;
  /** How long there has been no world, in seconds, which is what the badge waits on. See `GRACE`. */
  private outFor = 0;

  /**
   * @param linkFor how to reach a world: a url for somebody's server, empty for the one in the next
   * thread. Handed in rather than reached for so that a test can supply a world that says nothing,
   * which is the case worth testing and the one that cannot be arranged with a real socket.
   */
  constructor(
    private readonly events: OnlineEvents,
    private readonly linkFor: (url: string, events: LinkEvents) => Link | null =
      (url, events) => (url ? socketLink(url, events) : workerLink(events)),
  ) {}

  get connected(): boolean { return this.status === 'online'; }

  /**
   * Connected to somebody *else's* world, as against the one in this tab.
   *
   * The difference matters to exactly one caller and it matters completely. Every game is now
   * connected to a world from the moment it opens — playing alone is playing against the same
   * simulation, hosted in a worker beside the page — so "are we connected" stopped being the
   * question the join button was asking. It went on asking it, and so the button that joins a
   * server did nothing but leave the world in this tab and rejoin it: the address was read, and
   * never used. Two windows, an invite link, both players "online", and neither able to see the
   * other.
   */
  get away(): boolean { return this.connected && !this.local; }
  get count(): number { return this.players.size; }

  /**
   * Join the world of this seed on the server given.
   *
   * `url` empty means the world in the next thread: the same simulation, hosted in a Web Worker
   * beside the page rather than on a machine somewhere. Nothing below this line knows the
   * difference, which is what keeps one implementation honest.
   *
   * `world` goes with the seed because a seed is not a world: the same number grows a road country
   * or a polygon one and they share nothing. The server used to assume the polygon one, so a road
   * world's player was walked about on a land he could not see — see the note on `join` in
   * `server/protocol.ts`.
   */
  connect(url: string, seed: number, name: string, clock: Clock, world: WorldKind, country: CountryHere = {}): void {
    this.drop();
    this.wanted = true;
    this.retryIn = 0;
    this.knocking = 0;
    this.url = url;
    this.local = url === '';
    this.name = cleanName(name);
    this.status = 'connecting';
    this.sinceHeard = 0;
    this.joined = { seed, clock, world };

    const events: LinkEvents = {
      onOpen: () => this.send({
        type: 'join', seed, name: this.name, version: PROTOCOL_VERSION, day: clock.day, time: clock.time, world,
        // the rest of what a country is made of, so the world grows this one and not its own idea
        islands: country.islands ? [...country.islands] : undefined,
        x: country.at?.x, z: country.at?.z,
      }),
      onMessage: (parcel) => {
        this.sinceHeard = 0;
        // words are what everything says today; bytes are the world itself, and nothing sends one
        // yet — so anything that is not words is kept rather than guessed at
        if (typeof parcel === 'string') this.receive(parcel);
        else this.events.onParcel?.(parcel);
      },
      onClose: (why) => {
        if (this.status !== 'offline' && !this.local) this.events.onSystem(why);
        // nobody is telling us what lives here any more
        this.events.onWorldSilent();
        this.status = 'offline';
        this.players.clear();
        this.link = null;
        // and if they meant to be here, they still do: wait a little and knock again
        if (this.wanted) this.retryIn = this.backoff();
      },
    };
    const link = this.linkFor(url, events);
    if (!link) {
      this.status = 'offline';
      this.events.onSystem(`Could not reach ${url}.`);
      return;
    }
    this.link = link;
  }

  /**
   * Leave, and mean it: no retry, whatever happens next.
   *
   * What the player asks for by pressing the button, and what the server asks for by telling us to
   * go. Everything else that ends a connection goes through `drop`, which lets go of the link and
   * leaves the intent standing.
   */
  disconnect(): void {
    this.wanted = false;
    this.retryIn = 0;
    this.tries = 0;
    this.drop();
  }

  /**
   * Whether the game is trying to get back into a world it lost.
   *
   * For the HUD, which shows it: a player whose world has gone quiet should be told that the game
   * knows, rather than left to work it out from the animals standing still.
   */
  get reaching(): boolean { return this.wanted && this.status !== 'online' && this.outFor > GRACE; }

  /** Let go of the link without letting go of the intention. */
  private drop(): void {
    if (!this.link) return;
    this.status = 'offline';
    this.link.close();
    this.link = null;
    this.players.clear();
    // Nobody is telling us what lives here any more, so this client takes the wildlife back. Said
    // here as well as on the socket's own close, because a link that is closed from this side may
    // never fire one — and a world nothing is simulating is a world where every animal stands
    // still for ever.
    this.events.onWorldSilent();
  }

  /** How long to wait before the next try, longer each time and never longer than `RETRY.LONGEST`. */
  private backoff(): number {
    const wait = RETRY.FIRST * RETRY.GROWTH ** this.tries;
    this.tries++;
    return Math.min(RETRY.LONGEST, wait);
  }

  /**
   * Throw a blow at whatever the world says is in front of the hero, in the world he is in.
   *
   * We say how hard, how far and how wide, and nothing about what it hit: the world has been
   * walking this hero and owns the creatures round him, so which of them were in the arc is its
   * business. What it did about it comes back as a snapshot, or as a body falling.
   */
  swing(place: string, damage: number, reach: number, arc: number, one = false): void {
    this.send({ type: 'swing', place, damage, reach, arc, one });
  }

  /**
   * What has gone up the wire and what has come down it, counted by kind.
   *
   * For the question "did that even leave the building": a blow that lands on nothing looks
   * identical from in here whether the world refused it, never heard of it, or was never told.
   */
  readonly tally = { sent: new Map<string, number>(), heard: new Map<string, number>() };

  private static count(where: Map<string, number>, what: string): void {
    where.set(what, (where.get(what) ?? 0) + 1);
  }

  private send(message: ClientMessage): void {
    if (!this.link?.ready) return;
    Online.count(this.tally.sent, message.type);
    this.link.send(JSON.stringify(message));
  }

  /**
   * A line of words from the world.
   *
   * Counted, and then handed to `heard.ts` — which is where every kind of message is taken apart.
   * What is passed with it is the little of this connection that reading one has to touch: who else
   * is here, who we are, and the three things a message can change about either.
   */
  private receive(raw: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(raw) as ServerMessage; } catch { return; }
    Online.count(this.tally.heard, message.type);
    heard({
      events: this.events, players: this.players, id: this.id, name: this.name, local: this.local,
      // in: whatever it took to get here, the next drop starts counting from the beginning again
      admitted: (id) => { this.id = id; this.status = 'online'; this.tries = 0; },
      metThem: (names) => { this.folk = names.filter((name) => name !== this.name); },
      leave: () => this.disconnect(),
    }, message);
  }

  /** Tell the server where we are, a few times a second. */
  update(dt: number, me: { x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[]; guilt?: number }): void {
    if (!this.connected) {
      this.outFor += dt;
      if (!this.wanted || !this.joined) return;
      if (this.status === 'connecting') {
        // a door nobody is answering: stop waiting at it and go round again
        this.knocking += dt;
        if (this.knocking > QUIET) { this.drop(); this.retryIn = this.backoff(); }
        return;
      }
      // knocking again, on the clock rather than on every frame: see `RETRY`
      this.retryIn -= dt;
      if (this.retryIn > 0) return;
      const again = this.joined;
      this.connect(this.url, again.seed, this.name, again.clock, again.world);
      return;
    }
    // A world that has stopped talking has gone, whatever the socket says about itself. Noticed
    // here rather than left to the connection, because the failure that matters is the one where
    // the connection never notices: a phone that slept, a wifi handover, a laptop lid. The socket
    // stays open, nothing arrives, no close is fired, and the game freezes with every animal
    // standing exactly where it last was — which is the client faithfully drawing the last thing
    // it was told, and looks for all the world like a bug in the simulation.
    this.outFor = 0;
    this.sinceHeard += dt;
    if (this.sinceHeard > QUIET) { this.lost(); return; }
    this.sinceMove += dt;
    if (this.sinceMove < MOVE_INTERVAL) return;
    this.sinceMove = 0;
    this.send({ type: 'move', ...me });
  }

  /**
   * The world has gone quiet. Say so, let go of it, and go and join it again.
   *
   * Rejoining rather than dropping to the world in this tab: they were playing in somebody's world
   * and the honest thing is to try to get them back into it. If it cannot be reached, the connect
   * fails the way any connect does and the game says so — and whatever happens, the wildlife starts
   * moving again, because `onWorldSilent` hands the creatures back to this client until a world is
   * telling it about them.
   */
  private lost(): void {
    const rejoin = this.joined;
    this.events.onSystem(this.local
      ? 'The world in this tab stopped answering. Starting it again.'
      : 'The world went quiet. Trying it again.');
    this.drop();
    if (rejoin) this.connect(this.url, rejoin.seed, this.name, rejoin.clock, rejoin.world);
    else this.wanted = false;
  }

  /**
   * Say which way we pushed and for how long, so the world can walk the hero itself.
   *
   * Sent beside `move` rather than instead of it: a move still carries what the hero looks like
   * and where he is when the server is not walking him — indoors, underground, at sea. What the
   * server does with a move's position while it owns him is ignore it.
   */
  steer(seq: number, dx: number, dz: number, pace: number, dt: number): void {
    if (this.connected) this.send({ type: 'steer', seq, dx, dz, pace, ms: Math.round(dt * 1000) });
  }

  /**
   * A hand on the tiller. The world holds the boat while anybody is sailing one and moves it with
   * the same arithmetic this side does, so a boat is in one place for everybody watching it.
   */
  helm(seq: number, forward: number, turn: number, dt: number): void {
    if (this.connected) this.send({ type: 'helm', seq, forward, turn, ms: Math.round(dt * 1000) });
  }

  /**
   * Lifting the lid on a chest, and asking whether that was allowed.
   *
   * The one thing this side asks rather than reports. The page has already opened it — see
   * `Openings` — so nothing waits on this; what comes back is `opened`, and the page either forgets
   * it or gives the gold back.
   */
  open(ask: { seq: number; place: string; index: number; owns: string[] }): void {
    if (this.connected) this.send({ type: 'open', ...ask });
  }

  /**
   * Lifting a ripe crop, and asking whether there was one there.
   *
   * The field is already empty and the crop is already in the pack; this asks the world, which keeps
   * the clock and the sowing, whether that was so. Answered by `harvested`.
   */
  harvest(seq: number, tile: string): void {
    if (this.connected) this.send({ type: 'harvest', seq, tile });
  }

  /**
   * Putting a seed in the ground, and asking whether it will take.
   *
   * The page has already planted it. What the world knows better is the ground under the tile, the
   * day of the year, and whether somebody else sowed it first. Answered by `sown`.
   */
  sow(seq: number, tile: string, crop: string): void {
    if (this.connected) this.send({ type: 'sow', seq, tile, crop });
  }

  /**
   * The hero has gone underground: which floor, hanging off which anchor, and how deep.
   *
   * The world grows the same floor from its own root seed and the anchor's name, so this carries no
   * seed of its own — two people who name the same floor are standing in the same one because the
   * arithmetic says so, not because they agreed about it.
   *
   * The style is sent as well as the kind, because for the drowned places the two are different
   * questions: the kind is what salts the anchor's seed, and the style is what the rooms are grown
   * as. A whirlpool's cavern hangs off a `dungeon` anchor and a wreck's hold off a `wreck` one, and
   * both are flooded. A world that grew one of those as a vault while the page grew it as a flooded
   * hold would put every creature in it inside a wall.
   */
  floor(
    place: string, anchor: string, kind: 'dungeon' | 'cave' | 'thicket' | 'wreck', floor: number,
    style?: 'vault' | 'cave' | 'thicket' | 'sunken' | 'castle',
  ): void {
    if (this.connected) this.send({ type: 'floor', place, anchor, kind, floor, style });
  }

  /**
   * The hero has been put somewhere rather than having walked there: a teleport, a staircase, a
   * door, a gangplank, a saddle. The world moves its own copy of him and answers with where.
   */
  stood(x: number, z: number, why: Extract<ClientMessage, { type: 'stood' }>['why']): void {
    if (this.connected) this.send({ type: 'stood', x, z, why });
  }

  /**
   * Ask the world to wind its clock. Refused where anybody else is in it, and silently: the world
   * simply goes on saying what time it is, which is the answer.
   */
  setClock(day: number, time: number): void {
    if (this.connected) this.send({ type: 'setclock', day, time });
  }

  /** Tell everyone about something we changed in the world. */
  /**
   * Ask the world for pieces of itself.
   *
   * Only what this page does not have: ground it kept from an earlier visit is ground it would be
   * sent again, so a page walking country it has walked before says nothing at all. Silence when
   * there is nobody to ask, which is what playing alone with the world in the next thread is not —
   * there is always somebody to ask, and that is the point of hosting the simulation twice.
   *
   * @returns whether anybody heard it, which is the whole reason this returns anything. There is a
   * window at the start of every game between the link opening and the welcome arriving, and asking
   * inside it went nowhere: dropped here for want of a world, with the caller having already
   * written the chunk down as asked for. A hundred and ten of a hundred and twenty-one chunks the
   * world was never told about, drawn by the page and never put right, for the whole visit — and
   * unseen, because it turns on which of two promises settles first.
   */
  wantChunks(chunks: Array<[number, number]>): boolean {
    if (chunks.length === 0 || !this.connected) return false;
    this.send({ type: 'want-chunks', chunks });
    return true;
  }

  report(delta: WorldDelta): void {
    if (this.connected) this.send({ type: 'delta', delta });
  }

  /**
   * Something happened that one of the world's villagers will not forget.
   *
   * The only way a memory ever reaches him now. Everything else about a villager is worked out from
   * the seed and a short list of deaths on both sides at once, so it needs no telling; what he holds
   * about *you* happened on this screen and would otherwise stay on it, which is two clients holding
   * two men of the same name in two different moods.
   *
   * It is said as well as done rather than instead of it: the game applies it to its own book at the
   * same moment, because a villager who thanks you a third of a second late is a villager who did
   * not notice, and because a page with no world behind it is the world and this is silence.
   */
  recall(who: string, what: Memory['what'], about: string): void {
    if (this.connected) this.send({ type: 'recall', who, what, about });
  }

  /**
   * A villager has been paid to walk with us, or has stopped.
   *
   * The world takes him off the street when it hears this, because a hired man is not in his village
   * any more — he goes indoors, down staircases and onto boats, none of which the world could walk
   * him through. This side stands one of its own up in his place, which is what a horse and a boat
   * already are.
   */
  retain(who: string, on: boolean): void {
    if (this.connected) this.send({ type: 'retain', who, on });
  }

  /** Rent a market pitch, put something on it, buy from it, take the money, or give it up. */
  rentStall(stall: string, village: string): void {
    if (this.connected) this.send({ type: 'stall-rent', stall, village });
  }

  stockStall(stall: string, item: StallItem): void {
    if (this.connected) this.send({ type: 'stall-stock', stall, item });
  }

  buyFromStall(stall: string, index: number): void {
    if (this.connected) this.send({ type: 'stall-buy', stall, index });
  }

  collectStall(stall: string): void {
    if (this.connected) this.send({ type: 'stall-collect', stall });
  }

  closeStall(stall: string): void {
    if (this.connected) this.send({ type: 'stall-close', stall });
  }

  /** Leave a parcel at the inns for somebody, here or not. */
  postMail(to: string, gold: number, items: Array<[string, number]>): void {
    if (this.connected) this.send({ type: 'mail-send', to, gold, items });
  }

  /** Ask the innkeeper for whatever is waiting under your name. */
  fetchMail(): void {
    if (this.connected) this.send({ type: 'mail-fetch' });
  }

  /** Ask somebody to travel with you, answer their asking, or go your own way. */
  invite(to: string): void {
    if (this.connected) this.send({ type: 'party-invite', to });
  }

  answerInvite(from: string, yes: boolean): void {
    if (this.connected) this.send({ type: 'party-answer', from, yes });
  }

  leaveParty(): void {
    if (this.connected) this.send({ type: 'party-leave' });
  }

  /** Tell your companions you finished an errand, so it counts for them as well. */
  shareDeed(quest: string): void {
    if (this.connected) this.send({ type: 'party-deed', quest });
  }

  /**
   * Say something without words. Returns false when that is not a gesture anybody knows, so the
   * chat line can be sent as it was typed instead.
   */
  emote(kind: string): boolean {
    if (!EMOTES[kind]) return false;
    if (this.connected) this.send({ type: 'emote', kind });
    return true;
  }

  /** Drop a rally point where you stand. */
  ping(x: number, z: number): void {
    if (this.connected) this.send({ type: 'ping', x, z });
  }

  /** Ask somebody for a friendly bout, answer their asking, land a blow, or give it up. */
  challenge(to: string): void {
    if (this.connected) this.send({ type: 'duel-challenge', to });
  }

  answerChallenge(from: string, yes: boolean): void {
    if (this.connected) this.send({ type: 'duel-answer', from, yes });
  }

  duelHit(damage: number): void {
    if (this.connected) this.send({ type: 'duel-hit', damage });
  }

  yieldDuel(): void {
    if (this.connected) this.send({ type: 'duel-yield' });
  }

  /** Ask somebody for a fight with sides, with whatever you have already paid for behind you. */
  muster(to: string, swords: number): void {
    if (this.connected) this.send({ type: 'warband-challenge', to, swords });
  }

  /** Answer an asking, saying how many of your own you would bring. */
  answerMuster(from: string, yes: boolean, swords: number): void {
    if (this.connected) this.send({ type: 'warband-answer', from, yes, swords });
  }

  /** A blow landed by you or by one of your men. */
  warbandHit(damage: number, sword: boolean): void {
    if (this.connected) this.send({ type: 'warband-hit', damage, sword });
  }

  /** How many of yours are still standing, said only when that changes. */
  warbandMuster(swords: number): void {
    if (this.connected) this.send({ type: 'warband-muster', swords });
  }

  /** Give it up. */
  yieldWarband(): void {
    if (this.connected) this.send({ type: 'warband-yield' });
  }

  say(text: string): void {
    const clean = cleanChat(text);
    if (clean) this.send({ type: 'say', text: clean });
  }

  /** Offer gold and goods to somebody standing near you. */
  offer(to: string, gold: number, items: Array<[string, number]>): void {
    this.send({ type: 'trade-offer', to, gold, items });
  }

  answer(from: string, accept: boolean): void {
    this.send(accept ? { type: 'trade-accept', from } : { type: 'trade-decline', from });
  }

  /** The nearest other player within reach, for trading with. */
  nearest(x: number, z: number, range: number): Presence | null {
    let best: Presence | null = null;
    let bestDistance = range * range;
    for (const p of this.players.values()) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestDistance) { bestDistance = d; best = p; }
    }
    return best;
  }
}

/**
 * Apply a finished trade to your own state. The sender loses what they offered; the receiver
 * gains it. Nothing is created: the server never touches anyone's purse, each side does its half.
 */
export function applyTrade(state: GameState, offer: TradeOffer, iSent: boolean): string {
  const names: string[] = [];
  if (iSent) {
    state.inventory.gold = Math.max(0, state.inventory.gold - offer.gold);
    for (const [id, n] of offer.items) state.take(id, n);
  } else {
    state.inventory.gold += offer.gold;
    for (const [id, n] of offer.items) state.give(id, n);
  }
  if (offer.gold > 0) names.push(`${offer.gold} gold`);
  for (const [id, n] of offer.items) names.push(`${n}× ${ITEMS[id]?.name ?? id}`);
  state.version++;
  return names.join(', ') || 'nothing';
}

/** Everything you are carrying that could be handed over, most valuable first. */
export function tradableItems(state: GameState): Array<[string, number]> {
  return [...state.inventory.items.entries()]
    .filter(([id]) => ITEMS[id])
    .sort((a, b) => (ITEMS[b[0]].price * b[1]) - (ITEMS[a[0]].price * a[1]));
}

import { socketLink, workerLink, type Link, type LinkEvents } from '../net/link';
import {
  EMOTES, PROTOCOL_VERSION, cleanChat, cleanName,
  type ClientMessage, type Clock, type MonsterSnap, type Presence, type ServerMessage,
  type CreatureSnap, type Letter, type PartyMember, type Stall, type StallItem, type TradeOffer, type WorldDelta,
} from '../../server/protocol';
import type { GameState } from './state';
import { ITEMS } from './items';

export type { Clock, Letter, MonsterSnap, PartyMember, Presence, Stall, StallItem, TradeOffer, WorldDelta };

/** How often we tell the server where we are. */
const MOVE_INTERVAL = 0.12;

export interface OnlineEvents {
  onChat: (line: string) => void;
  onSystem: (line: string) => void;
  /** The world's own time, which everyone in it shares. */
  onClock: (clock: Clock) => void;
  /** A command from whoever operates this world, to run on our own bus. */
  onCommand: (line: string, issuer: string) => void;
  /** The creatures the world says are near us, and the ones that have gone from sight. */
  onCreatures: (near: CreatureSnap[], gone: number[]) => void;
  /** One of the world's creatures died. `mine` is true when it was our blow that did it. */
  onCreatureKilled: (id: number, mine: boolean) => void;
  /** One of the world's creatures bit us, and how hard. What it costs is our own business. */
  onBitten: (id: number, damage: number) => void;
  /** We are no longer being told what lives here, so the game decides for itself again. */
  onWorldSilent: () => void;
  /** The world has walked our own hero, and this is where it says he is standing. */
  onWhereYouAre: (seq: number, x: number, z: number, y: number) => void;
  /** Something another player changed about the world, or the backlog of it on joining. */
  onDelta: (delta: WorldDelta, catchingUp: boolean) => void;
  /** The owner of a dungeon floor describing its monsters. */
  onMonsters: (place: string, snap: MonsterSnap[], gone: number[]) => void;
  /** Somebody on our floor says they struck a monster; we own it, so we decide. */
  onHit: (place: string, index: number, damage: number) => void;
  /** The market as the server sees it: who holds which pitch and what is on it. */
  onStalls: (stalls: Stall[]) => void;
  /** A purchase from somebody's stall went through: the goods are yours, so pay for them. */
  onBought: (stall: string, item: StallItem, cost: number) => void;
  /** Takings from your own stall, handed back. */
  onTakings: (stall: string, gold: number) => void;
  /** A stall would not do what you asked, and why. */
  onStallRefused: (stall: string, reason: string) => void;
  /** Everyone this world has seen, so a parcel can be addressed to somebody who is away. */
  onFolk: (names: string[]) => void;
  /** Parcels handed over at the inn: take what is in them. */
  onMail: (letters: Letter[]) => void;
  /** Word from the post shelf: something waiting, your parcel away, or your parcel turned down. */
  onMailWord: (line: string, kind: 'waiting' | 'sent' | 'refused') => void;
  /** Somebody would like a friendly bout, or has answered your own asking. */
  onDuelWord: (line: string, challenge: { from: string; name: string } | null) => void;
  /** The bout has begun against this person. */
  onDuelBegun: (withId: string, withName: string) => void;
  /** A blow landed on you in the ring. */
  onDuelStruck: (damage: number) => void;
  /** The bout is over: the winner's id, empty when it was called off. */
  onDuelOver: (winner: string, name: string) => void;
  /** Somebody would fight you with sides, or has answered your own asking. */
  onWarbandWord: (line: string, challenge: { from: string; name: string; swords: number } | null) => void;
  /** The fight has begun against this person, with this many swords behind him. */
  onWarbandBegun: (withId: string, withName: string, swords: number) => void;
  /** A blow landed on your side. Where it goes is yours to say. */
  onWarbandStruck: (damage: number, sword: boolean) => void;
  /** How many of their men are still on their feet. */
  onWarbandMuster: (swords: number) => void;
  /** The fight is over: the winner's id, empty when it was called off. */
  onWarbandOver: (winner: string, name: string) => void;
  /** Somebody made a gesture: show it over their head. */
  onEmote: (id: string, name: string, emoji: string, kind: string) => void;
  /** A rally point somebody dropped, to stand on the map for a while. */
  onPing: (x: number, z: number, name: string) => void;
  /** Who you are travelling with now. */
  onParty: (members: PartyMember[]) => void;
  /** Somebody would like you to travel with them, or has answered your own asking. */
  onPartyWord: (line: string, invite: { from: string; name: string } | null) => void;
  /** An errand a companion finished, which counts for you too. */
  onPartyDeed: (quest: string, from: string) => void;
  /** Somebody has offered you goods; answering is up to the player. */
  onOffer: (offer: TradeOffer, fromName: string) => void;
  /** A trade you were part of finished: apply it to your own purse. */
  onTradeResult: (result: { withId: string; accepted: boolean; offer: TradeOffer; iSent: boolean }) => void;
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
  private url = '';
  /** Other people in this world, by id. */
  readonly players = new Map<string, Presence>();
  id = '';
  name = 'Traveller';
  /** Everyone else this world has seen, whether or not they are here now. */
  folk: string[] = [];
  status: 'offline' | 'connecting' | 'online' = 'offline';

  constructor(private readonly events: OnlineEvents) {}

  get connected(): boolean { return this.status === 'online'; }
  get count(): number { return this.players.size; }

  /**
   * Join the world of this seed on the server given.
   *
   * `url` empty means the world in the next thread: the same simulation, hosted in a Web Worker
   * beside the page rather than on a machine somewhere. Nothing below this line knows the
   * difference, which is what keeps one implementation honest.
   */
  connect(url: string, seed: number, name: string, clock: Clock): void {
    this.disconnect();
    this.url = url;
    this.local = url === '';
    this.name = cleanName(name);
    this.status = 'connecting';

    const events: LinkEvents = {
      onOpen: () => this.send({
        type: 'join', seed, name: this.name, version: PROTOCOL_VERSION, day: clock.day, time: clock.time,
      }),
      onMessage: (text) => this.receive(text),
      onClose: (why) => {
        if (this.status !== 'offline' && !this.local) this.events.onSystem(why);
        // nobody is telling us what lives here any more
        this.events.onWorldSilent();
        this.status = 'offline';
        this.players.clear();
        this.link = null;
      },
    };
    const link = url ? socketLink(url, events) : workerLink(events);
    if (!link) {
      this.status = 'offline';
      this.events.onSystem(`Could not reach ${url}.`);
      return;
    }
    this.link = link;
  }

  disconnect(): void {
    if (!this.link) return;
    this.status = 'offline';
    this.link.close();
    this.link = null;
    this.players.clear();
  }

  /**
   * Throw a blow at whatever the world says is in front of the hero.
   *
   * We say how hard, how far and how wide, and nothing about what it hit: the world has been
   * walking this hero and owns the creatures round him, so which of them were in the arc is its
   * business. What it did about it comes back as a snapshot, or as a body falling.
   */
  swing(damage: number, reach: number, arc: number, one = false): void {
    this.send({ type: 'swing', damage, reach, arc, one });
  }

  private send(message: ClientMessage): void {
    if (this.link?.ready) this.link.send(JSON.stringify(message));
  }

  private receive(raw: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(raw) as ServerMessage; } catch { return; }
    switch (message.type) {
      case 'welcome':
        this.id = message.id;
        this.status = 'online';
        for (const p of message.players) this.players.set(p.id, p);
        this.events.onClock(message.clock);
        // catch up on everything that happened here before we arrived
        for (const delta of message.deltas) this.events.onDelta(delta, true);
        if (!this.local) {
          this.events.onSystem(`Joined world ${message.seed} as ${this.name}. ${message.players.length} other traveller${message.players.length === 1 ? '' : 's'} here, ${message.deltas.length} thing${message.deltas.length === 1 ? '' : 's'} already changed.`);
        }
        break;
      case 'youAre':
        this.events.onWhereYouAre(message.seq, message.x, message.z, message.y);
        break;
      case 'clock':
        this.events.onClock(message.clock);
        break;
      case 'creatures':
        this.events.onCreatures(message.near, message.gone);
        break;
      case 'killed':
        this.events.onCreatureKilled(message.id, message.by === this.id);
        break;
      case 'bitten':
        this.events.onBitten(message.id, message.damage);
        break;
      case 'command':
        // whoever operates this world has sent something to do. What it does is the client's own
        // business: the vocabulary is shared, the handlers are not.
        this.events.onCommand(message.line, message.issuer);
        break;
      case 'delta':
        this.events.onDelta(message.delta, false);
        break;
      case 'joined':
        this.players.set(message.player.id, message.player);
        this.events.onSystem(`${message.player.name} has arrived.`);
        break;
      case 'left': {
        const gone = this.players.get(message.id);
        this.players.delete(message.id);
        if (gone) this.events.onSystem(`${gone.name} has gone.`);
        break;
      }
      case 'presence': {
        const seen = new Set<string>();
        for (const p of message.players) { this.players.set(p.id, p); seen.add(p.id); }
        for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
        break;
      }
      case 'monsters':
        this.events.onMonsters(message.place, message.snap, message.gone);
        break;
      case 'hit':
        this.events.onHit(message.place, message.index, message.damage);
        break;
      case 'stalls':
        this.events.onStalls(message.stalls);
        break;
      case 'stall-bought':
        this.events.onBought(message.stall, message.item, message.cost);
        break;
      case 'stall-takings':
        this.events.onTakings(message.stall, message.gold);
        break;
      case 'stall-refused':
        this.events.onStallRefused(message.stall, message.reason);
        break;
      case 'folk':
        this.folk = message.names.filter((name) => name !== this.name);
        this.events.onFolk(message.names);
        break;
      case 'mail':
        this.events.onMail(message.letters);
        break;
      case 'mail-here':
        this.events.onMailWord(`${message.from} left something for you at the inn.`, 'waiting');
        break;
      case 'mail-sent':
        this.events.onMailWord(`Your parcel waits at the inn for ${message.to}.`, 'sent');
        break;
      case 'mail-refused':
        this.events.onMailWord(message.reason, 'refused');
        break;
      case 'party':
        this.events.onParty(message.members);
        break;
      case 'party-invited':
        this.events.onPartyWord(`${message.fromName} asks you to travel together.`, { from: message.from, name: message.fromName });
        break;
      case 'party-declined':
        this.events.onPartyWord(`${message.name} would rather travel alone.`, null);
        break;
      case 'party-deed':
        this.events.onPartyDeed(message.quest, message.from);
        break;
      case 'duel-challenged':
        this.events.onDuelWord(`${message.fromName} challenges you to a friendly bout.`, { from: message.from, name: message.fromName });
        break;
      case 'duel-begun':
        this.events.onDuelBegun(message.withId, message.withName);
        break;
      case 'duel-struck':
        this.events.onDuelStruck(message.damage);
        break;
      case 'warband-challenged':
        this.events.onWarbandWord(
          `${message.fromName} would fight you, with ${message.swords} sword${message.swords === 1 ? '' : 's'} behind him.`,
          { from: message.from, name: message.fromName, swords: message.swords },
        );
        break;
      case 'warband-begun':
        this.events.onWarbandBegun(message.withId, message.withName, message.swords);
        break;
      case 'warband-struck':
        this.events.onWarbandStruck(message.damage, message.sword);
        break;
      case 'warband-muster':
        this.events.onWarbandMuster(message.swords);
        break;
      case 'warband-over':
        this.events.onWarbandOver(message.winner, message.name);
        break;
      case 'duel-over':
        this.events.onDuelOver(message.winner, message.name);
        break;
      case 'emoted':
        this.events.onEmote(message.id, message.name, EMOTES[message.kind] ?? '❔', message.kind);
        break;
      case 'pinged':
        this.events.onPing(message.x, message.z, message.name);
        break;
      case 'said':
        this.events.onChat(`${message.name}: ${message.text}`);
        break;
      case 'trade-offered':
        this.events.onOffer(message.offer, message.fromName);
        break;
      case 'trade-result':
        this.events.onTradeResult({
          withId: message.with,
          accepted: message.accepted,
          offer: message.offer,
          iSent: message.offer.from === this.id,
        });
        break;
      case 'error':
        this.events.onSystem(message.reason);
        this.disconnect();
        break;
    }
  }

  /** Tell the server where we are, a few times a second. */
  update(dt: number, me: { x: number; z: number; yaw: number; walk: number; place: string; riding: Presence['riding']; gear: string[] }): void {
    if (!this.connected) return;
    this.sinceMove += dt;
    if (this.sinceMove < MOVE_INTERVAL) return;
    this.sinceMove = 0;
    this.send({ type: 'move', ...me });
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
   * The hero has been put somewhere rather than having walked there: a teleport, a staircase, a
   * door, a gangplank, a saddle. The world moves its own copy of him and answers with where.
   */
  stood(x: number, z: number, why: 'teleport' | 'place' | 'ride'): void {
    if (this.connected) this.send({ type: 'stood', x, z, why });
  }

  /** Tell everyone about something we changed in the world. */
  report(delta: WorldDelta): void {
    if (this.connected) this.send({ type: 'delta', delta });
  }

  /** As the owner of a floor, say where its monsters are. */
  monsters(place: string, snap: MonsterSnap[], gone: number[]): void {
    if (this.connected) this.send({ type: 'monsters', place, snap, gone });
  }

  /** As a guest on a floor, report a blow for its owner to resolve. */
  hit(place: string, index: number, damage: number): void {
    if (this.connected) this.send({ type: 'hit', place, index, damage });
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

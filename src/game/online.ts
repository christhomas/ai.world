import {
  PROTOCOL_VERSION, cleanChat, cleanName,
  type ClientMessage, type Clock, type MonsterSnap, type Presence, type ServerMessage,
  type Stall, type StallItem, type TradeOffer, type WorldDelta,
} from '../../server/protocol';
import type { GameState } from './state';
import { ITEMS } from './items';

export type { Clock, MonsterSnap, Presence, Stall, StallItem, TradeOffer, WorldDelta };

/** How often we tell the server where we are. */
const MOVE_INTERVAL = 0.12;

export interface OnlineEvents {
  onChat: (line: string) => void;
  onSystem: (line: string) => void;
  /** The world's own time, which everyone in it shares. */
  onClock: (clock: Clock) => void;
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
  private socket: WebSocket | null = null;
  private sinceMove = 0;
  private url = '';
  /** Other people in this world, by id. */
  readonly players = new Map<string, Presence>();
  id = '';
  name = 'Traveller';
  status: 'offline' | 'connecting' | 'online' = 'offline';

  constructor(private readonly events: OnlineEvents) {}

  get connected(): boolean { return this.status === 'online'; }
  get count(): number { return this.players.size; }

  /** Join the world of this seed on the server given. */
  connect(url: string, seed: number, name: string, clock: Clock): void {
    this.disconnect();
    this.url = url;
    this.name = cleanName(name);
    this.status = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.status = 'offline';
      this.events.onSystem(`Could not reach ${url}.`);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.send({ type: 'join', seed, name: this.name, version: PROTOCOL_VERSION, day: clock.day, time: clock.time });
    };
    socket.onmessage = (event) => this.receive(String(event.data));
    socket.onclose = () => {
      if (this.status !== 'offline') this.events.onSystem('Disconnected from the server.');
      this.status = 'offline';
      this.players.clear();
      this.socket = null;
    };
    socket.onerror = () => {
      this.events.onSystem(`Could not reach ${this.url}.`);
    };
  }

  disconnect(): void {
    if (!this.socket) return;
    this.status = 'offline';
    this.socket.close();
    this.socket = null;
    this.players.clear();
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
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
        this.events.onSystem(`Joined world ${message.seed} as ${this.name}. ${message.players.length} other traveller${message.players.length === 1 ? '' : 's'} here, ${message.deltas.length} thing${message.deltas.length === 1 ? '' : 's'} already changed.`);
        break;
      case 'clock':
        this.events.onClock(message.clock);
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

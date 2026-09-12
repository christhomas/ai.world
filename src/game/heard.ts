import { EMOTES, type Clock, type CreatureSnap, type Letter, type PartyMember, type Presence,
  type ServerMessage, type Stall, type StallItem, type TradeOffer, type WorldDelta } from '../../server/protocol';

/**
 * What the world says, and what this half does about each of it.
 *
 * The mirror of `server/messages.ts`, and here for the same reason that one exists: a switch over
 * every kind of message is the whole of what one side means by the other's vocabulary, and it is a
 * different job from carrying the words. `online.ts` is the link and the things a player can say
 * down it; this is what comes back.
 *
 * Nothing here decides anything. It takes a message apart, keeps the two pieces of state that are
 * about the wire rather than about the game — who is in this world, and who we are in it — and
 * hands the rest to whoever is listening. A message with nobody listening is a message that arrives
 * and does nothing, which is what `server/wire.test.ts` reads this file to count.
 */

export interface OnlineEvents {
  /**
   * Bytes rather than words: the world itself, when the world starts sending it.
   *
   * Nothing sends one yet. It is here so that the day a chunk of country comes down the wire, it
   * arrives somewhere rather than being dropped by a receiver that only knows how to read.
   */
  onParcel?: (bytes: ArrayBuffer) => void;
  /**
   * A world has answered and is standing this country up, so the page can stop guessing at it.
   *
   * On the welcome rather than on the socket opening, because an open socket says a machine
   * answered and this says a world did.
   */
  onCountryComing: () => void;
  /**
   * The country is grown, and this is the world's own fingerprint of it: stop waiting, and check.
   *
   * The ground travels down the wire so it cannot be wrong; the villages, the doors and the eyries
   * are still worked out on each side from its own copy of the country, and this is the one moment
   * the two answers can be compared for the price of eight characters.
   */
  onCountryGrown: (stamp: string) => void;
  onChat: (line: string) => void;
  onSystem: (line: string) => void;
  /** The world's own time, which everyone in it shares. */
  onClock: (clock: Clock) => void;
  /** A command from whoever operates this world, to run on our own bus. */
  onCommand: (line: string, issuer: string) => void;
  /** The creatures the world says are near us, and the ones that have gone from sight. */
  onCreatures: (place: string, near: CreatureSnap[], gone: number[]) => void;
  /** One of the world's creatures died. `mine` is true when it was our blow that did it. */
  onCreatureKilled: (place: string, id: number, mine: boolean) => void;
  /** One of the world's creatures bit us, and how hard. What it costs is our own business. */
  onBitten: (place: string, id: number, damage: number) => void;
  /**
   * A constable in one of the world's villages has taken us in.
   *
   * The same division as a bite: the world's villagers decided that it happened, and the hours, the
   * fine and the cell are worked out here because all three live in a save the world has never held.
   */
  onArrested: (id: number) => void;
  /** We are no longer being told what lives here, so the game decides for itself again. */
  onWorldSilent: () => void;
  /** The world has walked our own hero, and this is where it says he is standing. */
  onWhereYouAre: (seq: number, x: number, z: number, y: number) => void;
  /** What was in the chest this page has already opened, and whether it was this hero's to open. */
  onChestOpened: (seq: number, told: { ok: boolean; gold: number; key: boolean; prize: string | null }) => void;
  /** Something another player changed about the world, or the backlog of it on joining. */
  onDelta: (delta: WorldDelta, catchingUp: boolean) => void;
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
 * The little of the connection that reading a message has to touch.
 *
 * Two of these are state rather than events, and they are here rather than out in the game because
 * they are facts about the wire: who else is in this world, and who the world says we are. The rest
 * is a door out — a name for each thing that happened, so that what it *means* is decided by the
 * game and not by the thing holding the socket.
 */
export interface Listening {
  events: OnlineEvents;
  /** Other people in this world, by id, kept right before anybody is told about them. */
  players: Map<string, Presence>;
  /** Our own id, once the world has said what it is. Empty before that. */
  readonly id: string;
  readonly name: string;
  /** A world in the next thread rather than one across a network, which says less out loud. */
  readonly local: boolean;
  /** The world has said who we are and that we are in. */
  admitted: (id: string) => void;
  /** Everyone this world has ever met, for addressing a parcel to somebody who is away. */
  metThem: (names: string[]) => void;
  /** The world has turned us away, or thrown us out. */
  leave: () => void;
}

/** One thing the world said, taken apart and handed on. */
export function heard(o: Listening, message: ServerMessage): void {
  switch (message.type) {
    case 'welcome':
      o.admitted(message.id);
      // a world, not just a machine, and it is standing this country up: see `aWorldIsGrowingIt`
      o.events.onCountryComing();
      for (const p of message.players) o.players.set(p.id, p);
      o.events.onClock(message.clock);
      // catch up on everything that happened here before we arrived
      for (const delta of message.deltas) o.events.onDelta(delta, true);
      if (!o.local) {
        o.events.onSystem(`Joined world ${message.seed} as ${o.name}. ${message.players.length} other traveller${message.players.length === 1 ? '' : 's'} here, ${message.deltas.length} thing${message.deltas.length === 1 ? '' : 's'} already changed.`);
      }
      break;
    case 'country':
      o.events.onCountryGrown(message.stamp);
      break;
    case 'youAre':
      o.events.onWhereYouAre(message.seq, message.x, message.z, message.y);
      break;
    case 'clock':
      o.events.onClock(message.clock);
      break;
    case 'opened':
      o.events.onChestOpened(message.seq, {
        ok: message.ok, gold: message.gold, key: message.key, prize: message.prize,
      });
      break;
    case 'creatures':
      o.events.onCreatures(message.place, message.near, message.gone);
      break;
    case 'killed':
      o.events.onCreatureKilled(message.place, message.id, message.by === o.id);
      break;
    case 'arrested':
      o.events.onArrested(message.id);
      break;
    case 'bitten':
      o.events.onBitten(message.place, message.id, message.damage);
      break;
    case 'command':
      // whoever operates this world has sent something to do. What it does is the client's own
      // business: the vocabulary is shared, the handlers are not.
      o.events.onCommand(message.line, message.issuer);
      break;
    case 'delta':
      o.events.onDelta(message.delta, false);
      break;
    case 'joined':
      o.players.set(message.player.id, message.player);
      o.events.onSystem(`${message.player.name} has arrived.`);
      break;
    case 'left': {
      const gone = o.players.get(message.id);
      o.players.delete(message.id);
      if (gone) o.events.onSystem(`${gone.name} has gone.`);
      break;
    }
    case 'presence': {
      const seen = new Set<string>();
      for (const p of message.players) { o.players.set(p.id, p); seen.add(p.id); }
      for (const id of [...o.players.keys()]) if (!seen.has(id)) o.players.delete(id);
      break;
    }
    case 'stalls':
      o.events.onStalls(message.stalls);
      break;
    case 'stall-bought':
      o.events.onBought(message.stall, message.item, message.cost);
      break;
    case 'stall-takings':
      o.events.onTakings(message.stall, message.gold);
      break;
    case 'stall-refused':
      o.events.onStallRefused(message.stall, message.reason);
      break;
    case 'folk':
      o.metThem(message.names);
      o.events.onFolk(message.names);
      break;
    case 'mail':
      o.events.onMail(message.letters);
      break;
    case 'mail-here':
      o.events.onMailWord(`${message.from} left something for you at the inn.`, 'waiting');
      break;
    case 'mail-sent':
      o.events.onMailWord(`Your parcel waits at the inn for ${message.to}.`, 'sent');
      break;
    case 'mail-refused':
      o.events.onMailWord(message.reason, 'refused');
      break;
    case 'party':
      o.events.onParty(message.members);
      break;
    case 'party-invited':
      o.events.onPartyWord(`${message.fromName} asks you to travel together.`, { from: message.from, name: message.fromName });
      break;
    case 'party-declined':
      o.events.onPartyWord(`${message.name} would rather travel alone.`, null);
      break;
    case 'party-deed':
      o.events.onPartyDeed(message.quest, message.from);
      break;
    case 'duel-challenged':
      o.events.onDuelWord(`${message.fromName} challenges you to a friendly bout.`, { from: message.from, name: message.fromName });
      break;
    case 'duel-begun':
      o.events.onDuelBegun(message.withId, message.withName);
      break;
    case 'duel-struck':
      o.events.onDuelStruck(message.damage);
      break;
    case 'warband-challenged':
      o.events.onWarbandWord(
        `${message.fromName} would fight you, with ${message.swords} sword${message.swords === 1 ? '' : 's'} behind him.`,
        { from: message.from, name: message.fromName, swords: message.swords },
      );
      break;
    case 'warband-begun':
      o.events.onWarbandBegun(message.withId, message.withName, message.swords);
      break;
    case 'warband-struck':
      o.events.onWarbandStruck(message.damage, message.sword);
      break;
    case 'warband-muster':
      o.events.onWarbandMuster(message.swords);
      break;
    case 'warband-over':
      o.events.onWarbandOver(message.winner, message.name);
      break;
    case 'duel-over':
      o.events.onDuelOver(message.winner, message.name);
      break;
    case 'emoted':
      o.events.onEmote(message.id, message.name, EMOTES[message.kind] ?? '❔', message.kind);
      break;
    case 'pinged':
      o.events.onPing(message.x, message.z, message.name);
      break;
    case 'said':
      o.events.onChat(`${message.name}: ${message.text}`);
      break;
    case 'trade-offered':
      o.events.onOffer(message.offer, message.fromName);
      break;
    case 'trade-result':
      o.events.onTradeResult({
        withId: message.with,
        accepted: message.accepted,
        offer: message.offer,
        iSent: message.offer.from === o.id,
      });
      break;
    case 'error':
      o.events.onSystem(message.reason);
      o.leave();
      break;
  }
}

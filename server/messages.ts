import {
  EMOTES, LIMITS, PARTY_LIMIT, clamp, cleanChat, cleanDelta, cleanLetter, cleanStallItem, cleanSwing, cleanSwords,
  type ClientMessage, type TradeOffer,
} from './protocol';
import { ROPED_CLIMB, newHero, settleOnto, stride } from '../src/entities/stride';
import type { Client, Party, Room, Rooms } from './rooms';
import type { SharedWorld } from './world';

/**
 * What each message from a player means. One function per subject, so adding a message is a
 * matter of finding the subject it belongs to rather than reading a switch four hundred lines
 * long. Nothing here knows about sockets: `rooms` decides who hears what.
 *
 * The rule the whole server rests on: gold, goods and hearts live in each player's own save. The
 * server says what should happen to them, and never holds them itself.
 */
export function handle(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  switch (message.type) {
    case 'move': case 'say': case 'emote': case 'ping':
      whereAndWhat(rooms, me, room, message);
      return;
    case 'steer':
      walked(rooms, me, message);
      return;
    case 'swing':
      thrown(rooms, me, message);
      return;
    case 'stood':
      putThere(rooms, me, message);
      return;
    case 'delta': case 'monsters': case 'hit':
      worldChange(rooms, me, room, message);
      return;
    case 'stall-rent': case 'stall-stock': case 'stall-buy': case 'stall-collect': case 'stall-close':
      market(rooms, me, room, message);
      return;
    case 'mail-send': case 'mail-fetch':
      post(rooms, me, room, message);
      return;
    case 'party-invite': case 'party-answer': case 'party-leave': case 'party-deed':
      fellowship(rooms, me, room, message);
      return;
    case 'duel-challenge': case 'duel-answer': case 'duel-hit': case 'duel-yield':
      bout(rooms, me, room, message);
      return;
    case 'warband-challenge': case 'warband-answer': case 'warband-hit':
    case 'warband-muster': case 'warband-yield':
      field(rooms, me, room, message);
      return;
    case 'trade-offer': case 'trade-accept': case 'trade-decline':
      trade(rooms, me, room, message);
      return;
    default:
      return;   // 'join' is answered by the handshake, before any of this
  }
}

/**
 * The hero has been put somewhere: move the world's own copy of him to match, and say so.
 *
 * Answered rather than silent, and answered with the sequence number the world has already run, so
 * the client throws away everything it had in flight and stands where it is told. Without that the
 * steers still on the wire when somebody teleports are walked on top of the new position, and the
 * hero arrives having taken three paces in whatever direction he left in.
 */
function putThere(rooms: Rooms, me: Client, message: Extract<ClientMessage, { type: 'stood' }>): void {
  const p = me.presence;
  const x = Number(message.x) || 0;
  const z = Number(message.z) || 0;
  p.x = x; p.z = z;
  const hero = me.hero;
  if (!hero) return;
  hero.x = x; hero.z = z;
  const under = rooms.groundOf(me.seed)?.heightAt(x, z);
  if (under !== null && under !== undefined) hero.y = under;
  rooms.send(me, { type: 'youAre', seq: me.steered, x, z, y: hero.y, yaw: p.yaw });
}

/**
 * A blow, and what it reached.
 *
 * The hero it is thrown from is the one the world has been walking — not a position the client
 * sent with the blow — which is what makes this worth doing at all: a swing lands where the world
 * says the hero is standing, so two people watching the same fight are watching the same fight.
 */
function thrown(rooms: Rooms, me: Client, message: Extract<ClientMessage, { type: 'swing' }>): void {
  const world = rooms.worldOf(me.seed);
  const hero = me.hero;
  // no ground, no hero, no creatures: a world where the client is still its own authority
  if (!world || !hero) return;
  const killed = world.swung({
    x: hero.x, z: hero.z, y: hero.y, yaw: hero.yaw,
    reach: Number(message.reach) || 0,
    arc: Number(message.arc) || 0,
    damage: Number(message.damage) || 1,
    one: message.one === true,
  });
  // everybody sees the body fall; only whoever landed the blow takes anything off it
  for (const id of killed) rooms.broadcast(me.seed, { type: 'killed', id, by: me.presence.id });
}

/**
 * How far somebody got, which the world works out for itself.
 *
 * The client says which way it pushed and for how long; the ground here says how far that gets
 * anybody, and what comes back is where the hero is now. This is phase four of
 * `docs/server-authority.md` — the point of it is not to catch cheats, it is that two people in
 * one village are now looking at the same hero in the same place because one machine decided
 * where he is.
 *
 * A world with no ground under it — the simulation grows one only when it is asked to — leaves the
 * client its own authority, and the game plays exactly as it did.
 */
function walked(rooms: Rooms, me: Client, message: Extract<ClientMessage, { type: 'steer' }>): void {
  const ground = rooms.groundOf(me.seed);
  if (!ground) return;
  const seq = Math.floor(Number(message.seq) || 0);
  // an old steer arriving after a newer one has already been run: running it now would walk the
  // hero backwards, and the client has long since drawn past it
  if (seq <= me.steered) return;
  const p = me.presence;
  const hero = me.hero ?? (me.hero = newHero(p.x, p.z, ROPED_CLIMB));
  // The ground grows around where somebody is standing, a tick behind them, so for a moment after
  // a teleport there is nothing under the hero to walk on. Answering then would be answering with
  // wherever he was before the jump, and the client would be dragged back to it. So say nothing:
  // the client stays its own authority until the world under him exists, which is a tick.
  const under = ground.heightAt(hero.x, hero.z);
  if (under === null) return;
  hero.y = under;
  me.steered = seq;
  stride(ground, hero, {
    dx: Number(message.dx) || 0,
    dz: Number(message.dz) || 0,
    pace: Number(message.pace) || 0,
    dt: (Number(message.ms) || 0) / 1000,
  });
  settleOnto(ground, hero);
  p.x = hero.x; p.z = hero.z; p.yaw = hero.yaw;
  rooms.send(me, { type: 'youAre', seq, x: hero.x, z: hero.z, y: hero.y, yaw: hero.yaw });
}

/** Where somebody is, what they said, and the two wordless things they can do. */
function whereAndWhat(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  switch (message.type) {
    case 'move': {
      const p = me.presence;
      // A hero the server is walking is not moved by what a client says about him — that is the
      // whole of owning him. But a hero can still be *put* somewhere by things the server has no
      // idea about: a teleport, a staircase, a ferry, a boat, the first placing when somebody
      // joins. Those all move him further in one message than any walk could, so a long jump is
      // taken as a warp and a short one is ignored, and the client goes on owning everywhere the
      // server does not: indoors, underground, and at sea.
      // The server owns him only where it walks him: out of doors, on his own feet, on ground it
      // has grown. There, a move says nothing about where he is standing — that is what owning him
      // means. Everywhere else the client is the authority and this is how it says so, and a jump
      // from one to the other arrives as `stood` rather than being guessed at from a distance.
      const walked = me.hero;
      const ground = rooms.groundOf(me.seed);
      const outside = String(message.place) === 'surface' && message.riding === 'foot';
      const standing = walked !== null && ground !== null && ground.heightAt(walked.x, walked.z) !== null;
      const theirs = !outside || !standing;
      if (theirs && walked) { walked.x = message.x; walked.z = message.z; }
      if (theirs) { p.x = message.x; p.z = message.z; }
      p.yaw = message.yaw; p.walk = message.walk;
      p.place = String(message.place).slice(0, LIMITS.PLACE);
      p.riding = message.riding;
      p.gear = message.gear.slice(0, LIMITS.GEAR).map((id) => String(id).slice(0, LIMITS.ITEM_ID));
      return;
    }
    case 'say': {
      const text = cleanChat(message.text);
      if (!text) return;
      // Everybody, the speaker included, so chat reads the same for everybody in the world. It was
      // broadcast and then sent again to the speaker, which is what a broadcast already does when
      // nobody is excepted from it — so they saw their own line twice.
      rooms.broadcast(me.seed, { type: 'said', id: me.presence.id, name: me.presence.name, text });
      return;
    }
    case 'emote': {
      const kind = String(message.kind).slice(0, LIMITS.EMOTE);
      if (!EMOTES[kind]) return;
      rooms.broadcast(me.seed, { type: 'emoted', id: me.presence.id, name: me.presence.name, kind });
      return;
    }
    case 'ping': {
      const x = Number(message.x), z = Number(message.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      // a rally point is for your companions, or for the whole world when you travel alone
      const audience = me.party ?? room.clients;
      for (const other of audience) if (other !== me) rooms.send(other, { type: 'pinged', x, z, name: me.presence.name });
      return;
    }
  }
}

/**
 * The two ways the world itself changes hands: the short log of what players have altered, and
 * the monsters on a shared dungeon floor, which one client runs for everybody standing on it.
 */
function worldChange(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  if (message.type === 'delta') {
    const delta = cleanDelta(message.delta);
    if (!delta || !room.world.apply(delta)) return;
    rooms.broadcast(me.seed, { type: 'delta', delta, from: me.presence.id }, me);
    return;
  }
  if (message.type !== 'monsters' && message.type !== 'hit') return;

  // a pure relay, and only to the floor it concerns: the clients agree among themselves who owns it
  const place = String(message.place).slice(0, LIMITS.PLACE);
  for (const other of room.clients) {
    if (other === me || other.presence.place !== place) continue;
    rooms.send(other, message.type === 'monsters'
      ? { type: 'monsters', place, snap: message.snap.slice(0, LIMITS.MONSTERS), gone: message.gone.slice(0, LIMITS.MONSTERS), from: me.presence.id }
      : { type: 'hit', place, index: Math.floor(message.index), damage: Math.max(0, Math.floor(message.damage)), from: me.presence.id });
  }
}

/** Market pitches: rented, stocked, bought from, collected, given up. */
function market(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  const id = String((message as { stall: string }).stall).slice(0, LIMITS.THING_ID);
  const request = stallRequest(message, id);
  if (!request) { rooms.send(me, { type: 'stall-refused', stall: id, reason: 'There is nothing to put out.' }); return; }

  const reply = room.world.stall(me.presence.name, request);
  if (!reply.ok) { rooms.send(me, { type: 'stall-refused', stall: id, reason: reply.reason }); return; }
  if (reply.kind === 'bought') rooms.send(me, { type: 'stall-bought', stall: id, item: reply.item, cost: reply.cost });
  if (reply.kind === 'collected') rooms.send(me, { type: 'stall-takings', stall: id, gold: reply.gold });
  // one description of the market goes to everyone, rather than a message per change, and the
  // trader is told last so their own answer above arrives before the market it changed
  rooms.broadcast(me.seed, { type: 'stalls', stalls: room.world.stalls }, me);
  rooms.send(me, { type: 'stalls', stalls: room.world.stalls });
}

/** Turn a stall message into the request the world understands, dropping anything misshapen. */
function stallRequest(message: ClientMessage, id: string): Parameters<SharedWorld['stall']>[1] | null {
  switch (message.type) {
    case 'stall-rent': return { do: 'rent', id, village: String(message.village).slice(0, LIMITS.VILLAGE) };
    case 'stall-stock': {
      const item = cleanStallItem(message.item);
      return item ? { do: 'stock', id, item } : null;
    }
    case 'stall-buy': return { do: 'buy', id, index: Math.max(0, Math.floor(message.index)) };
    case 'stall-collect': return { do: 'collect', id };
    case 'stall-close': return { do: 'close', id };
    default: return null;
  }
}

/** The inn shelf: parcels left for a name, and parcels taken away by one. */
function post(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  if (message.type === 'mail-fetch') {
    rooms.send(me, { type: 'mail', letters: room.world.collect(me.presence.name) });
    return;
  }
  if (message.type !== 'mail-send') return;

  const letter = cleanLetter({
    from: me.presence.name, to: message.to, gold: message.gold,
    items: message.items, day: room.world.clock.day,
  });
  const refuse = (reason: string) => rooms.send(me, { type: 'mail-refused', reason });
  if (!letter) return refuse('There is nothing in that parcel.');
  if (letter.to === me.presence.name) return refuse('Post it to somebody else.');
  if (!room.world.folk.includes(letter.to)) return refuse(`Nobody here has heard of ${letter.to}.`);

  room.world.post(letter);
  const recipient = rooms.byName(room, letter.to);
  if (recipient) rooms.send(recipient, { type: 'mail-here', from: letter.from });
  rooms.send(me, { type: 'mail-sent', to: letter.to });
}

/** Travelling together: the asking, the answer, the parting, and the errands that count for all. */
function fellowship(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  switch (message.type) {
    case 'party-invite': {
      const target = rooms.byId(room, message.to);
      if (!target || target === me) return;
      if ((me.party?.size ?? 1) >= PARTY_LIMIT) { rooms.send(me, { type: 'error', reason: 'Your party is full.' }); return; }
      me.invited.add(target.presence.id);
      rooms.send(target, { type: 'party-invited', from: me.presence.id, fromName: me.presence.name });
      return;
    }
    case 'party-answer': {
      // only an answer to an asking that was actually made counts
      const host = rooms.byId(room, message.from);
      if (!host || !host.invited.delete(me.presence.id)) return;
      if (!message.yes) { rooms.send(host, { type: 'party-declined', name: me.presence.name }); return; }

      rooms.leaveParty(me);
      const party: Party = host.party ?? new Set([host]);
      if (party.size >= PARTY_LIMIT) { rooms.send(me, { type: 'error', reason: 'That party is full.' }); return; }
      host.party = party;
      party.add(me);
      me.party = party;
      rooms.tellParty(party);
      return;
    }
    case 'party-leave': {
      rooms.leaveParty(me);
      rooms.send(me, { type: 'party', members: [] });
      return;
    }
    case 'party-deed': {
      const quest = String(message.quest).slice(0, LIMITS.THING_ID);
      for (const mate of me.party ?? []) {
        if (mate !== me) rooms.send(mate, { type: 'party-deed', quest, from: me.presence.name });
      }
      return;
    }
  }
}

/**
 * A friendly bout. The server only introduces the two of them and carries the blows: each client
 * keeps its own duel health, and the one that runs out says so by yielding.
 */
function bout(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  switch (message.type) {
    case 'duel-challenge': {
      const target = rooms.byId(room, message.to);
      if (!target || target === me || me.duel || target.duel) return;
      me.challenged.add(target.presence.id);
      rooms.send(target, { type: 'duel-challenged', from: me.presence.id, fromName: me.presence.name });
      return;
    }
    case 'duel-answer': {
      const challenger = rooms.byId(room, message.from);
      if (!challenger || !challenger.challenged.delete(me.presence.id)) return;
      if (!message.yes) { rooms.send(challenger, { type: 'duel-over', winner: '', name: me.presence.name }); return; }
      if (challenger.duel || me.duel) return;
      challenger.duel = me;
      me.duel = challenger;
      rooms.send(challenger, { type: 'duel-begun', withId: me.presence.id, withName: me.presence.name });
      rooms.send(me, { type: 'duel-begun', withId: challenger.presence.id, withName: challenger.presence.name });
      return;
    }
    case 'duel-hit': {
      if (!me.duel) return;
      rooms.send(me.duel, {
        type: 'duel-struck',
        damage: clamp(Math.floor(message.damage), 0, LIMITS.DAMAGE),
        from: me.presence.id,
      });
      return;
    }
    case 'duel-yield': {
      rooms.endDuel(me, me.duel ? me.duel.presence.id : '', me.presence.name);
      return;
    }
  }
}

/** Handing goods to somebody standing beside you. Both sides are told; each applies its own half. */
function trade(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  if (message.type === 'trade-offer') {
    const target = rooms.byId(room, message.to);
    if (!target) return;
    const offer: TradeOffer = {
      from: me.presence.id,
      to: message.to,
      gold: Math.max(0, Math.floor(message.gold)),
      items: message.items.slice(0, LIMITS.TRADE_ITEMS).map(([id, n]) => [String(id).slice(0, LIMITS.ITEM_ID), Math.max(1, Math.floor(n))] as [string, number]),
    };
    me.offers.set(target.presence.id, offer);
    rooms.send(target, { type: 'trade-offered', offer, fromName: me.presence.name });
    return;
  }
  if (message.type !== 'trade-accept' && message.type !== 'trade-decline') return;

  const other = rooms.byId(room, message.from);
  const offer = other?.offers.get(me.presence.id);
  if (!other || !offer) return;
  other.offers.delete(me.presence.id);
  const accepted = message.type === 'trade-accept';
  rooms.send(other, { type: 'trade-result', with: me.presence.id, accepted, offer });
  rooms.send(me, { type: 'trade-result', with: other.presence.id, accepted, offer });
}

/**
 * A fight with sides. The server does what it does for a bout: introduces the two of them,
 * carries the blows, and holds nobody's hearts. What it adds is a count of men, and the rule that
 * neither side is in one without the other having asked first.
 */
function field(rooms: Rooms, me: Client, room: Room, message: ClientMessage): void {
  switch (message.type) {
    case 'warband-challenge': {
      const target = rooms.byId(room, message.to);
      if (!target || target === me || me.warband || target.warband) return;
      me.swords = cleanSwords(message.swords);
      me.mustered.add(target.presence.id);
      rooms.send(target, {
        type: 'warband-challenged', from: me.presence.id, fromName: me.presence.name, swords: me.swords,
      });
      return;
    }
    case 'warband-answer': {
      const challenger = rooms.byId(room, message.from);
      // the asking has to be outstanding, so a forged answer puts nobody in a fight
      if (!challenger || !challenger.mustered.delete(me.presence.id)) return;
      if (!message.yes) {
        rooms.send(challenger, { type: 'warband-over', winner: '', name: me.presence.name });
        return;
      }
      if (challenger.warband || me.warband) return;
      me.swords = cleanSwords(message.swords);
      challenger.warband = me;
      me.warband = challenger;
      rooms.send(challenger, {
        type: 'warband-begun', withId: me.presence.id, withName: me.presence.name, swords: me.swords,
      });
      rooms.send(me, {
        type: 'warband-begun', withId: challenger.presence.id, withName: challenger.presence.name, swords: challenger.swords,
      });
      return;
    }
    case 'warband-hit': {
      const swing = cleanSwing(message);
      if (!me.warband || !swing) return;
      rooms.send(me.warband, {
        type: 'warband-struck', damage: swing.damage, sword: swing.sword, from: me.presence.id,
      });
      return;
    }
    case 'warband-muster': {
      if (!me.warband) return;
      me.swords = cleanSwords(message.swords);
      rooms.send(me.warband, { type: 'warband-muster', swords: me.swords, from: me.presence.id });
      return;
    }
    case 'warband-yield': {
      rooms.endWarband(me, me.warband ? me.warband.presence.id : '', me.presence.name);
      return;
    }
  }
}

import { inTheWay } from '../src/world/tiles';
import { EntityManager } from '../src/entities/manager';
import { Roster } from '../src/entities/roster';
import { damageEntity, type Entity } from '../src/entities/entity';
import type { DungeonMap } from '../src/dungeon/generate';
import type { TileWorld } from '../src/entities/entity';
import type { ChunkSource } from '../src/world/tiles';
import type { Village } from '../src/world/structures';
import type { Register } from '../src/world/register';
import { ITEMS } from '../src/game/items';
import type { CreatureSnap, VillagerSnap } from './protocol';

/**
 * Everything alive in a world, run by the server: the herds, and the people.
 *
 * This is the same `EntityManager` the game has always used — the same herds, the same trades, the
 * same fights, the same burials — given a list instead of a renderer and the server's own copy of
 * the ground instead of the streamed one. The rules of the world are written once and run wherever
 * the world is being run, which is the whole argument of `docs/server-authority.md`.
 *
 * What it costs is measured rather than assumed: a world's ground is about ninety milliseconds to
 * stand up and a millisecond a chunk, and the creatures near one player are a few hundred entities
 * stepped at whatever rate the simulation ticks. What it buys is that two players standing in the
 * same field are looking at the same deer — and, since the people came across, that two players
 * standing in the same village are talking to the same man in the same mood.
 *
 * It follows one player at a time. The manager spawns and forgets creatures around a single focus,
 * because that is what a game with one hero in it needs; with several players in a world the focus
 * moves between them, so everybody's country is stepped in turn rather than only the first
 * arrival's. Sending what it holds to the right people is the next piece, not this one.
 */
/** How far a player can see a creature, in tiles. Past this, it is somebody else's business. */
export const IN_SIGHT = 60;

export class Wildlife {
  private readonly roster = new Roster();
  private readonly manager: EntityManager;
  private turn = 0;
  /** The number each creature travels under, which is the one thing the wire needs and an Entity lacks. */
  private readonly numbered = new WeakMap<Entity, number>();
  private nextNumber = 1;

  /**
   * Who is retained, and by whom: villagers somebody has paid to walk with them.
   *
   * A hired man leaves the village. He follows one particular player indoors, down staircases this
   * world has never grown and onto boats it does not know about — none of which it could walk him
   * through, and none of which it should have to. So the world takes him off the street and the
   * client that hired him stands one of its own up in his place, which is the arrangement a horse
   * and a boat already have.
   */
  private readonly retained = new Set<string>();
  /** Whoever the creatures were stepped around this tick, for anything that happens to them. */
  private following: Standing | null = null;

  /**
   * The villages are handed over now, and that is what C5 changed.
   *
   * They were withheld on purpose for a long time, and the argument was a good one: who lives in a
   * village is worked out from the seed and the register of who has been killed, so every client
   * already agrees about them without a byte crossing. It stopped being true the day a villager was
   * given a memory. What a man thinks of you follows from what you did, and what you did happened on
   * your screen — so two clients hold two men of the same name in two different moods, and the
   * village you are standing in is whichever machine you are sitting at.
   *
   * A villager owned by the world was said to be one nobody could talk to. That is answered by the
   * wire rather than by keeping him: `VillagerSnap` carries who he is and what he holds, the client
   * looks him up in its own copy of the register, and the conversation happens exactly where it
   * always did.
   */
  constructor(seed: number, private readonly ground: TileWorld, chunks: ChunkSource, private readonly folk: Folk | null = null) {
    this.manager = new EntityManager(
      this.roster, ground, chunks, seed, folk?.villages ?? [],
      folk?.priceOf,
      folk ? (who) => folk.onFallen(who, this.numberOf(who)) : undefined,
      folk?.register ?? null,
      folk?.hasStable,
      // one number for the whole street, asked once a tick: every constable in a village heard the
      // same news about the same person on the same morning, and the person is whoever this step is
      // being taken around
      folk ? () => this.following?.guilt ?? 0 : undefined,
      folk ? (by) => { if (this.following) folk.onArrest(this.numberOf(by), this.following); } : undefined,
      folk?.highland,
    );
  }

  /** Who lives in these villages, when anybody does. */
  get register(): Register | null { return this.folk?.register ?? null; }

  /** And where those villages are, for anything surveying the whole country rather than a corner. */
  get villages(): readonly Village[] { return this.folk?.villages ?? []; }

  /**
   * Somebody has paid a villager to walk with them, or has stopped paying.
   *
   * Taken as it comes, exactly as boarding a boat is: nothing on this side can see a bargain, which
   * lives in a player's own save along with the gold that paid for it. What the world does about it
   * is stop putting him in the street, and take him out of it if he is already standing there.
   */
  retain(person: string, on: boolean): void {
    if (on) this.retained.add(person); else this.retained.delete(person);
    this.manager.spokenFor = this.retained;
  }

  /**
   * Fill a dungeon floor, once, with whatever the map says stands in it.
   *
   * The country above spawns itself as its chunks arrive; a floor has no chunks and never grows any
   * more, so everything that lives down there is put there the moment the floor is stood up. The
   * same map and the same seed the client draws it from, so it is the same monsters in the same
   * rooms rather than an agreement to have similar ones.
   */
  fill(map: DungeonMap, seed: number, floor: number): void {
    this.manager.spawnMonsters(map.monsterSpots, seed + floor, floor);
    if (map.boss) this.manager.spawnOne('troll', map.boss[0] + 0.5, map.boss[1] + 0.5, seed + 99);
  }

  /**
   * What is alive round a point, nearest first: the number each one travels under, what it is, and
   * where. The `entities` command answers out of this, and so does a test that wants to know what
   * it has actually got rather than what it asked for — a herd is put down as a herd, scattered
   * round the spot rather than standing on it.
   */
  listNear(x: number, z: number, r: number): Array<{ id: number; kind: string; x: number; z: number }> {
    return this.manager.within(x, z, r)
      .filter((e) => !e.dead)
      .map((e) => ({ id: this.numberOf(e), kind: e.kind.id, x: e.x, z: e.z }));
  }

  /** How many creatures the server is holding. */
  get count(): number { return this.roster.count; }

  /**
   * Put one creature into the world, at a place, and hand back the number it travels under.
   *
   * The world grows its own creatures and needs no help doing it. This exists so that a test can
   * arrange a meeting — a wolf, a person, and nothing else to think about — rather than walking
   * about at night hoping for one, and so that the operator door can put something somewhere when
   * somebody is looking into a report.
   */
  put(kind: string, x: number, z: number, seed: number): number | null {
    const born = this.manager.spawnOne(kind, x, z, seed, true);
    return born ? this.numberOf(born) : null;
  }

  /** Everything alive, for whoever has to tell the players about it. */
  all(): Iterable<Entity> { return this.roster.all(); }

  /**
   * What one player can see, as the wire carries it.
   *
   * Interest management, and the whole of it at this stage: a player is sent what is near them and
   * nothing else. Two hundred creatures stand round somebody in open country, so sending the world
   * would be sending most of it to everybody several times a second — which is the cost this phase
   * has to answer for, and the answer is that nobody is told about country they cannot see.
   */
  inSightOf(x: number, z: number, reach = IN_SIGHT): CreatureSnap[] {
    const seen: CreatureSnap[] = [];
    const r2 = reach * reach;
    // The manager's watched list rather than the whole roster, and that is C2's third tier arriving
    // here. A world holds creatures out to five chunks around every player and tells each player
    // about what is within sixty tiles of them, so walking the roster once per player meant every
    // player in the world paying for the country round every other player as well as their own. The
    // watched list is what is within `WATCH_RANGE` of *somebody*, sorted once a step; anything past
    // that cannot be in sight of anybody and is now not looked at. `IN_SIGHT` has to stay inside
    // `WATCH_RANGE` for that to be true, and `wildlife.test.ts` holds it there.
    for (const e of this.manager.watched) {
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz > r2) continue;
      // A villager who has gone indoors is not drawn, not spoken to and not hit, so he is not sent:
      // the client would draw a man standing in a wall. He comes back as a new arrival in the
      // morning, which is what the front door means from the outside.
      if (e.indoors) continue;
      const snap: CreatureSnap = {
        id: this.numberOf(e),
        kind: e.kind.id,
        // rounded on the way out: a creature's position is worth a tenth of a tile to look at, and
        // the digits past that are bandwidth spent on nothing anybody can see
        x: round(e.x), z: round(e.z), y: round(e.y),
        yaw: round(e.yaw), walk: round(e.walk),
        state: e.state, hp: e.hp,
      };
      // Who he is, when he is somebody. Attached to every snapshot and taken off again by whoever
      // is talking to a particular player, because only they know what that player has already been
      // told — and a villager's name has not changed since the last time it was sent.
      const who = this.whoIs(e);
      if (who) snap.who = who;
      seen.push(snap);
    }
    return seen;
  }

  /**
   * Somebody hit one of these. Decide what it did.
   *
   * The one place a blow on a wild animal is resolved, however many people are swinging: the client
   * that threw it has already drawn it landing, and what it was worth is worked out here. Nothing
   * is said back — the creature simply turns up hurt, or stops turning up.
   */
  struck(id: number, damage: number): boolean {
    for (const e of this.roster.all()) {
      if (this.numbered.get(e) !== id) continue;
      // the same rules a blow follows anywhere: the ground decides whether it is thrown back
      const killed = damageEntity(e, Math.max(1, Math.min(damage, MOST_A_BLOW)), e.x, e.z, this.ground);
      if (killed) this.manager.killEntity(e);
      return killed;
    }
    return false;
  }

  /**
   * A blow thrown in an arc in front of somebody, and what it did.
   *
   * The client used to decide this: it read its own copy of the creatures, worked out which of them
   * were in front of the hero, and told the world which numbers to hurt. That is a client choosing
   * its own targets, and it is the last thing in a fight that was not the world's to say. Now it
   * says only what it swung with — how hard, how far, how wide — and the arc is measured here,
   * against the hero the world has been walking and the creatures it owns.
   *
   * The sword and a spell take everything in the arc. A shot takes one, the nearest that the arrow
   * would reach, because an arrow stops in the first thing it hits — and that one is measured along
   * the arrow's flight rather than across the ground, so a bird overhead is as far off as it looks.
   *
   * Nothing is checked about who is swinging beyond where the world says they are standing: what a
   * hero can carry and how hard they can hit lives in their own save, which the server has never
   * held. What it will not do is let any of it reach further than a bow does or hurt more than a
   * blow may be worth.
   */
  /** Whoever is standing about here, for anything that has to walk round them. */
  get crowd(): EntityManager { return this.manager; }

  swung(blow: Blow): number[] {
    const fx = Math.cos(blow.yaw), fz = -Math.sin(blow.yaw);
    const far = Math.min(FURTHEST_BLOW, Math.max(0, blow.reach));
    const cone = Math.cos(Math.min(Math.PI, Math.max(0, blow.arc)));
    const hard = Math.max(1, Math.min(blow.damage, MOST_A_BLOW));
    const killed: number[] = [];
    // `within` comes back nearest first, which is the order a shot picks its one creature in
    for (const e of this.manager.within(blow.x, blow.z, far)) {
      if (!e.kind.hp || e.dead) continue;
      const dx = e.x - blow.x, dz = e.z - blow.z;
      const flat = Math.hypot(dx, dz) || 1;
      if ((dx / flat) * fx + (dz / flat) * fz < cone) continue;
      if (blow.one && Math.hypot(flat, e.y - blow.y) > far) continue;
      // and nothing solid between the two of them: the same rule the client draws by, so a shot
      // that visibly stops at a wall is not quietly killing whatever stands behind it
      if (inTheWay(this.ground, blow.x, blow.z, e.x, e.z)) continue;
      if (damageEntity(e, hard, blow.x, blow.z, this.ground)) {
        killed.push(this.numberOf(e));
        this.manager.killEntity(e);
      }
      if (blow.one) break;
    }
    return killed;
  }

  /** The number a creature travels under, given the first time anybody asks about it. */
  private numberOf(e: Entity): number {
    const had = this.numbered.get(e);
    if (had !== undefined) return had;
    const fresh = this.nextNumber++;
    this.numbered.set(e, fresh);
    return fresh;
  }

  /**
   * Step the world's creatures, following the players in it.
   *
   * The focus moves one player per step rather than trying to hold everybody at once. A world with
   * four people in it therefore has each of their neighbourhoods stepped every fourth tick, which
   * is the right trade while the manager is built around a single focus: the alternative is four
   * managers and four sets of the same deer.
   */
  step(dt: number, players: ReadonlyArray<Standing>, time?: number): Bite[] {
    if (players.length === 0) return [];
    // One of them is followed and the rest are told to the manager, which keeps the country round
    // all of them alive. Following them in turn as well spreads the cost of the one thing that is
    // still per-focus — which chunk the sweep starts from — rather than doing it for everybody
    // every tick.
    const who = players[this.turn % players.length];
    this.turn++;
    this.following = who;
    this.manager.alsoNear = players.filter((p) => p !== who);
    // A sword on the hip is what keeps a wolf at arm's length, and the server has never held
    // anybody's pack — but presence carries what they are wearing, which is enough to know whether
    // one of them is a weapon.
    const armed = who.gear.some((id) => (ITEMS[id]?.attack ?? 0) >= 2);
    const bites: Bite[] = [];
    this.manager.update(dt, who.x, who.z, armed, (e, damage) => {
      bites.push({ who, id: this.numberOf(e), damage });
    }, time);
    this.sendTheHiredAway();
    return bites;
  }

  /**
   * Take anybody who has been paid to walk with somebody off the street.
   *
   * Kept out of `retain` and done here because a village puts its own people out again: a day turns
   * over, `reseatVillagers` looks for a face the street is not already showing, and the man who left
   * with a traveller last week is as free as anybody else on the book. So it is a sweep rather than
   * a removal, and it costs nothing at all in the usual case, which is that nobody has hired
   * anybody and the set is empty.
   */
  private sendTheHiredAway(): void {
    if (this.retained.size === 0) return;
    for (const e of [...this.roster.all()]) {
      if (e.person !== '' && this.retained.has(e.person)) this.manager.despawnEntity(e);
    }
  }

  /**
   * Who a creature is, when it is somebody rather than something.
   *
   * Null for everything with no place in a village, which is nearly everything: a deer is a kind and
   * a position and that is the whole of it.
   *
   * The name and the trade are here although a client could derive both — it holds the same register
   * and could look them up by id. They travel because the id alone is not enough for a body: which
   * body a villager wears is decided by his trade *before* the entity exists, and a client that had
   * to wait for a lookup to know that would be drawing the wrong man for a frame. Four short strings
   * beside the memory, which is the part that is genuinely undivable and the reason any of this
   * crosses at all.
   */
  private whoIs(e: Entity): VillagerSnap | null {
    if (e.person === '' && e.role === 'none') return null;
    const person = e.person === '' ? undefined : this.folk?.register.find(e.person);
    return {
      person: e.person,
      name: e.name,
      trade: e.trade,
      role: e.role,
      village: e.herd.tag,
      // what this village was founded on, so a client founding it again founds the same one
      trades: this.folk?.register.tradesOf(e.herd.tag) ?? [],
      // What he holds. Sent whole rather than as what has changed, because it is small by
      // construction — two things and eight opinions, which is exactly the bound `memory.ts` argues
      // for — and because a difference against a copy the far end may not have is a second thing to
      // keep in step for no saving at all.
      mind: { memories: person?.memories ?? [], opinions: person?.opinions ?? [] },
    };
  }
}

/**
 * What a world hands over when the villages in it are its own.
 *
 * All of it comes from somewhere above this file. Which villages there are and what a pelt fetches
 * are the game's business; who lives in them is the register's; how badly the law wants somebody is
 * a fact about a player's own save that has to be told rather than kept. Null for a dungeon floor,
 * where none of it means anything: nothing underground is a village.
 */
export interface Folk {
  villages: Village[];
  register: Register;
  /** Whether a village keeps a stable, which is what makes one of its people a stablehand. */
  hasStable: (village: string) => boolean;
  /** What a thing fetches at market, for a villager selling what he caught. */
  priceOf: (id: string) => number;
  /** Whether this point is high country, which decides what lives on it. */
  highland: (x: number, z: number) => boolean;
  /**
   * Somebody who lives here has been killed.
   *
   * The one thing about a village that cannot be derived, so it is the one thing that has to be told
   * to everybody — and now that the villagers are the world's, this is where it starts.
   */
  onFallen: (who: Entity, id: number) => void;
  /** A constable has laid hands on one of the players: the number he travels under, and who he took. */
  onArrest: (by: number, whom: Standing) => void;
}

/**
 * Who a creature is, when it is somebody rather than something.
 *
 * Null for everything with no name on a register, which is nearly everything: a deer is a kind and a
 * position and that is the whole of it. A villager is a man, and this is the part of him the wire has
 * to carry because it is the part a client cannot work out — his name and his trade it could derive,
 * and they are here anyway because they are four words beside the memory that is the real reason.
 */

/**
 * The most one blow may be worth, whatever a client says it threw.
 *
 * A client says how hard it hit, because the hero's strength is the hero's business and lives in
 * their own save. What it may not do is say a number nothing in the game could produce — so the
 * world caps it, which is the difference between trusting a player and taking their word for the
 * shape of the world.
 */
const MOST_A_BLOW = 40;

/**
 * And the furthest one may reach, in tiles. A bow carries fourteen and nothing in the game carries
 * further, so this is that with a little room rather than a rule of its own.
 */
const FURTHEST_BLOW = 16;

/**
 * Whoever the creatures are being stepped around: as much of a player as any of this needs.
 *
 * `guilt` is the one thing here the world could not have worked out for itself. What a hero has done
 * wrong is kept in his own save — the server has never held a standing, a fine or a sentence — and a
 * village needs exactly one number of it: whether to turn a constable out into the street. So it
 * rides on `move` and arrives here, and a client that never mentions it is a client nobody is after.
 */
export interface Standing {
  x: number;
  z: number;
  /** Item ids worn, which is how a wolf can see whether there is a sword on the hip. */
  gear: string[];
  guilt?: number;
}

/**
 * A creature that got its teeth into somebody.
 *
 * Reported rather than resolved. Hearts live in the player's own save and the server has never
 * held one — so what it says is that a wolf bit you and how hard, and your own game works out what
 * that costs you, whether your guard was up, and which way it knocked you.
 */
export interface Bite {
  who: Standing;
  /** The number the creature travels under, so the client knows which one to flinch from. */
  id: number;
  damage: number;
}

/** A blow thrown at whatever is in front of somebody: where from, how hard, how far and how wide. */
export interface Blow {
  x: number;
  z: number;
  /** The height it is thrown from, which only a shot cares about. */
  y: number;
  yaw: number;
  reach: number;
  /** Half-angle of the arc it covers, in radians. A sword's is wide; a bow is aimed. */
  arc: number;
  damage: number;
  /** True for a shot: one creature, the first the arrow would reach, and height counts. */
  one: boolean;
}

/** A tenth of a tile, which is as much of a creature's position as anybody can see. */
const round = (v: number): number => Math.round(v * 10) / 10;

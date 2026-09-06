import { EntityManager } from '../src/entities/manager';
import { Roster } from '../src/entities/roster';
import { damageEntity, type Entity } from '../src/entities/entity';
import type { DungeonMap } from '../src/dungeon/generate';
import type { TileWorld } from '../src/entities/entity';
import type { ChunkSource } from '../src/world/tiles';
import { ITEMS } from '../src/game/items';
import type { CreatureSnap, Presence } from './protocol';

/**
 * The creatures of a world, run by the server.
 *
 * This is the same `EntityManager` the game has always used — the same herds, the same trades, the
 * same fights, the same burials — given a list instead of a renderer and the server's own copy of
 * the ground instead of the streamed one. The rules of the world are written once and run wherever
 * the world is being run, which is the whole argument of `docs/server-authority.md`.
 *
 * What it costs is measured rather than assumed: a world's ground is about ninety milliseconds to
 * stand up and a millisecond a chunk, and the creatures near one player are a few hundred entities
 * stepped at whatever rate the simulation ticks. What it buys is that two players standing in the
 * same field are looking at the same deer.
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
   * No villages are handed over on purpose.
   *
   * The manager spawns village folk when it is told where the villages are, and this must not: who
   * lives in a village is worked out from the seed and the register of who has been killed, so
   * every client already agrees about them. A villager owned by the server would be a villager
   * nobody could talk to, because a conversation is held by the client.
   */
  constructor(seed: number, private readonly ground: TileWorld, chunks: ChunkSource) {
    this.manager = new EntityManager(this.roster, ground, chunks, seed, []);
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
    for (const e of this.roster.all()) {
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz > r2) continue;
      seen.push({
        id: this.numberOf(e),
        kind: e.kind.id,
        // rounded on the way out: a creature's position is worth a tenth of a tile to look at, and
        // the digits past that are bandwidth spent on nothing anybody can see
        x: round(e.x), z: round(e.z), y: round(e.y),
        yaw: round(e.yaw), walk: round(e.walk),
        state: e.state, hp: e.hp,
      });
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
    this.manager.alsoNear = players.filter((p) => p !== who);
    // A sword on the hip is what keeps a wolf at arm's length, and the server has never held
    // anybody's pack — but presence carries what they are wearing, which is enough to know whether
    // one of them is a weapon.
    const armed = who.gear.some((id) => (ITEMS[id]?.attack ?? 0) >= 2);
    const bites: Bite[] = [];
    this.manager.update(dt, who.x, who.z, armed, (e, damage) => {
      bites.push({ who, id: this.numberOf(e), damage });
    }, time);
    return bites;
  }
}

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

/** Whoever the creatures are being stepped around: as much of a player as any of this needs. */
type Standing = Pick<Presence, 'x' | 'z' | 'gear'>;

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

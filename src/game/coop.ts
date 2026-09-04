import { ownerOfPlace, type MonsterSnap, type Presence } from '../../server/protocol';
import type { Entity } from '../entities/entity';
import type { EntityManager } from '../entities/manager';

/** How often the owner of a floor describes its monsters to everyone else on it. */
const SNAP_INTERVAL = 0.1;
/** How long after striking a monster its death still counts as ours, in seconds. */
const CREDIT_WINDOW = 3;

export interface CoopEvents {
  /** Send a snapshot of this floor's monsters to whoever else is standing on it. */
  sendSnap: (place: string, snap: MonsterSnap[], gone: number[]) => void;
  /** Tell the floor's owner that we hit something. */
  sendHit: (place: string, index: number, damage: number) => void;
}

/**
 * Two people on the same dungeon floor already see the same rooms: both grew them from the same
 * anchor seed. What has to be agreed is the creatures moving about in them, so exactly one player
 * simulates a floor and the others mirror what they are told.
 *
 * The owner is the lowest player id standing on the floor, which every client can work out from
 * the presence it already has. Nobody has to ask, and when the owner leaves the next player simply
 * becomes the owner on the following frame.
 */
export class Coop {
  private sinceSnap = 0;
  /** Roster numbers we have already told people about, so a death can be noticed once. */
  private readonly everSeen = new Set<number>();
  /** Monsters we have struck lately, by roster number, so their fall is credited to us. */
  private readonly struck = new Map<number, number>();
  /** The place string this client is standing in, or null when alone. */
  private place: string | null = null;
  private owner: string | null = null;

  constructor(private readonly events: CoopEvents) {}

  /** True when somebody else is running the monsters and we should not. */
  get mirroring(): boolean { return this.owner !== null && this.owner !== this.myId; }

  /** True when we are the one running them for other people. */
  get hosting(): boolean { return this.owner !== null && this.owner === this.myId && this.sharing; }

  private myId = '';
  private sharing = false;

  /**
   * Work out who owns the floor we are on. Call once a frame with everyone's presence.
   * @returns whether anybody else is on this floor at all
   */
  survey(myId: string, place: string, players: Iterable<Presence>): boolean {
    this.myId = myId;
    this.place = place;
    const here = [myId];
    for (const p of players) if (p.place === place) here.push(p.id);
    this.sharing = here.length > 1;
    this.owner = this.sharing ? ownerOfPlace(here) : null;
    return this.sharing;
  }

  /**
   * As owner, describe the floor's monsters to everyone else on it, now and then. Anything on the
   * roster we no longer hold has been killed here, so its number goes out as a death.
   */
  publish(dt: number, monsters: EntityManager): void {
    if (!this.hosting || !this.place) return;
    this.sinceSnap += dt;
    if (this.sinceSnap < SNAP_INTERVAL) return;
    this.sinceSnap = 0;
    const snap: MonsterSnap[] = [];
    const alive = new Set<number>();
    for (const monster of monsters.roster) {
      if (monster.dead) continue;
      alive.add(monster.rosterIndex);
      snap.push({
        i: monster.rosterIndex, x: round(monster.x), z: round(monster.z),
        yaw: round(monster.yaw), walk: round(monster.walk), hp: monster.hp,
      });
    }
    const gone: number[] = [];
    for (const index of this.everSeen) if (!alive.has(index)) gone.push(index);
    for (const index of alive) this.everSeen.add(index);
    this.events.sendSnap(this.place, snap, gone);
  }

  /**
   * As a mirror, put the monsters where the owner says they are.
   * @returns the ones that died which we had a hand in, so their spoils can be ours
   */
  applySnap(place: string, snap: MonsterSnap[], gone: number[], monsters: EntityManager, remove: (monster: Entity) => void): Entity[] {
    const mine: Entity[] = [];
    if (place !== this.place || !this.mirroring) return mine;
    for (const s of snap) {
      const monster = monsters.onRoster(s.i);
      if (!monster || monster.dead) continue;
      monster.x = s.x;
      monster.z = s.z;
      monster.yaw = s.yaw;
      monster.walk = s.walk;
      if (s.hp < monster.hp) monster.hurt = 0.35;   // flash when the owner says it was struck
      monster.hp = s.hp;
    }
    for (const i of gone) {
      const monster = monsters.onRoster(i);
      if (!monster || monster.dead) continue;
      monster.dead = true;
      if (this.struck.delete(i)) mine.push(monster);
      remove(monster);
    }
    return mine;
  }

  /** Forget blows too old to have felled anything, so a later death is not credited to us. */
  age(dt: number): void {
    for (const [index, since] of this.struck) {
      const older = since + dt;
      if (older > CREDIT_WINDOW) this.struck.delete(index); else this.struck.set(index, older);
    }
  }

  /** A hit we landed as a mirror: the owner decides what it does. */
  reportHit(index: number, damage: number): void {
    if (!this.place) return;
    this.struck.set(index, 0);
    this.events.sendHit(this.place, index, damage);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

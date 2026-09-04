import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import type { EntityManager } from '../entities/manager';
import { Coop } from './coop';
import { ownerOfPlace } from '../../server/protocol';

const presence = (id: string, place: string) =>
  ({ id, name: id, x: 0, z: 0, yaw: 0, walk: 0, gear: [], place, riding: 'foot' as const });

const monster = (i: number) => {
  const herd = new Herd(KINDS.rat, 0, 0, 0, 0, 1);
  const e = new Entity(KINDS.rat, i, 0, herd, 'dungeon', mulberry32(i + 1));
  e.hp = 3;
  e.rosterIndex = i;
  return e;
};

/** A floor's monsters, as much of one as Coop ever asks about. */
const floor = (roster: Entity[]) => ({
  roster,
  onRoster: (i: number) => roster.find((e) => e.rosterIndex === i) ?? null,
}) as unknown as EntityManager;

describe('who runs a shared floor', () => {
  it('is the lowest id standing on it, and nobody when you are alone', () => {
    const sent: string[] = [];
    const coop = new Coop({ sendSnap: (place) => sent.push(place), sendHit: () => {} });

    expect(coop.survey('p2', 'Shrine:1', [presence('p9', 'surface')])).toBe(false);
    expect(coop.mirroring).toBe(false);
    expect(coop.hosting).toBe(false);

    // two on the floor: the lower id hosts
    expect(coop.survey('p2', 'Shrine:1', [presence('p9', 'Shrine:1')])).toBe(true);
    expect(coop.hosting).toBe(true);
    expect(coop.mirroring).toBe(false);

    coop.survey('p9', 'Shrine:1', [presence('p2', 'Shrine:1')]);
    expect(coop.hosting).toBe(false);
    expect(coop.mirroring).toBe(true);

    expect(ownerOfPlace(['p9', 'p2', 'p11'])).toBe('p11');   // string order, as both sides compute it
  });

  it('publishes only as host, and not more often than the interval', () => {
    const snaps: Array<{ live: number; gone: number[] }> = [];
    const snapsOf = (snap: unknown[], gone: number[]) => ({ live: snap.length, gone });
    const coop = new Coop({ sendSnap: (_place, snap, gone) => snaps.push(snapsOf(snap, gone)), sendHit: () => {} });
    const roster = [monster(0), monster(1)];
    coop.survey('p1', 'Shrine:1', [presence('p2', 'Shrine:1')]);   // p1 hosts
    coop.publish(0.05, floor(roster));
    expect(snaps).toHaveLength(0);                                  // too soon
    coop.publish(0.1, floor(roster));
    expect(snaps).toEqual([{ live: 2, gone: [] }]);

    // killed monsters leave the roster entirely, as despawning really does remove them
    roster.pop();
    coop.publish(0.2, floor(roster));
    expect(snaps[1]).toEqual({ live: 1, gone: [1] });
  });

  it('mirrors positions and deaths, and ignores snapshots for another floor', () => {
    const coop = new Coop({ sendSnap: () => {}, sendHit: () => {} });
    coop.survey('p9', 'Shrine:1', [presence('p2', 'Shrine:1')]);   // p9 mirrors
    const roster = [monster(0), monster(1)];
    const removed: number[] = [];
    const remove = (m: Entity) => removed.push(roster.indexOf(m));

    coop.applySnap('Shrine:1', [{ i: 0, x: 5, z: 6, yaw: 1, walk: 0.5, hp: 2 }], [1], floor(roster), remove);
    expect(roster[0].x).toBe(5);
    expect(roster[0].hp).toBe(2);
    expect(roster[0].hurt).toBeGreaterThan(0);      // it flashes when the host says it was struck
    expect(roster[1].dead).toBe(true);
    expect(removed).toEqual([1]);

    coop.applySnap('Elsewhere:1', [{ i: 0, x: 99, z: 99, yaw: 0, walk: 0, hp: 1 }], [], floor(roster), remove);
    expect(roster[0].x).toBe(5);                    // a different floor is none of our business
  });

  it('credits a mirror for the monsters it helped fell, but not for old blows', () => {
    const coop = new Coop({ sendSnap: () => {}, sendHit: () => {} });
    coop.survey('p9', 'Shrine:1', [presence('p2', 'Shrine:1')]);   // p9 mirrors
    const roster = [monster(0), monster(1)];
    const fall = (i: number) => coop.applySnap('Shrine:1', [], [i], floor(roster), () => {});

    coop.reportHit(0, 2);
    expect(fall(0).map((e) => e.rosterIndex)).toEqual([0]);         // we struck it, so it is ours

    coop.reportHit(1, 2);
    coop.age(5);                                                    // a while passes; somebody else finishes it
    expect(fall(1)).toEqual([]);
  });
});

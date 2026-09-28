import { describe, expect, it } from 'vitest';
import { Manifest } from '../world/manifest';
import { Elevations } from '../world/elevation';
import { elevationFor } from '../world/growworld';
import { HIGHLAND_ANIMALS, PRAYED_HIGHLAND_ANIMALS } from '../entities/spawns';
import { GameState } from './state';
import { affectedPlaces, answerHighland, askForHighland, mayPray, prayerSite, PRAYER_WAIT } from './prayers';

const shrine = { name: 'Shrine of Echoes', x: 100, z: 100 };

describe('the shrine supplicant', () => {
  it('names a site and warns about settled places inside the widest reach', () => {
    const site = prayerSite(shrine, 'east');
    expect(site).toMatchObject({ id: 'highland:prayer:Shrine of Echoes:east', x: 196, z: 100 });
    expect(affectedPlaces(site, [
      { name: 'Ashford', x: 230, z: 100 },
      { name: 'Barrow', x: 100, z: 100 },
      { name: 'Faraway', x: 400, z: 100 },
    ])).toEqual(['Ashford', 'Barrow']);
  });

  it('waits two world months, then stores the one rolled shape as a versioned anchor', () => {
    const manifest = new Manifest(3);
    const prayer = askForHighland(shrine, 'north', 10, 0x12345678);
    expect(answerHighland(manifest, prayer, 10 + PRAYER_WAIT - 1)).toBeNull();
    expect(manifest.layers()).toEqual([]);
    const answered = answerHighland(manifest, prayer, 10 + PRAYER_WAIT);
    expect(answered).toMatchObject({ kind: 'highland', seed: 0x12345678, version: 1 });
    expect(answered?.layer?.reach).toBeGreaterThanOrEqual(64);
    expect(answered?.layer?.lift).toBeGreaterThanOrEqual(4);
    const saved = new Manifest(3, manifest.toJSON());
    expect(answerHighland(saved, prayer, 10 + PRAYER_WAIT + 20)).toEqual(answered);
    expect(saved.layers()).toHaveLength(1);
    expect(new Elevations(elevationFor(saved)).liftAt(prayer.x, prayer.z)).toBeGreaterThan(0);
    expect(PRAYED_HIGHLAND_ANIMALS.map((one) => one.kind)).toEqual(expect.arrayContaining(['yeti', 'ogre']));
    expect(HIGHLAND_ANIMALS.some((one) => one.kind === 'ogre')).toBe(false);
  });

  it('refuses repeat sites and requests made during the waiting period', () => {
    const manifest = new Manifest(3);
    const first = askForHighland(shrine, 'north', 10, 1);
    expect(mayPray([], manifest, first.id, 10)).toBeNull();
    expect(mayPray([first], manifest, first.id, 11)).toContain('already');
    expect(mayPray([first], manifest, prayerSite(shrine, 'east').id, 11)).toContain('still hearing');
    answerHighland(manifest, first, 70);
    expect(mayPray([first], manifest, prayerSite(shrine, 'east').id, 69)).toContain('day 70');
    expect(mayPray([first], manifest, prayerSite(shrine, 'east').id, 70)).toBeNull();
  });

  it('keeps the pending roll through a player save and restore', () => {
    const state = GameState.fresh();
    state.prayers.push(askForHighland(shrine, 'west', 2, 0xabcdef01));
    expect(GameState.from(state.toJSON()).prayers).toEqual(state.prayers);
  });
});

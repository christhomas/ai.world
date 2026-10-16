import { describe, expect, it } from 'vitest';
import { GameState } from './state';
import { ITEMS } from './items';
import type { Quest } from './quests';
import type { Poi, Site, Village } from '../world/structures';
import { journalView, type JournalReading } from './journal-view';

const quest = (id: string, kind: Quest['kind'], target: string, village: string, count = 1): Quest =>
  ({ id, village, kind, target, count, reward: 10, intro: [], reminder: '', done: [] });
const village = (name: string, x: number, z: number) => ({ name, x, z }) as unknown as Village;
const poi = (name: string, x: number, z: number) => ({ name, x, z }) as unknown as Poi;
const site = (id: string, name: string, x: number, z: number): Site => ({ id, name, x, z });

function reading(state: GameState, more: Partial<JournalReading> = {}): JournalReading {
  return { state, quests: [], villages: [], pois: [], sites: [], ferries: [], seconds: 0, playerX: 0, playerZ: 0, ...more };
}

/**
 * The journal's rows, which the page's journal and an installed app's journal page both show
 * (#575): what is owed and where, what has been found, and nothing that has not.
 */
describe('the journal, wherever it is read', () => {
  it('lists the errands still owed, says when one is met, and points at the village that asked', () => {
    const state = GameState.fresh();
    const bread = Object.keys(ITEMS)[0];
    const quests = [
      quest('q-visit', 'visit', 'Old Mill', 'Ashford'),
      quest('q-fetch', 'fetch', bread, 'Nowhere', 2),
      quest('q-done', 'visit', 'Far Tower', 'Ashford'),
      quest('q-offered', 'visit', 'Deep Well', 'Ashford'),
    ];
    state.quests.set('q-visit', 'active');
    state.quests.set('q-fetch', 'active');
    state.quests.set('q-done', 'done');
    const view = () => journalView(reading(state, { quests, villages: [village('Ashford', 0, 12)] }));

    expect(view().errands.map((e) => e.id), 'only what was promised and not yet finished').toEqual(['q-visit', 'q-fetch']);
    expect(view().errandsDone).toBe(1);
    expect(view().errands[0]).toEqual({ id: 'q-visit', done: false, what: 'find the Old Mill', village: 'Ashford', tiles: 12, bearing: 'S' });
    expect(view().errands[1]).toMatchObject({ what: `bring 2× ${ITEMS[bread].name}`, tiles: null, bearing: null });
    state.discovered.add('Old Mill');
    expect(view().errands[0].done).toBe(true);
  });

  it('names only what has been found, nearest first, with what sort of place each is', () => {
    const state = GameState.fresh();
    const pois = [poi('Standing Stones', 30, 0), poi('Hidden Grove', 1, 1)];
    const sites = [site('cave-3', 'Bat Hollow', 0, -5), site('castle-1', 'Grey Keep', -50, 0), site('w-9', 'The Mary', 20, 20)];
    for (const name of ['Standing Stones', 'Bat Hollow', 'Grey Keep', 'The Mary']) state.discovered.add(name);
    const view = journalView(reading(state, { pois, sites }));
    expect(view.found.map((p) => `${p.icon} ${p.name} ${p.tiles} ${p.bearing}`)).toEqual([
      '🕳️ Bat Hollow 5 N', '🚢 The Mary 28 SE', '⭐ Standing Stones 30 E', '🏰 Grey Keep 50 W',
    ]);
    expect(view.placesFound).toBe(4);
  });

  it('reads the hero in a line, as the page has always put it', () => {
    const state = GameState.fresh();
    const view = journalView(reading(state));
    expect([view.day, view.hp, view.maxHp, view.gold, view.cellsWalked])
      .toEqual([state.day, state.hp, state.maxHpTotal, state.inventory.gold, state.explored.size]);
    expect(view.errands).toEqual([]);
    expect(view.found).toEqual([]);
    expect(view.ferries).toEqual([]);
  });
});

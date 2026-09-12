import { describe, expect, it } from 'vitest';
import { CARTOGRAPHY, priceOfAMap, saidOfAChart } from './cartography';
import { HIRE } from './hire';
import { BUILD } from './building';
import { BOAT } from './sailing';
import { HORSE } from './mount';
import { ITEMS } from './items';
import { GameState } from './state';
import { PROVINCE } from '../world/provinces';

/**
 * A map that lifted the fog off the whole world for twenty-five gold.
 *
 * Asked for twice, the second time harder: a map should be dear, or small, and a map of the whole
 * country dearer still, because the point of the fog is that walking somewhere is the way to know
 * what is there. A tenth of the price of a boat bought the country entire and, with it, every
 * reason anybody had to go and look at any of it.
 *
 * What is held below is that both figures come out of the game's own numbers rather than out of
 * anybody's taste, and that what they come to sits where it should among everything else on sale.
 */
describe('what a map costs', () => {
  it('charges a week of a mapmaker, in the wage the game already quotes for a day of anybody', () => {
    const aDay = (HIRE.ASKING_LEAST + HIRE.ASKING_MOST) / 2;
    expect(ITEMS.chart.price).toBe(Math.round(CARTOGRAPHY.A_PROVINCE * aDay));
    expect(CARTOGRAPHY.A_PROVINCE).toBe(7);          // a week, which in this world is a season
  });

  it('charges a working life for the whole country, and nobody walks a country in a week', () => {
    expect(ITEMS.map.price).toBe(priceOfAMap(CARTOGRAPHY.A_COUNTRY));
    expect(CARTOGRAPHY.A_COUNTRY).toBeGreaterThan(CARTOGRAPHY.A_PROVINCE);
    // and the whole of it is dearer than the one province, which is the whole of the request
    expect(ITEMS.map.price).toBeGreaterThan(ITEMS.chart.price);
  });

  it('quotes whole gold, because nobody says two hundred and sixty-two and a half', () => {
    for (const days of [1, CARTOGRAPHY.A_PROVINCE, CARTOGRAPHY.A_COUNTRY, 100]) {
      expect(Number.isInteger(priceOfAMap(days)), `${days} days priced in halves`).toBe(true);
    }
  });

  it('puts a province between a boat and a house, and the country beyond anything else on sale', () => {
    // dear enough to be a decision: you buy it instead of a boat, not out of your loose change
    expect(ITEMS.chart.price).toBeGreaterThan(HORSE.PRICE);
    expect(ITEMS.chart.price).toBeGreaterThan(BOAT.PRICE);
    expect(ITEMS.chart.price).toBeLessThan(BUILD.PRICE);
    // and out of casual reach: dearer than a house, and than the dearest thing in any shop
    const shelf = Math.max(...Object.values(ITEMS).filter((i) => i.id !== 'map').map((i) => i.price));
    expect(ITEMS.map.price).toBeGreaterThan(BUILD.PRICE);
    expect(ITEMS.map.price).toBeGreaterThan(shelf);
  });

  it('says in its own description how much country each one is', () => {
    expect(ITEMS.chart.desc).toContain(`${PROVINCE} tiles square`);
    expect(ITEMS.chart.charts).toBe(true);
    // the big one is the whole of it, and is the only one of the two you carry in a pocket
    expect(ITEMS.map.ability).toBe('map');
    expect(ITEMS.map.slot).toBe('trinket');
    expect(ITEMS.chart.slot).toBeUndefined();
  });

  it('names the village in both things a keeper can say about a map', () => {
    expect(saidOfAChart('Ashford', false)).toContain('Ashford');
    expect(saidOfAChart('Ashford', true)).toContain('Ashford');
    expect(saidOfAChart('Ashford', true)).not.toBe(saidOfAChart('Ashford', false));
  });
});

describe('the country somebody has bought', () => {
  it('charts the province a place stands in, and no more of the world than that', () => {
    const s = new GameState();
    expect(s.hasChart(30, 30)).toBe(false);
    expect(s.chart(30, 30)).toBe(true);
    expect(s.hasChart(30, 30)).toBe(true);
    // the far corner of the same province is on the same sheet
    expect(s.hasChart(PROVINCE - 1, PROVINCE - 1)).toBe(true);
    // and the valley over the line is somebody else's map, which is the entire point
    expect(s.hasChart(PROVINCE + 1, 30)).toBe(false);
    expect(s.hasChart(-1, 30)).toBe(false);
    expect(s.charted.size).toBe(1);
  });

  it('will not sell the same country twice', () => {
    const s = new GameState();
    expect(s.chart(0, 0)).toBe(true);
    expect(s.chart(40, 40)).toBe(false);      // same province, so there is nothing to sell
    expect(s.charted.size).toBe(1);
    // a different valley is a different map, and he will happily sell you that one
    expect(s.chart(-PROVINCE, 0)).toBe(true);
    expect(s.charted.size).toBe(2);
  });

  it('is not the same thing as having been there', () => {
    const s = new GameState();
    s.chart(0, 0);
    // reading a map over a counter does not put your boots on ground you have never stood on
    expect(s.explored.size).toBe(0);
  });

  it('survives a save and reload', () => {
    const s = new GameState();
    s.chart(0, 0);
    s.chart(-PROVINCE, -PROVINCE);
    const back = GameState.from(JSON.parse(JSON.stringify(s.toJSON())));
    expect([...back.charted].sort()).toEqual([...s.charted].sort());
    expect(back.hasChart(10, 10)).toBe(true);
  });

  it('leaves somebody who bought the old all-seeing map exactly where they were', () => {
    // a save written before tonight: a map in the pocket, and no charted country at all because
    // there was no such thing to write down. It loads as a hero who has bought no province maps,
    // which is what he is — and the sheet in his pocket still lifts the fog off everything.
    const old = { inventory: { gold: 12, items: {}, equipped: { trinket: 'map' } } };
    const s = GameState.from(old);
    expect(s.charted.size).toBe(0);
    expect(s.worn('trinket')?.id).toBe('map');
    expect(s.can('map')).toBe(true);
  });
});

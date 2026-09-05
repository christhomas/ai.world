import { describe, expect, it } from 'vitest';
import { LOFT, loftFare, loftFlights, type Destination } from './loft';

const here = { x: 0, z: 0 };
const at = (name: string, x: number, z: number): Destination => ({ name, x, z });
const everywhere = (): boolean => true;

/**
 * The loft is the only reason to make the climb twice, and the only fast travel in the game. What
 * has to hold is that it can never take you anywhere you have not been — a bird that flies to
 * villages you have never heard of hands over the map for money — and that it is never worth
 * buying for a journey you could walk.
 */
describe('the loft in the clouds', () => {
  it('will not send a bird anywhere the hero has not stood', () => {
    const places = [at('Oakford', 400, 0), at('Ashmere', -500, 0)];
    const been = (p: Destination): boolean => p.name === 'Oakford';
    expect(loftFlights(here, places, been).map((f) => f.name)).toEqual(['Oakford']);
  });

  it('does not bother with somewhere you can see from the rim', () => {
    const near = LOFT.WORTH_FLYING - 1;
    expect(loftFlights(here, [at('Nextdoor', near, 0)], everywhere)).toEqual([]);
    expect(loftFlights(here, [at('Yonder', LOFT.WORTH_FLYING + 1, 0)], everywhere).length).toBe(1);
  });

  it('offers the far places first, because the near ones are a walk', () => {
    const places = [at('Near', 200, 0), at('Far', 900, 0), at('Middling', 500, 0)];
    expect(loftFlights(here, places, everywhere).map((f) => f.name)).toEqual(['Far', 'Middling', 'Near']);
  });

  it('keeps the list short enough to read', () => {
    const many = Array.from({ length: 30 }, (_, i) => at(`Place ${i}`, 200 + i * 40, 0));
    expect(loftFlights(here, many, everywhere).length).toBe(LOFT.SHOWN);
  });

  it('names a place once, however many landmarks share the name', () => {
    const twice = [at('Oakford', 400, 0), at('Oakford', 402, 3)];
    expect(loftFlights(here, twice, everywhere).length).toBe(1);
  });

  it('asks more for a longer flight, and never asks nothing', () => {
    expect(loftFare(900)).toBeGreaterThan(loftFare(200));
    expect(loftFare(0)).toBe(LOFT.FARE_BASE);
  });

  it('quotes the fare it will actually charge', () => {
    const [flight] = loftFlights(here, [at('Oakford', 600, 0)], everywhere);
    expect(flight.tiles).toBe(600);
    expect(flight.fare).toBe(loftFare(600));
  });
});

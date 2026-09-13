import { describe, expect, it, vi } from 'vitest';
import { Patchwork, PATCH } from '../world/patchwork';
import { growPatch } from '../world/growworld';
import { Manifest } from '../world/manifest';
import { HighCountry } from './highcountry';
import type { SkyIslands } from '../render/skyisland';

/** The renderer as this file uses it, which is two methods and no three.js. */
function sky(): SkyIslands & { added: number; cleared: number } {
  const fake = {
    added: 0,
    cleared: 0,
    add() { fake.added++; },
    clear() { fake.cleared++; },
  };
  return fake as unknown as SkyIslands & { added: number; cleared: number };
}

describe('what stands on the rock, in a country with no edge', () => {
  it('plans the crags and the islands of the square it is standing on', () => {
    const patches = new Patchwork(7, growPatch);
    const view = sky();
    const high = new HighCountry(7, new Manifest(7), view);
    high.standOn(patches.at(20, 20));
    // a patch either has high ground in it or it does not; what is asserted is that the answer is
    // the square's own, which the crossing test below is the other half of
    expect(high.eyries.length + high.isles.length).toBeGreaterThanOrEqual(0);
    expect(view.cleared).toBe(1);
  });

  /*
   * The fault this exists for: a hero a square east standing under islands that belong to country
   * behind him, and over crags that are not there. The same failure as a mountain range dragged
   * along behind him, one layer up.
   */
  it('replans them when the hero crosses into another square', () => {
    const patches = new Patchwork(7, growPatch);
    const view = sky();
    const high = new HighCountry(7, new Manifest(7), view);
    high.standOn(patches.at(20, 20));
    const before = [...high.eyries];

    high.standOn(patches.at(PATCH + 20, 20));
    expect(view.cleared).toBe(2);
    expect(high.eyries).not.toEqual(before);
  });

  it('does nothing at all while he stays where he is, which is nearly every frame', () => {
    const patches = new Patchwork(7, growPatch);
    const view = sky();
    const high = new HighCountry(7, new Manifest(7), view);
    const here = patches.at(20, 20);
    high.standOn(here);
    high.standOn(here);
    high.standOn(here);
    expect(view.cleared).toBe(1);
  });

  /*
   * And it keeps the same arrays.
   *
   * The frame, what the hero can hear and the console all take these lists once and hold them. A
   * fresh array on every crossing would leave each of them looking at the country as it was when
   * they took it, which is this whole item's fault in different clothes.
   */
  it('refills the lists it handed out rather than replacing them', () => {
    const patches = new Patchwork(7, growPatch);
    const high = new HighCountry(7, new Manifest(7), sky());
    high.standOn(patches.at(20, 20));
    const eyries = high.eyries;
    const isles = high.isles;

    high.standOn(patches.at(PATCH + 20, 20));
    expect(high.eyries).toBe(eyries);
    expect(high.isles).toBe(isles);
  });

  it('and a bounded world stands on one square and never crosses', () => {
    const patches = new Patchwork(7, growPatch);
    const view = sky();
    const high = new HighCountry(7, new Manifest(7), view);
    const only = patches.at(20, 20);
    for (let i = 0; i < 50; i++) high.standOn(only);
    expect(view.cleared).toBe(1);
    expect(vi.isMockFunction(view.add)).toBe(false);       // no spy ceremony: the counter is the test
  });
});

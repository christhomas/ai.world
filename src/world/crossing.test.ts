import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The endless country is reached by the thing that walks the hero about.
 *
 * `PatchCountry` holds a *current* sampler — the one for the patch he is standing in — and swaps it
 * when he walks into another. That much is proved in `patchwork.test.ts`, which crosses a boundary
 * and checks the sampler changed.
 *
 * What no test held was the seam, and the item's own description still says it is missing:
 * *"nothing calls `moveTo`, so the sampler never changes and the hero would walk off the edge of
 * the first patch into nothing."* That stopped being true and the sentence stayed, which cost a
 * detour to find out — the third description today whose stated gap had been closed and not
 * revised. A test is the difference between a claim about the wiring and the wiring.
 */
describe('who asks the country to follow the hero', () => {
  const frame = readFileSync('src/game/frame.ts', 'utf8');

  it('moves the country under him as he walks', () => {
    expect(frame, 'the sampler never changes and the first patch is the whole world')
      .toContain('endless.moveTo(player.entity.x, player.entity.z)');
  });

  it('grows what he is walking toward before he arrives', () => {
    // a boundary that is only noticed on arrival is a boundary that stalls: the patch has to be
    // grown while there is still ground under him
    expect(frame).toContain('endless.wants(player.entity.x, player.entity.z)');
  });

  it('rebuilds what belonged to the patch he left, once, when it happens', () => {
    // the mountains in the scene, the crags the eagles sit on and the islands above them were all
    // planned from the patch that is now behind him
    const crossing = frame.slice(frame.indexOf('endless.moveTo('));
    for (const rebuilt of ['mountains.show', 'chunks.standOn', 'skyline.standingBefore', 'high.standOn']) {
      expect(crossing.slice(0, 600), `${rebuilt} still belongs to the patch he walked out of`)
        .toContain(rebuilt);
    }
  });

  it('follows his feet rather than the camera', () => {
    // a camera swung out over the next patch must not swap the ground under him
    expect(frame).not.toContain('endless.moveTo(x, z)');
  });
});

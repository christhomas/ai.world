import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One place the picture is submitted from, which is the thing #249 is actually asking for.
 *
 * The scene graph and the render pipeline were the same object: `SceneRig` handed out a
 * `THREE.WebGLRenderer` and four places across `game/` reached into it and called `.render(scene,
 * camera)` themselves. There was no seam — nowhere a composer could be put, nothing to swap at, and
 * no way to answer "what draws this frame" except by grepping.
 *
 * So the rig draws, and nothing outside the render layer touches a renderer. That is a rule about
 * the *shape* of the codebase rather than about what any function returns, which is why it is
 * asserted the way `architecture.test.ts` asserts its rules — by reading the source. A behavioural
 * test cannot see a fifth caller being written next week, and a fifth caller is exactly the failure.
 *
 * ## What this deliberately does not do
 *
 * `rig.scene` is still handed to the fifteen-odd classes that build into it, and they still hold
 * `THREE` objects. That is the larger half of #249 and it is not here: reseating it means changing
 * every one of those constructors, and doing it in the same change as the submission point would
 * mean nobody could review either. The acceptance line *"no file outside the render layer names a
 * THREE type"* is not met by this and does not claim to be.
 *
 * What is met is the part #250 needs: a composer replaces `draw`, and there is now exactly one of
 * it.
 */

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const path = join(dir, e.name);
  if (e.isDirectory()) return sources(path);
  return e.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
});

/** Everything that is not the render layer's own business. */
const outside = (): string[] => sources('src').filter((f) => !f.startsWith(join('src', 'render')));

describe('where a frame is submitted', () => {
  it('is submitted from the render layer and nowhere else', () => {
    // a renderer's own `render`, not every method anybody called `render` — a dialogue panel
    // redrawing itself is not a frame, and a regex that could not tell them apart would be a rule
    // nobody could keep
    const drawing = outside().filter((f) => /\brenderer\s*\.\s*render\s*\(/.test(readFileSync(f, 'utf8')));
    expect(drawing, 'a frame drawn outside the render layer is a pipeline with no seam in it')
      .toEqual([]);
  });

  it('does not hand the renderer itself out of the render layer', () => {
    const reaching = outside().filter((f) => /\brig\.renderer\b/.test(readFileSync(f, 'utf8')));
    expect(reaching, 'a renderer reached for outside the render layer is a renderer that cannot be swapped')
      .toEqual([]);
  });

  it('does not reach into the lights from outside, but asks the rig', () => {
    const reaching = outside().filter((f) => /\brig\.(sun|hemi|ambient)\b/.test(readFileSync(f, 'utf8')));
    expect(reaching, 'a light held by name outside the render layer is a light a second rig cannot have')
      .toEqual([]);
  });

  it('still lets game code build into the scene, which is the half this does not touch', () => {
    // asserted so that somebody reading the two tests above does not think the seam is finished.
    // `rig.scene` is still passed around; #249's acceptance line is not met and says so
    const building = outside().filter((f) => /\brig\.scene\b/.test(readFileSync(f, 'utf8')));
    expect(building.length, 'if this is nought, the rest of #249 landed and this test should go')
      .toBeGreaterThan(0);
  });
});

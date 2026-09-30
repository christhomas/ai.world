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
 * Surface and country renderers are mounted from their neutral graph by factories in render/.
 * Gameplay assembly never receives the WebGL scene or its materials.
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
    const rig = readFileSync(join('src', 'render', 'scene.ts'), 'utf8')
      .split('export interface SceneRig {')[1]?.split('\n}')[0] ?? '';
    expect(rig, 'the public rig still exposes the WebGL renderer').not.toMatch(/\brenderer\s*:/);
  });

  it('does not hand the WebGL scene out for the debug hooks either', () => {
    // `window.__scene` is for `tools/shots.cjs`, which switches layers off on the live scene. The
    // render layer publishes it; a game file that fetched it from the rig would be holding the
    // WebGL scene, however briefly, and the rig would have a native door in its public face
    const rig = readFileSync(join('src', 'render', 'scene.ts'), 'utf8')
      .split('export interface SceneRig {')[1]?.split('\n}')[0] ?? '';
    expect(rig, 'the public rig still hands out its WebGL scene').not.toMatch(/\bdebugScene\b/);
    expect(outside().filter((f) => /\bdebugScene\b/.test(readFileSync(f, 'utf8')))).toEqual([]);
    // and nothing out here asks for the chip by handing over a renderer: `rig.chip()` answers it
    expect(outside().filter((f) => /\bdescribeGpu\b/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('does not reach into the lights from outside, but asks the rig', () => {
    const reaching = outside().filter((f) => /\brig\.(sun|hemi|ambient)\b/.test(readFileSync(f, 'utf8')));
    expect(reaching, 'a light held by name outside the render layer is a light a second rig cannot have')
      .toEqual([]);
  });

  it('keeps water updates and resource cleanup inside the render layer', () => {
    const reaching = outside().filter((f) => /\brig\.(?:water\s*\.\s*(?:update|dispose)|coast\s*\.\s*dispose)\s*\(/.test(readFileSync(f, 'utf8')));
    expect(reaching, 'game code is managing render resources through their concrete objects').toEqual([]);
  });

  it('keeps the WebGL scene and material handles inside the render layer', () => {
    const building = outside().filter((f) => /\brig\.scene\b/.test(readFileSync(f, 'utf8')));
    const materials = outside().filter((f) => /\brig\.water\.material\b/.test(readFileSync(f, 'utf8')));
    expect(building).toEqual([]);
    expect(materials).toEqual([]);
    const rig = readFileSync(join('src', 'render', 'scene.ts'), 'utf8')
      .split('export interface SceneRig {')[1]?.split('\n}')[0] ?? '';
    expect(rig).not.toMatch(/\b(?:scene|sun|hemi|ambient|water)\s*:\s*THREE\./);
    const nativeImports = outside().filter((f) => /from ['"]three['"]/.test(readFileSync(f, 'utf8')));
    expect(nativeImports).toEqual([]);
  });
});

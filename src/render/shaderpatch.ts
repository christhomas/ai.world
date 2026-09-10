import type * as THREE from 'three';

/**
 * More than one thing editing the same shader.
 *
 * `three` gives a material exactly one `onBeforeCompile` and one `customProgramCacheKey`, so two
 * features that both want to change how something is drawn cannot simply both assign to them: the
 * second one wins, silently, and the first goes on looking as though it is installed. Nothing
 * throws, nothing warns, and the only symptom is a feature that does not happen.
 *
 * That is not hypothetical. The season tint and the cutaway both patch the prop material — the tint
 * from the chunk manager, the cutaway from the prop library's own constructor — and because the
 * chunk manager runs second, the cutaway was compiled out of existence. It took a screenshot of a
 * hero standing behind a cottage, plainly hidden, to find it.
 *
 * So patches are registered rather than assigned. Each is named, each gets the shader in turn, and
 * the cache key is every name joined — which matters as much as the running order does, because
 * `three` caches compiled programs by that key and two materials patched differently must not be
 * mistaken for each other.
 */

interface Patched {
  names: string[];
  edits: Array<(shader: THREE.WebGLProgramParametersWithUniforms) => void>;
}

const patched = new WeakMap<THREE.Material, Patched>();

/**
 * Add one named edit to a material's shader, keeping whatever is already there.
 *
 * Idempotent by name: patching twice with the same name replaces that edit rather than running it
 * twice, so a material that is attached to a second time — which happens when a scene is rebuilt —
 * does not end up with the same injection in it twice over.
 */
export function patchShader(
  material: THREE.Material, name: string,
  edit: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  let all = patched.get(material);
  if (!all) {
    all = { names: [], edits: [] };
    patched.set(material, all);
  }
  const at = all.names.indexOf(name);
  if (at >= 0) all.edits[at] = edit;
  else { all.names.push(name); all.edits.push(edit); }

  material.onBeforeCompile = (shader) => { for (const one of all.edits) one(shader); };
  material.customProgramCacheKey = () => all.names.join('+');
  material.needsUpdate = true;
}

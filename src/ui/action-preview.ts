/**
 * A contextual action is expensive to ask: it walks the whole ordered interaction chain, and some
 * of those answers sample terrain or search entities and structures. Movement and state changes
 * need an answer immediately; while nothing changes, four questions a second are enough to notice
 * a ferry arriving or a person walking into range without doing the same work every drawn frame.
 */
export function createActionPreview(read: () => string | null, maximumAge = .25) {
  let cached: string | null = null;
  let previous: { x: number; z: number; version: number; place: string } | null = null;
  let age = Infinity;

  const at = (dt: number, current: { x: number; z: number; version: number; place: string }): string | null => {
    age += Math.max(0, dt);
    const changed = previous === null
      || current.x !== previous.x || current.z !== previous.z
      || current.version !== previous.version || current.place !== previous.place;
    if (changed || age >= maximumAge) {
      cached = read();
      previous = { ...current };
      age = 0;
    }
    return cached;
  };

  const invalidate = (): void => { previous = null; age = Infinity; };
  return { at, invalidate };
}

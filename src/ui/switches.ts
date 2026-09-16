/**
 * Things somebody can turn on before a world opens, and where the choice is kept.
 *
 * Its own file rather than part of `title.ts`, for the reason `themes.ts` is its own file: what is
 * remembered between visits is a different subject from what is drawn. `title.ts` is a hundred and
 * forty lines of choosing a slot and has no business also being the place a render path is decided.
 *
 * The failure mode is `themes.ts`'s too, and it is the one that matters in the field: a value in
 * storage from a build that offered a switch this one does not is somebody whose game must still
 * open. So anything unrecognised reads as the fallback rather than as an error, and a browser that
 * refuses storage entirely gets the fallback as well instead of a thrown exception on the title
 * screen.
 */

export interface Switch {
  id: string;
  name: string;
  /**
   * What it changes, said to the person deciding rather than to the person who wrote it.
   *
   * The first switch here turns on a second renderer, and *composer* means nothing to anybody
   * choosing. A switch that cannot say plainly what it does is a switch nobody turns on deliberately
   * and everybody reports as a bug when they turn it on by accident.
   */
  note: string;
  /** What it is when nobody has chosen, which for a new path is always off. */
  fallback: boolean;
}

export const SWITCHES: readonly Switch[] = [
  {
    id: 'endless',
    name: 'Endless country',
    /*
     * On by default, which is where #228 left the game and where its saves are. Turning it off
     * grows the road tree instead: an island with a coast, which is the country this game looked
     * best in and the one every picture in the README was taken in. Worth being able to stand in
     * both, because the argument between them is about how a country looks, and that is not an
     * argument anybody wins from a diff.
     *
     * Unlike the switch below it, this one decides something that is written down: the kind goes
     * into the save, because the same seed grows two completely different countries and reopening
     * a world as the other kind would put every anchor in the manifest in open sea. So it is read
     * once, when a *new* world is made, and a world that exists is whatever it says it is.
     */
    note: 'No edge, and no end. Turn it off for an island with a coast. '
      + 'Only decides new worlds — one that exists keeps the country it was made in.',
    fallback: true,
  },
  {
    id: 'composer',
    name: 'New picture',
    note: 'Draws the world a different way. Edges should look the same or slightly cleaner, and '
      + 'nothing else should change — if the picture looks different in any other respect, that is '
      + 'worth reporting. Costs a little more to draw.',
    fallback: false,
  },
];

/** Where one switch is remembered. Named per switch so two of them cannot collide. */
export function keyOf(id: string): string {
  return `ai.world/new/${id}`;
}

/** The switch by that name, or nothing at all for one this build does not offer. */
export function switchOf(id: string): Switch | null {
  return SWITCHES.find((one) => one.id === id) ?? null;
}

/**
 * Whether this switch is on.
 *
 * Wrapped because storage throws rather than returning null in a private window and wherever site
 * data is blocked — and a title screen that will not open is a worse outcome than a preference that
 * does not stick.
 */
export function isOn(id: string): boolean {
  const known = switchOf(id);
  if (!known) return false;
  try {
    const held = globalThis.localStorage?.getItem(keyOf(id));
    return held === null || held === undefined ? known.fallback : held === 'on';
  } catch {
    return known.fallback;
  }
}

/** Remember a choice, or quietly not, where the browser will not have one. */
export function setOn(id: string, on: boolean): void {
  if (!switchOf(id)) return;
  try {
    globalThis.localStorage?.setItem(keyOf(id), on ? 'on' : 'off');
  } catch {
    /* a preference that cannot be stored is not a reason to stop */
  }
}

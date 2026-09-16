/**
 * Turning the camera with two fingers, because the two buttons that did it were in the wrong place.
 *
 * They sat in the left gutter with the pack and the journal — a rail six cells long reaching 326
 * pixels down a screen 390 tall, which is straight through where a steering thumb rests. The
 * handoff gives that gutter to the four book tabs and says why: *"the walk field excludes this
 * column, so a steering thumb can never open the pack."* Two of the six were not books. They were
 * a camera.
 *
 * `design/mobile` has no camera control at all, and this is the reason: on a phone a camera is a
 * gesture. Two fingers on the world and twist, the way a map turns under a thumb and forefinger
 * everywhere else on a phone.
 *
 * ## Why it holds a key rather than stepping the camera
 *
 * The keys are `q` and `e` and they are held rather than struck — the camera turns for as long as
 * one is down, which is what makes a small correction possible. So this holds one too, and lets go
 * when the fingers stop turning. Nothing here knows what a camera is; it converts a pair of
 * fingers into the same two keys a keyboard sends, which keeps one path through the game for both.
 */

/** How far the fingers must turn before this is a twist rather than a pinch or a drag, in radians. */
const A_TWIST = 0.05;

/** And how far they must keep turning to stay one. Below this the hand has stopped and the key goes up. */
const STILL = 0.006;

/** The angle between two points, which is the only thing about them this cares about. */
export function angleBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * How far round the hand has turned since last time, in radians, taken the short way.
 *
 * The short way because `atan2` wraps at π: a hand turning steadily through the bottom of the
 * circle reads as a jump of nearly a full turn the other way, which would flip the camera round at
 * one particular angle and nowhere else.
 */
export function turnedBy(was: number, now: number): number {
  let by = now - was;
  while (by > Math.PI) by -= Math.PI * 2;
  while (by < -Math.PI) by += Math.PI * 2;
  return by;
}

/** Which key a turn of this much is, or nothing at all where the hand has not moved enough. */
export function keyForTurn(by: number, going: boolean): string | null {
  const enough = going ? STILL : A_TWIST;
  if (Math.abs(by) < enough) return null;
  // clockwise on the glass turns the country clockwise under it, which is the way a paper map turns
  return by > 0 ? 'e' : 'q';
}

/** What two fingers on the world are doing, as the camera keys it amounts to. */
export class Twist {
  private readonly down = new Map<number, { x: number; y: number }>();
  private was: number | null = null;
  private holding: string | null = null;

  constructor(private readonly hold: (key: string) => void, private readonly release: (key: string) => void) {}

  /** A finger lands. Only touches count: a mouse has a wheel and a keyboard beside it. */
  began(id: number, x: number, y: number): void {
    this.down.set(id, { x, y });
    this.was = null;
  }

  /** A finger moves, which is where the whole of this happens. */
  moved(id: number, x: number, y: number): void {
    if (!this.down.has(id)) return;
    this.down.set(id, { x, y });
    if (this.down.size !== 2) return this.letGo();
    const [a, b] = [...this.down.values()];
    const now = angleBetween(a, b);
    if (this.was === null) { this.was = now; return; }
    const by = turnedBy(this.was, now);
    const key = keyForTurn(by, this.holding !== null);
    this.was = now;
    if (key === null) return this.letGo();
    if (key === this.holding) return;
    this.letGo();
    this.holding = key;
    this.hold(key);
  }

  /** A finger lifts, or the browser takes the gesture away. */
  ended(id: number): void {
    this.down.delete(id);
    this.was = null;
    if (this.down.size < 2) this.letGo();
  }

  /** Everything up: the world is being put away, or a panel has taken the screen. */
  letGo(): void {
    if (this.holding === null) return;
    this.release(this.holding);
    this.holding = null;
  }

  /** Which key is down, for the test and for anybody debugging a camera that will not stop. */
  get key(): string | null {
    return this.holding;
  }
}

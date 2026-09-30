/** The three numbers a scrolled box is read by. An element is one; so is a test's stand-in. */
export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * A log that stays at its newest line until somebody scrolls away from it.
 *
 * The message log used to decide that only when a line arrived: if it was at the bottom just before,
 * it went to the bottom again after. That missed every other way the box can stop showing its last
 * line. In the right-hand rail the log is the one panel that gives way, so it gets shorter whenever
 * something above or below it gets taller — the card for what is in reach coming up takes 82 units
 * off it — and a shorter box keeps its `scrollTop`, which cuts the newest line off at the bottom. The
 * next line to arrive then found the log "not at the bottom", took it for somebody reading back, and
 * left it there for good.
 *
 * Which of the two a player saw came down to whether the log's lines or its loss of height came
 * first, and that is not a thing the game decides: the same commit photographed twice showed the
 * estate's rumours both ways (#535).
 *
 * So following is a state rather than a guess made from the geometry at the moment a line lands. It
 * is lost only when the reader moves the box *up* — `scrollTop` going down while short of the
 * bottom — and won back by reaching the bottom again. A box that changes size, or whose lines wrap
 * differently, never moves `scrollTop` down on its own while it is following, so it cannot talk
 * the log out of following; the owner calls `settle` when that happens and the newest line is put
 * back where it belongs.
 */
export class Follow {
  private following = true;
  private lastTop = 0;

  constructor(private readonly box: ScrollBox) {}

  /** Whether the log is showing its newest line, as far as anybody has asked it not to. */
  get isFollowing(): boolean { return this.following; }

  /**
   * Within a couple of pixels, because a scroll position is a float and lands a hair short.
   */
  private get atBottom(): boolean {
    return this.box.scrollHeight - this.box.scrollTop - this.box.clientHeight < 4;
  }

  /** Something changed what is in the box, or how big the box is: show the newest line if following. */
  settle(): void {
    if (this.following) this.box.scrollTop = this.box.scrollHeight;
    this.lastTop = this.box.scrollTop;
  }

  /** Go to the newest line and stay there, whatever the reader had done before — opening the console. */
  resume(): void {
    this.following = true;
    this.settle();
  }

  /**
   * The box scrolled, for whatever reason.
   *
   * Only a move up counts as somebody reading back. The browser pulls `scrollTop` down by itself
   * when the box grows or its content shrinks, but it can only do that to a box already at its
   * bottom, and it leaves it there — so that is read as following, which it is.
   */
  scrolled(): void {
    const top = this.box.scrollTop;
    if (this.atBottom) this.following = true;
    else if (top < this.lastTop) this.following = false;
    this.lastTop = top;
  }
}

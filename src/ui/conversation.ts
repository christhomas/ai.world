import { Countdown } from './countdown';
import type { DialogueNode } from './dialogue';

/** Characters a second, as the words arrive. */
const CPS = 55;

/**
 * Where a conversation has got to: which page, how much of it has arrived, which choice is lit, and
 * whether a menu that closes by itself is still counting.
 *
 * The page's dialogue box draws this, and an installed app's interface shows the same thing in its
 * own panel (#560, #574): one conversation, so a shop cannot sell differently on a phone. Nothing in
 * here knows how it is drawn; whoever draws it listens to the hooks below.
 */
export class Conversation {
  node: DialogueNode | null = null;
  page = 0;
  typed = 0;
  choice = 0;
  private acc = 0;
  private typedSinceBlip = 0;
  /** What a node that expires has left, or nothing counting at all. See `countdown.ts`. */
  private readonly clock = new Countdown();
  private onClose: (() => void) | null = null;
  /** Fires as characters appear (for a typewriter blip) and when a choice moves. */
  onType: (() => void) | null = null;
  onMove: (() => void) | null = null;
  /** A node has begun: a new speaker, a new face. */
  onStart: ((node: DialogueNode) => void) | null = null;
  /** It is over. */
  onEnd: (() => void) | null = null;
  /** Anything a reader could see has changed. */
  onChange: (() => void) | null = null;

  get isOpen(): boolean { return this.node !== null; }

  start(node: DialogueNode, onClose?: () => void): void {
    if (onClose) this.onClose = onClose;
    this.node = node;
    this.clock.begin(node.expires?.after);
    this.page = 0;
    this.typed = 0;
    this.acc = 0;
    this.choice = 0;
    this.onStart?.(node);
    this.onChange?.();
  }

  /**
   * Left or right on the highlighted row, for a choice that carries a number.
   *
   * The same page, already typed out, with the cursor still on the row you were on. Anything else
   * and running a quantity up from one to twenty would replay the shopkeeper's patter twenty times
   * and drop you back at the top of the list on every press.
   */
  nudge(dir: number): void {
    this.answered();
    if (!this.node?.choices || !this.atChoices) return;
    const here = this.choice;
    const changed = this.node.choices[here]?.adjust?.(dir);
    if (!changed) return;
    this.node = changed;
    // stay on the same row unless the menu came back shorter than it was
    this.choice = Math.min(here, (changed.choices?.length ?? 1) - 1);
    this.page = changed.pages.length - 1;
    this.typed = changed.pages[this.page].length;
    this.onChange?.();
  }

  /**
   * Somebody is here, so nothing expires any more.
   *
   * Once rather than each time: a count that could restart would be a menu that still closes under
   * a reader, only later.
   */
  private answered(): void {
    if (!this.clock.counting) return;
    this.clock.answered();
    this.onChange?.();
  }

  close(): void {
    if (!this.node) return;
    this.node = null;
    this.clock.answered();
    this.onEnd?.();
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  /** Time passing: words arriving, and a count running down. Says whether words are still arriving. */
  update(dt: number): boolean {
    if (!this.node) return false;
    if (this.node.expires) {
      const { state, changed } = this.clock.tick(dt);
      if (state === 'expired') {
        const next = this.node.expires.next();
        if (next) this.start(next); else this.close();
        return false;
      }
      if (changed) this.onChange?.();
    }
    const full = this.node.pages[this.page].length;
    if (this.typed >= full) return false;
    this.acc += dt * CPS;
    const n = Math.floor(this.acc);
    if (n > 0) {
      this.acc -= n;
      this.typed = Math.min(full, this.typed + n);
      this.typedSinceBlip += n;
      if (this.typedSinceBlip >= 3) { this.typedSinceBlip = 0; this.onType?.(); }
      this.onChange?.();
    }
    return true;
  }

  /** On: the rest of the page at once, then the next page, then the lit choice, then away. */
  advance(): void {
    if (!this.node) return;
    this.answered();
    const full = this.node.pages[this.page].length;
    if (this.typed < full) { this.typed = full; this.onChange?.(); return; }
    if (this.page < this.node.pages.length - 1) {
      this.page++; this.typed = 0; this.acc = 0;
      this.onChange?.();
      return;
    }
    if (this.node.choices && this.node.choices.length > 0) { this.select(); return; }
    this.close();
  }

  move(dir: number): void {
    this.answered();
    if (!this.node?.choices || !this.atChoices) return;
    const n = this.node.choices.length;
    this.choice = (this.choice + dir + n) % n;
    this.onMove?.();
    this.onChange?.();
  }

  /** Take this row, as a click or a tap on it does. */
  choose(index: number): void {
    if (!this.node?.choices || index < 0 || index >= this.node.choices.length) return;
    this.choice = index;
    this.select();
  }

  /** The − or + on this row, as left and right on it do: a touch changes the row it is on. */
  nudgeAt(index: number, dir: number): void {
    if (!this.node?.choices || index < 0 || index >= this.node.choices.length || !this.atChoices) return;
    this.choice = index;
    this.nudge(dir);
  }

  /** The last page is all there and has choices under it. */
  get atChoices(): boolean {
    if (!this.node) return false;
    return this.page === this.node.pages.length - 1 && this.typed >= this.node.pages[this.page].length && !!this.node.choices?.length;
  }

  /** The words showing now. */
  get shown(): string { return this.node ? this.node.pages[this.page].slice(0, this.typed) : ''; }

  /** The page has all arrived. */
  get done(): boolean { return this.node !== null && this.typed >= this.node.pages[this.page].length; }

  /** What happens if nobody answers, said while it is still going to happen; null when nothing is counting. */
  get waiting(): string | null {
    return this.clock.counting && this.node?.expires ? this.node.expires.label.replace('%s', String(this.clock.seconds)) : null;
  }

  private select(): void {
    if (!this.node?.choices) return;
    const c = this.node.choices[this.choice];
    const next = c.next();
    if (next) this.start(next);
    else this.close();
  }
}

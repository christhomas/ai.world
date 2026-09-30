import { describe, expect, it } from 'vitest';
import { Follow, type ScrollBox } from './follow';

/**
 * A scrolled box with the arithmetic a browser does and nothing else: `scrollTop` is clamped to
 * what the content and the box allow, and changing either clamps it again. No layout, no clock —
 * which is the point, because the fault in #535 was that where the log ended up depended on the
 * order two things happened in, and here the order is written down.
 */
class Box implements ScrollBox {
  private top = 0;
  constructor(public content: number, public height: number) {}
  get scrollHeight(): number { return Math.max(this.content, this.height); }
  get clientHeight(): number { return this.height; }
  get scrollTop(): number { return Math.min(this.top, this.scrollHeight - this.height); }
  set scrollTop(to: number) { this.top = Math.max(0, Math.min(to, this.scrollHeight - this.height)); }
  /** The last `px` of the content is out of sight below the box. */
  hiddenBelow(): number { return this.scrollHeight - this.scrollTop - this.height; }
}

/** Lines arrive, then the log loses the height the card for what is in reach takes off it. */
function linesThenCard(lines: number): Box {
  const box = new Box(0, 250);
  const follow = new Follow(box);
  for (let i = 0; i < lines; i++) { box.content += 120; follow.settle(); }
  box.height = 146;       // the rail's foot moves up by 82 units at 1.25
  follow.settle();        // what the ResizeObserver says when it does
  return box;
}

/** The same, the other way round: the card is already up when the lines arrive. */
function cardThenLines(lines: number): Box {
  const box = new Box(0, 250);
  const follow = new Follow(box);
  box.height = 146;
  follow.settle();
  for (let i = 0; i < lines; i++) { box.content += 120; follow.settle(); }
  return box;
}

describe('the message log keeps its newest line in view', () => {
  it('ends in the same place whichever came first, the lines or the card that shortens it', () => {
    // the precondition: this many lines really do overflow the shorter box, so there is a bottom
    // that can be missed
    expect(2 * 120).toBeGreaterThan(146);
    const one = linesThenCard(2), other = cardThenLines(2);
    expect(one.scrollTop).toBe(other.scrollTop);
    expect(one.hiddenBelow()).toBe(0);
    expect(other.hiddenBelow()).toBe(0);
  });

  it('is not talked out of following by a scroll the browser made when the content grew', () => {
    const box = new Box(0, 146);
    const follow = new Follow(box);
    box.content = 300; follow.settle();
    expect(box.hiddenBelow()).toBe(0);
    // a line wrapped onto another row before the scroll event from the last pin was delivered
    box.content = 330;
    follow.scrolled();
    expect(follow.isFollowing).toBe(true);
    follow.settle();
    expect(box.hiddenBelow()).toBe(0);
  });

  it('counts the box growing, and the browser pulling scrollTop down with it, as still following', () => {
    const box = new Box(0, 146);
    const follow = new Follow(box);
    box.content = 400; follow.settle();
    const before = box.scrollTop;
    box.height = 250;                // the card goes away
    expect(box.scrollTop).toBeLessThan(before);
    follow.scrolled();
    expect(follow.isFollowing).toBe(true);
  });

  it('stays where somebody scrolled up to, however the box changes around them', () => {
    const box = new Box(0, 250);
    const follow = new Follow(box);
    box.content = 600; follow.settle();
    box.scrollTop = 100; follow.scrolled();
    expect(follow.isFollowing).toBe(false);
    box.height = 146; follow.settle();
    box.content += 120; follow.settle();
    expect(box.scrollTop).toBe(100);
    // and scrolling back to the bottom is asking to follow again
    box.scrollTop = box.scrollHeight; follow.scrolled();
    expect(follow.isFollowing).toBe(true);
    box.content += 120; follow.settle();
    expect(box.hiddenBelow()).toBe(0);
  });

  it('goes back to the newest line when the console is opened, even for somebody reading back', () => {
    const box = new Box(0, 250);
    const follow = new Follow(box);
    box.content = 600; follow.settle();
    box.scrollTop = 100; follow.scrolled();
    expect(follow.isFollowing).toBe(false);
    follow.resume();
    expect(box.hiddenBelow()).toBe(0);
    expect(follow.isFollowing).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Conversation } from './conversation';
import type { DialogueNode } from './dialogue';

const node = (pages: string[], choices?: DialogueNode['choices'], expires?: DialogueNode['expires']): DialogueNode =>
  ({ speaker: 'Mira', emoji: '🧑', pages, choices, expires });

describe('a conversation, wherever it is drawn', () => {
  it('lets the words arrive, then hurries a page on and closes after the last', () => {
    const talk = new Conversation();
    let closed = 0;
    talk.start(node(['Good morning.', 'Fine weather.']), () => closed++);
    expect(talk.shown).toBe('');
    expect(talk.update(0.1)).toBe(true);           // 5.5 characters a tenth of a second
    expect(talk.shown).toBe('Good ');
    talk.advance();                                 // the rest of the page at once
    expect(talk.shown).toBe('Good morning.');
    expect(talk.update(0.1)).toBe(false);           // nothing left to arrive
    talk.advance();                                 // and on to the next
    expect(talk.page).toBe(1);
    expect(talk.shown).toBe('');
    talk.advance(); talk.advance();
    expect(talk.isOpen).toBe(false);
    expect(closed).toBe(1);
  });

  it('lights the choices only once the last page is all there, and takes the lit one', () => {
    const taken: string[] = [];
    const talk = new Conversation();
    talk.start(node(['Buying or selling?'], [
      { label: 'Buy', next: () => { taken.push('buy'); return null; } },
      { label: 'Sell', next: () => { taken.push('sell'); return node(['What have you got?']); } },
    ]));
    talk.move(1);
    expect(talk.choice, 'a choice nobody can see yet cannot be moved to').toBe(0);
    talk.advance();
    expect(talk.atChoices).toBe(true);
    talk.move(1);
    talk.advance();
    expect(taken).toEqual(['sell']);
    expect(talk.node?.pages).toEqual(['What have you got?']);
    talk.move(1);
    expect(talk.choice).toBe(0);
  });

  it('wraps round the choices, and a tap takes the row tapped', () => {
    const taken: number[] = [];
    const talk = new Conversation();
    const three = [0, 1, 2].map((i) => ({ label: String(i), next: () => { taken.push(i); return null; } }));
    talk.start(node(['Pick one.'], three));
    talk.advance();
    talk.move(-1);
    expect(talk.choice).toBe(2);
    talk.choose(1);
    expect(taken).toEqual([1]);
    expect(talk.isOpen).toBe(false);
  });

  it('runs a number up in place without retyping or losing the row', () => {
    const sell = (n: number): DialogueNode => node(['How many?'], [
      { label: 'Never mind', next: () => null },
      { label: `Sell ${n}`, next: () => null, adjust: (dir) => (n + dir < 1 ? null : sell(n + dir)) },
    ]);
    const talk = new Conversation();
    talk.start(sell(1));
    talk.advance();
    talk.move(1);
    talk.nudge(1); talk.nudge(1);
    expect(talk.node?.choices?.[1].label).toBe('Sell 3');
    expect(talk.choice).toBe(1);
    expect(talk.done).toBe(true);
    talk.nudge(-1); talk.nudge(-1); talk.nudge(-1);
    expect(talk.node?.choices?.[1].label, 'the end of its range leaves it alone').toBe('Sell 1');
  });

  it('closes a menu nobody answers, says so while counting, and stops counting once somebody does', () => {
    const talk = new Conversation();
    let left = 0;
    const leaving = node(['Leave the world?'], [{ label: 'Stay', next: () => null }],
      { after: 3, label: 'Leaving in %s…', next: () => { left++; return null; } });
    talk.start(leaving);
    talk.update(1.2);
    expect(talk.waiting).toBe('Leaving in 2…');
    talk.update(2);
    expect(left).toBe(1);
    expect(talk.isOpen).toBe(false);
    talk.start(leaving);
    talk.update(1);
    talk.move(1);                                   // somebody is here
    expect(talk.waiting).toBeNull();
    talk.update(10);
    expect(left).toBe(1);
    expect(talk.isOpen).toBe(true);
  });
});

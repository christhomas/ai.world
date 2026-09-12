import { describe, it, expect } from 'vitest';
import { Openings, REFUSED, type PutBack } from './opening';

/** Simpler than pretending to be the game: a purse, a pack, and what was said. */
function books() {
  const out = {
    gold: 100, pack: new Set<string>(), shut: [] as string[], barred: [] as string[], said: [] as string[],
  };
  const put: PutBack = {
    gold: (by) => { out.gold += by; },
    carry: (item, by) => { if (by > 0) out.pack.add(item); else out.pack.delete(item); },
    shut: (id) => { out.shut.push(id); },
    bar: (lock) => { out.barred.push(lock); },
    flash: (message) => { out.said.push(message); },
  };
  return { out, put };
}

describe('a chest opened before the world agreed', () => {
  it('costs nothing when the world agrees, which is the usual case', () => {
    const { out, put } = books();
    const open = new Openings();
    out.gold += 90; out.pack.add('lantern');
    const seq = open.ask({ id: 'vault:1:chest:0', gold: 90, prize: 'lantern', lock: null });
    open.answered(seq, { ok: true, gold: 90, key: false, prize: 'lantern' }, put);
    expect(out.gold).toBe(190);
    expect([...out.pack]).toEqual(['lantern']);
    expect(out.said).toEqual([]);
    expect(open.pending).toBe(0);
  });

  it('takes it all back when somebody else got there first', () => {
    const { out, put } = books();
    const open = new Openings();
    out.gold += 90; out.pack.add('lantern');
    const seq = open.ask({ id: 'vault:1:chest:0', gold: 90, prize: 'lantern', lock: 'vault:1' });
    open.answered(seq, { ok: false, gold: 0, key: false, prize: null }, put);
    expect(out.gold).toBe(100);
    expect([...out.pack]).toEqual([]);
    expect(out.shut).toEqual(['vault:1:chest:0']);
    expect(out.barred).toEqual(['vault:1']);
    expect(out.said).toEqual([REFUSED]);
  });

  it('settles on the world’s numbers when the two disagree', () => {
    const { out, put } = books();
    const open = new Openings();
    out.gold += 90; out.pack.add('lantern');
    const seq = open.ask({ id: 'c', gold: 90, prize: 'lantern', lock: null });
    open.answered(seq, { ok: true, gold: 120, key: false, prize: 'rope' }, put);
    expect(out.gold).toBe(220);
    expect([...out.pack]).toEqual(['rope']);
    // the purse settles quietly: nothing is said, because nothing the player did was wrong
    expect(out.said).toEqual([]);
  });

  it('bars the door again when the key was not in it after all', () => {
    const { out, put } = books();
    const open = new Openings();
    const seq = open.ask({ id: 'c', gold: 10, prize: null, lock: 'vault:2' });
    open.answered(seq, { ok: true, gold: 10, key: false, prize: null }, put);
    expect(out.barred).toEqual(['vault:2']);
  });

  it('answers only once, and ignores an answer to nothing', () => {
    const { out, put } = books();
    const open = new Openings();
    const seq = open.ask({ id: 'c', gold: 10, prize: null, lock: null });
    open.answered(seq, { ok: false, gold: 0, key: false, prize: null }, put);
    open.answered(seq, { ok: false, gold: 0, key: false, prize: null }, put);
    open.answered(99, { ok: false, gold: 0, key: false, prize: null }, put);
    expect(out.gold).toBe(90);                    // taken back once, not three times
  });

});

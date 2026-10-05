import { describe, expect, it, vi } from 'vitest';
import { SaveOwner } from './owner';
import type { SaveStore } from './store';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function held() {
  const writes: Array<{ value: unknown; finish: ReturnType<typeof deferred> }> = [];
  const store: SaveStore = { load: async () => undefined, remove: async () => {},
    save: async (_key, value) => { const finish = deferred(); writes.push({ value, finish }); await finish.promise; } };
  return { store, writes, owner: new SaveOwner(store, 'slot') };
}

describe('owned save ordering and durable exit', () => {
  it('captures independent JSON snapshots immediately and serializes slow writes', async () => {
    const test = held(), value = { player: { x: 1 }, items: ['bread'] };
    const first = test.owner.write(value);
    value.player.x = 2; value.items.push('apple');
    const second = test.owner.write(value);
    value.player.x = 3;
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0].value).toEqual({ player: { x: 1 }, items: ['bread'] });
    test.writes[0].finish.resolve(); await first; await Promise.resolve();
    expect(test.writes).toHaveLength(2);
    expect(test.writes[1].value).toEqual({ player: { x: 2 }, items: ['bread', 'apple'] });
    test.writes[1].finish.resolve(); await second; await test.owner.flush();
  });

  it('uses strict writes for acknowledged saves and surfaces quota failure through flush', async () => {
    const save = vi.fn(async () => {}), saveStrict = vi.fn(async () => { throw new Error('quota'); });
    const owner = new SaveOwner({ save, saveStrict, load: async () => undefined, remove: async () => {} }, 'slot');
    await expect(owner.write({ day: 2 }, true)).rejects.toThrow('quota');
    await expect(owner.flush()).rejects.toThrow('quota');
    expect(save).not.toHaveBeenCalled();
    saveStrict.mockImplementation(async () => {});
    await owner.write({ day: 3 }, true); await expect(owner.flush()).resolves.toBeUndefined();
  });

  it('continues the queue after an earlier storage rejection', async () => {
    const test = held();
    const first = test.owner.write({ day: 1 }), second = test.owner.write({ day: 2 });
    const rejected = expect(first).rejects.toThrow('disk');
    test.writes[0].finish.reject(new Error('disk')); await rejected; await Promise.resolve();
    expect(test.writes).toHaveLength(2);
    test.writes[1].finish.resolve(); await second; await test.owner.flush();
  });

  it('fences later callbacks while accepted writes finish before close resolves', async () => {
    const test = held(); let closed = false;
    const write = test.owner.write({ day: 1 });
    const close = test.owner.close().then(() => { closed = true; });
    await expect(test.owner.write({ day: 9 })).rejects.toThrow('closed');
    expect(closed).toBe(false); expect(test.writes).toHaveLength(1);
    test.writes[0].finish.resolve(); await write; await close;
    expect(closed).toBe(true);
  });

  it('does not let an older completion hide a newer malformed snapshot', async () => {
    const test = held(), first = test.owner.write({ day: 1 });
    await expect(test.owner.write({ invalid: 1n })).rejects.toThrow();
    test.writes[0].finish.resolve(); await first;
    await expect(test.owner.flush()).rejects.toThrow();
    const retry = test.owner.write({ day: 2 });
    test.writes[1].finish.resolve(); await retry;
    await expect(test.owner.flush()).resolves.toBeUndefined();
  });
});

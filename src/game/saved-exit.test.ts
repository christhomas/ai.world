import { describe, expect, it, vi } from 'vitest';
import { savedExit } from './saved-exit';

describe('saving before leaving an owned session', () => {
  it('parks before saving, shares duplicate gestures and leaves only after the write resolves', async () => {
    const calls: string[] = []; let done!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { done = resolve; calls.push('save'); }));
    const leave = savedExit({ park: () => calls.push('park'), resume: () => calls.push('resume'), save,
      release: () => calls.push('release'), depart: () => calls.push('depart') });
    const first = leave(), second = leave();
    expect(second).toBe(first); expect(calls).toEqual(['park', 'save']);
    done(); await first;
    expect(calls).toEqual(['park', 'save', 'release', 'depart']);
    await leave(); expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed save playable and allows an explicit retry', async () => {
    const calls: string[] = []; let fails = true;
    const leave = savedExit({ park: () => calls.push('park'), resume: () => calls.push('resume'),
      save: async () => { if (fails) throw new Error('disk full'); },
      release: () => calls.push('release'), depart: () => calls.push('depart') });
    await expect(leave()).rejects.toThrow('disk full');
    expect(calls).toEqual(['park', 'resume']);
    fails = false; await leave();
    expect(calls).toEqual(['park', 'resume', 'park', 'release', 'depart']);
  });

  it('departs after successful persistence even if resource cleanup reports a failure', async () => {
    const depart = vi.fn(), resume = vi.fn();
    const leave = savedExit({ park: () => {}, resume, save: async () => {},
      release: () => { throw new Error('cleanup'); }, depart });
    await expect(leave()).rejects.toThrow('cleanup');
    expect(depart).toHaveBeenCalledTimes(1); expect(resume).not.toHaveBeenCalled();
    await leave(); expect(depart).toHaveBeenCalledTimes(1);
  });
});

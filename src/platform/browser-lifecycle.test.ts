import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeVisibility, returnToTitle } from './browser-lifecycle';

afterEach(() => vi.unstubAllGlobals());

function page(hidden = false) {
  const listeners = new Set<() => void>();
  const document = {
    hidden,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  vi.stubGlobal('document', document);
  return { document, listeners, change: (hidden: boolean) => {
    document.hidden = hidden;
    for (const listener of listeners) listener();
  } };
}

describe('browser lifetime adapter', () => {
  it('delivers initial visibility, observes changes and removes its actual listener on shutdown', () => {
    const browser = page(true);
    const activity = vi.fn();
    const stop = observeVisibility(activity);
    expect(activity).toHaveBeenCalledExactlyOnceWith(false);
    expect(browser.listeners.size).toBe(1);
    browser.change(false);
    expect(activity).toHaveBeenLastCalledWith(true);
    stop();
    expect(browser.listeners.size).toBe(0);
    browser.change(true);
    expect(activity).toHaveBeenCalledTimes(2);
    expect(browser.document.removeEventListener).toHaveBeenCalledWith('visibilitychange', browser.document.addEventListener.mock.calls[0][1]);
  });

  it('does not leave a listener behind if initial host activation fails', () => {
    const browser = page();
    expect(() => observeVisibility(() => { throw new Error('activation failed'); })).toThrow('activation failed');
    expect(browser.listeners.size).toBe(0);
  });

  it('persists and releases the world before navigating to its clean title path', () => {
    const calls: string[] = [];
    let pending!: () => void;
    const location = { pathname: '/ai.world/', href: '/ai.world/?seed=3' };
    const timer = vi.fn((callback: () => void, _delay: number) => { pending = callback; calls.push('timer'); });
    vi.stubGlobal('window', { location, setTimeout: timer });
    returnToTitle(() => calls.push('save'), () => calls.push('release'));
    expect(calls).toEqual(['save', 'release', 'timer']);
    expect(timer.mock.calls[0][1]).toBe(150);
    expect(location.href).toBe('/ai.world/?seed=3');
    pending();
    expect(location.href).toBe('/ai.world/');
  });

  it('still shuts down and leaves the world if persistence or cleanup throws', () => {
    const release = vi.fn(() => { throw new Error('cleanup failed'); });
    const timer = vi.fn();
    vi.stubGlobal('window', { setTimeout: timer });
    expect(() => returnToTitle(() => { throw new Error('save failed'); }, release)).toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(timer).toHaveBeenCalledOnce();
  });
});

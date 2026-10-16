import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserGameEvents } from './browser-game-events';

afterEach(() => vi.unstubAllGlobals());

function browser() {
  const windowEvents = new EventTarget(), documentEvents = new EventTarget();
  const pending = new Map<number, () => void>(), retained: Array<() => void> = [];
  let sequence = 0;
  const win = {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: vi.fn(windowEvents.removeEventListener.bind(windowEvents)),
    setTimeout: (callback: () => void) => { const id = ++sequence; pending.set(id, callback); retained.push(callback); return id; },
    clearTimeout: vi.fn((id: number) => pending.delete(id)),
  };
  const doc = {
    hidden: false,
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: vi.fn(documentEvents.removeEventListener.bind(documentEvents)),
  };
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  return { win, doc, pending, retained, resize: () => windowEvents.dispatchEvent(new Event('resize')),
    fire: (id: number) => { const callback = pending.get(id); pending.delete(id); callback?.(); },
    visibility: () => documentEvents.dispatchEvent(new Event('visibilitychange')) };
}

describe('owned browser game events', () => {
  it('saves only when hidden, resizes while live and removes listeners and photo timers on disposal', () => {
    const b = browser();
    const ports = { isLive: () => true, resize: vi.fn(), persist: vi.fn(), say: vi.fn() };
    const events = createBrowserGameEvents(ports);
    b.resize(); b.visibility();
    expect(ports.resize).toHaveBeenCalledTimes(1);
    expect(ports.persist).not.toHaveBeenCalled();
    b.doc.hidden = true; b.visibility();
    expect(ports.persist).toHaveBeenCalledTimes(1);
    events.afterPhotoSaved('one.png'); events.afterPhotoSaved('two.png');
    expect(b.pending.size).toBe(2);
    events.dispose(); events.dispose();
    b.resize(); b.visibility();
    for (const callback of b.retained) callback();
    events.afterPhotoSaved('late.png');
    expect(ports.resize).toHaveBeenCalledTimes(1);
    expect(ports.persist).toHaveBeenCalledTimes(1);
    expect(ports.say).not.toHaveBeenCalled();
    expect(b.win.removeEventListener).toHaveBeenCalledTimes(1);
    expect(b.doc.removeEventListener).toHaveBeenCalledTimes(1);
    expect(b.win.clearTimeout).toHaveBeenCalledTimes(2);
    expect(b.pending.size).toBe(0);
  });

  it('announces completed photos and fences continuations when the session retires first', () => {
    const b = browser(); let live = true;
    const ports = { isLive: () => live, resize: vi.fn(), persist: vi.fn(), say: vi.fn() };
    const events = createBrowserGameEvents(ports);
    events.afterPhotoSaved('one.png'); b.fire(1);
    expect(ports.say).toHaveBeenCalledWith('Saved one.png');
    expect(b.pending.size).toBe(0);
    events.afterPhotoSaved('two.png'); live = false;
    b.fire(2); b.resize(); b.doc.hidden = true; b.visibility();
    expect(ports.say).toHaveBeenCalledTimes(1);
    expect(ports.resize).not.toHaveBeenCalled();
    expect(ports.persist).not.toHaveBeenCalled();
    events.dispose();
    expect(b.win.clearTimeout).not.toHaveBeenCalled();
  });
});

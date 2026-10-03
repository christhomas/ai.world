import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionLifetime, shutDownGame } from './lifecycle';
import { GameState } from './state';

afterEach(() => vi.unstubAllGlobals());

function host() {
  const ports = { frame: vi.fn(), pause: vi.fn(), resume: vi.fn(), release: vi.fn() };
  const session = new SessionLifetime(ports);
  session.setActive(true);
  ports.resume.mockClear();
  return { ports, session };
}

describe('owned game lifetime', () => {
  it('advances existing game state without browser globals and fences inactive and disposed frames', () => {
    for (const name of ['window', 'document', 'requestAnimationFrame', 'performance']) vi.stubGlobal(name, undefined);
    const state = new GameState();
    const frame = vi.fn(() => { state.day++; });
    const session = new SessionLifetime({ frame, pause: vi.fn(), resume: vi.fn(), release: vi.fn() });
    const opened = state.day;
    session.frame(0.04, 0);
    expect(state.day).toBe(opened);
    session.setActive(true);
    session.frame(0.04, 1);
    expect(state.day).toBe(opened + 1);
    session.setActive(false);
    session.frame(0.04, 2);
    expect(state.day).toBe(opened + 1);
    session.setActive(true);
    session.frame(0.04, 3);
    expect(state.day).toBe(opened + 2);
    session.dispose();
    session.setActive(true);
    session.frame(0.04, 4);
    expect(state.day).toBe(opened + 2);
    expect(frame).toHaveBeenCalledTimes(2);
  });

  it('parks an initially inactive host and only starts once it becomes active', () => {
    const ports = { frame: vi.fn(), pause: vi.fn(), resume: vi.fn(), release: vi.fn() };
    const session = new SessionLifetime(ports);
    session.setActive(false);
    expect(ports.pause).toHaveBeenCalledOnce();
    session.frame(0.04, 1);
    expect(ports.frame).not.toHaveBeenCalled();
    expect(ports.resume).not.toHaveBeenCalled();
    session.setActive(true);
    session.frame(0.04, 2);
    expect(ports.resume).toHaveBeenCalledOnce();
    expect(ports.frame).toHaveBeenCalledExactlyOnceWith(0.04, 2);
  });

  it('pauses and resumes once per transition, and cannot resume a closed world', () => {
    const { session, ports } = host();
    session.setActive(false);
    session.setActive(false);
    expect(ports.pause).toHaveBeenCalledOnce();
    session.setActive(true);
    session.setActive(true);
    expect(ports.resume).toHaveBeenCalledOnce();
    session.dispose();
    session.dispose();
    session.setActive(false);
    session.setActive(true);
    expect(ports.release).toHaveBeenCalledOnce();
    expect(ports.resume).toHaveBeenCalledOnce();
  });

  it('fences callbacks before releasing owned listeners and engine resources', () => {
    const { session, ports } = host();
    const unsubscribe = vi.fn(() => {
      session.setActive(false);
      session.setActive(true);
      session.frame(0.04, 1);
    });
    session.own(unsubscribe);
    session.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(ports.frame).not.toHaveBeenCalled();
    expect(ports.pause).not.toHaveBeenCalled();
    expect(ports.resume).not.toHaveBeenCalled();
    expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(ports.release.mock.invocationCallOrder[0]);
    const arrivedLate = vi.fn();
    session.own(arrivedLate);
    expect(arrivedLate).toHaveBeenCalledOnce();
  });

  it('still releases other listeners and resources when one listener throws', () => {
    const { session, ports } = host();
    session.own(() => { throw new Error('listener failed'); });
    const next = vi.fn();
    session.own(next);
    expect(() => session.dispose()).toThrow(AggregateError);
    expect(next).toHaveBeenCalledOnce();
    expect(ports.release).toHaveBeenCalledOnce();
    session.dispose();
    session.frame(0.04, 1);
    expect(ports.frame).not.toHaveBeenCalled();
  });

  it('releases controls, link and every resource even when earlier cleanup fails', () => {
    const calls: string[] = [];
    const cleanup = (name: string, fails = false) => () => {
      calls.push(name);
      if (fails) throw new Error(name);
    };
    expect(() => shutDownGame({
      stop: cleanup('stop', true),
      controls: [{ dispose: cleanup('input', true) }, { dispose: cleanup('touch') }],
      disconnect: cleanup('link', true), clear: cleanup('others'),
      resources: [{ dispose: cleanup('audio', true) }, { dispose: cleanup('workers') }, { dispose: cleanup('renderer') }],
    })).toThrow(AggregateError);
    expect(calls).toEqual(['stop', 'input', 'touch', 'link', 'others', 'audio', 'workers', 'renderer']);
  });
});

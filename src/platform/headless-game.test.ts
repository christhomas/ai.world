import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { composeGame } from '../game/compose';
import { savedInMemory } from '../save/memory';
import { systemClock } from '../../server/host-clock';
import type { FrameDescription } from '../core/scene';
import { headlessGame } from './headless-game';

/**
 * The game, played with no page anywhere in the process (#560).
 *
 * Vitest runs this file under Node: there is no `window`, no `document`, no worker and no WebGL.
 * What runs is the same `composeGame` the page runs, on a host that keeps what the game says in a
 * presentation, grows the country and meshes its ground on its own turn, and plays against the
 * world in the same thread. If anything in the game still reached for the browser, it would throw.
 *
 * The suite shares a worker between files (`isolate: false`, `vite.config.ts`), and a file that
 * stood a page in for its own tests may have left it about, which once made this file fail in
 * company and pass alone. So it takes any page away for as long as it runs, rather than trusting
 * that nobody left one.
 */
const frame = 1000 / 30;
const breathe = () => new Promise<void>((resume) => setTimeout(resume, 4));

beforeAll(() => { vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('the game on a host with no page', () => {
  it('opens a world, streams its ground, draws it and walks the hero through it', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const game = headlessGame({
      viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(), random: Math.random,
    });
    const store = savedInMemory();
    const opened = composeGame({ store, slotKey: 'headless', saved: undefined, seed: 3, worldName: undefined, world: 'road' },
      game.platform);
    try {
      const { chunks, online, player, state } = game.handles();
      // the world in this thread answers, and the ground around the hero arrives and is meshed
      for (let step = 0; step < 900; step++) {
        game.frame(frame);
        await breathe();
        const ground = chunks.captureProgress();
        if (online.connected && ground.desired > 0 && ground.loaded >= Math.min(40, ground.desired) && ground.pending === 0) break;
      }
      const ground = chunks.captureProgress();
      expect(online.connected, `the world in this thread: ${online.status}`).toBe(true);
      expect(ground.desired, JSON.stringify(ground)).toBeGreaterThan(0);
      expect(ground.loaded, JSON.stringify(ground)).toBeGreaterThanOrEqual(Math.min(40, ground.desired));

      // a frame drawn as the page draws it: lit ground, and the hero standing on it
      game.recording.captureNext();
      game.frame(frame);
      const drawn = game.recording.last as FrameDescription | null;
      expect(drawn).not.toBeNull();
      const kinds = new Set(drawn!.nodes.map((node) => node.kind));
      expect([...kinds]).toEqual(expect.arrayContaining(['mesh', 'directional', 'ambient']));
      expect(drawn!.nodes.filter((node) => node.kind === 'mesh').length).toBeGreaterThan(20);
      expect(drawn!.renderTimeMs).toBeGreaterThan(0);

      // and the hero walks when held to, as a thumb on a stick would hold him
      const from = { x: player.x, z: player.z };
      game.input.hold('w');
      for (let step = 0; step < 45; step++) { game.frame(frame); await breathe(); }
      game.input.release('w');
      const walked = Math.hypot(player.x - from.x, player.z - from.z);
      expect(walked, `from ${JSON.stringify(from)} to ${player.x},${player.z}`).toBeGreaterThan(1);

      // a line typed into the console is the page's console's: a question mark asks the game
      const before = game.presentation.chat.at(-1);
      game.say('?');
      expect(game.presentation.chat.at(-1), 'the game answered in the console').not.toBe(before);
      expect(game.presentation.chat.at(-1)?.kind).toBe('sys');

      // the game kept its word about where it is: a save holds the hero, and it is not in a page
      await opened.save();
      expect(store.keys).toContain('headless');
      expect(state.playerId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      opened.dispose();
    }
  });

  it('can be thrown away while it is still loading and opened again, with nothing of it left running', async () => {
    for (let start = 0; start < 3; start++) {
      const game = headlessGame({
        viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(), random: Math.random,
      });
      const opened = composeGame({ store: savedInMemory(), slotKey: `again-${start}`, saved: undefined, seed: 3 + start,
        worldName: undefined, world: 'road' }, game.platform);
      const { online } = game.handles();
      // a frame or two in: the world in this thread has not answered yet, and the ground is not here
      game.frame(frame);
      await breathe();
      opened.dispose();
      // whatever was already due may finish; after that nothing draws, steps or connects again
      game.frame(frame);
      await breathe();
      const drawn = game.recording.frames;
      for (let step = 0; step < 20; step++) { game.frame(frame); await breathe(); }
      expect(game.recording.frames, `start ${start}: nothing draws after the game is disposed`).toBe(drawn);
      expect(online.connected, `start ${start}: the world is let go`).toBe(false);
    }
  });
});

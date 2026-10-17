import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { composeGame } from '../game/compose';
import { savedInMemory } from '../save/memory';
import { systemClock } from '../../server/host-clock';
import { headlessGame } from './headless-game';

/**
 * The stick, as an installed app's thumb holds it, steering whatever the hero is on (#571).
 *
 * The app's stick holds the walk keys the page's keyboard holds (`src/mobile/game-engine.ts`,
 * `walkKeysFor`), so what each body does with them is the shared game's own rule rather than a
 * second mapping: these hold them on a host with no page and check that a horse and a wing go
 * where they are steered, and not only a hero on foot.
 *
 * Shares a worker with other files (`isolate: false`), so any page left about is taken away for as
 * long as it runs; see `headless-game.test.ts`.
 */
const frame = 1000 / 30;
const breathe = () => new Promise<void>((resume) => setTimeout(resume, 4));

beforeAll(() => { vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('the stick on whatever the hero is on', () => {
  it('rides a horse and flies a wing where it is held, as it walks him on foot', async () => {
    const game = headlessGame({
      viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(), random: Math.random,
    });
    const opened = composeGame({ store: savedInMemory(), slotKey: 'controls', saved: undefined, seed: 3, worldName: undefined,
      world: 'road' }, game.platform);
    try {
      const { chunks, online, player, state, mount, overworldRenderer, wing } = game.handles();
      for (let step = 0; step < 900; step++) {
        game.frame(frame);
        await breathe();
        const ground = chunks.captureProgress();
        if (online.connected && ground.desired > 0 && ground.loaded >= Math.min(40, ground.desired) && ground.pending === 0) break;
      }
      expect(chunks.heightAt(player.x, player.z), 'the hero has ground to stand on').not.toBeNull();
      const held = async (key: string, frames: number) => {
        const from = { x: player.x, z: player.z };
        game.input.hold(key);
        for (let step = 0; step < frames; step++) { game.frame(frame); await breathe(); }
        game.input.release(key);
        for (let step = 0; step < 3; step++) { game.frame(frame); await breathe(); }
        return Math.hypot(player.x - from.x, player.z - from.z);
      };

      // on foot, for the measure of the others
      expect(await held('w', 30), 'on foot').toBeGreaterThan(0.5);

      // in the saddle: the stick rides the horse, and the horse goes with him
      mount.borrow(player.x, player.z, chunks, overworldRenderer);
      mount.mount(player);
      expect(mount.riding).toBe(true);
      expect(await held('s', 30), 'on horseback').toBeGreaterThan(0.5);
      expect(mount.riding, 'still riding after being steered').toBe(true);
      expect(Math.hypot(mount.entity!.x - player.x, mount.entity!.z - player.z), 'the horse under him').toBeLessThan(0.5);
      mount.dismount(player, chunks);
      mount.returnBorrowed(chunks, overworldRenderer);
      expect(mount.riding).toBe(false);

      // with a wing: the jump the stick's Space is, the same key again in the air, and then held
      state.give('glider', 1);
      for (let step = 0; step < 10; step++) { game.frame(frame); await breathe(); }
      expect(opened.act('jump'), 'a jump').toBe(true);
      for (let step = 0; step < 3; step++) { game.frame(frame); await breathe(); }
      opened.act('jump');
      expect(wing.flying, 'the wing opened at the top of the jump').toBe(true);
      const from = { x: player.x, z: player.z };
      game.input.hold('w');
      let flew = 0;
      for (let step = 0; step < 20 && wing.flying; step++) {
        game.frame(frame);
        await breathe();
        flew = Math.hypot(player.x - from.x, player.z - from.z);
      }
      game.input.release('w');
      expect(flew, 'steered through the air before he came down').toBeGreaterThan(0.2);
    } finally {
      opened.dispose();
    }
  });
});

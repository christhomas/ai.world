import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { composeGame } from '../game/compose';
import { BOAT } from '../game/sailing';
import { savedInMemory } from '../save/memory';
import { systemClock } from '../../server/host-clock';
import { headlessGame } from './headless-game';

/**
 * The stick, as an installed app's thumb holds it, steering whatever the hero is on (#571).
 *
 * The app's stick holds the walk keys the page's keyboard holds (`src/mobile/game-engine.ts`,
 * `walkKeysFor`), so what each body does with them is the shared game's own rule rather than a
 * second mapping: these hold them on a host with no page and check that a horse, a boat and a wing go
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

  it('casts off, rows and steers a boat, stops at the jetty and steps ashore', async () => {
    const game = headlessGame({
      viewport: { width: 1200, height: 540 }, clock: systemClock, now: () => performance.now(), random: Math.random,
    });
    // Seed 1 has the jetties used by `world/piers.test.ts`; no invented coast or replacement helm.
    const opened = composeGame({ store: savedInMemory(), slotKey: 'boat-controls', saved: undefined, seed: 1,
      worldName: undefined, world: 'road' }, game.platform);
    try {
      const { chunks, online, player, sailing, structures, commandWorld } = game.handles();
      const pier = structures.piers.find((one) => one.side === 'mainland')!;
      expect(pier, 'a jetty to cast off from').toBeDefined();
      const [deckX, deckZ] = pier.tiles[pier.tiles.length - 1];
      const moored = {
        x: pier.dockX + 0.5 + pier.dx, z: pier.dockZ + 0.5 + pier.dz,
        yaw: Math.atan2(-pier.dz, pier.dx),
      };
      commandWorld.warpTo(deckX + 0.5, deckZ + 0.5);
      for (let step = 0; step < 900; step++) {
        game.frame(frame);
        await breathe();
        if (online.connected && chunks.heightAt(deckX + 0.5, deckZ + 0.5) !== null
          && chunks.waterAt(moored.x, moored.z) !== null && chunks.captureProgress().pending === 0) break;
      }
      expect(online.connected, 'the world in this thread answered').toBe(true);
      expect(chunks.heightAt(deckX + 0.5, deckZ + 0.5), 'the jetty has arrived').not.toBeNull();
      // `heightAt` alone cannot tell unloaded country from water, so ask both before rowing.
      for (let distance = 0; distance <= 4; distance += 0.25) {
        const x = moored.x + pier.dx * distance, z = moored.z + pier.dz * distance;
        expect(chunks.waterAt(x, z), `water ahead at ${x},${z}`).not.toBeNull();
        expect(chunks.heightAt(x, z), 'no dry ground in the way out').toBeNull();
      }

      // The handle buys her where the boatwright leaves her; the app's action boards her.
      commandWorld.warpTo(deckX + 0.5, deckZ + 0.5);
      for (let step = 0; step < 3; step++) { game.frame(frame); await breathe(); }
      sailing.buy(moored.x, moored.z, moored.yaw);
      expect(sailing.near(player.x, player.z), 'close enough to climb aboard').toBe(true);
      expect(sailing.sailing, 'still on the jetty').toBe(false);
      expect(opened.act('interact'), 'the app can use the boat').toBe(true);
      expect(sailing.sailing, 'the action cast off rather than opening the ferry dialogue').toBe(true);
      for (let step = 0; step < 10; step++) { game.frame(frame); await breathe(); }

      const aboard = () => {
        expect(sailing.sailing, 'still aboard after being steered').toBe(true);
        expect(sailing.overboard, 'not swimming beside the boat').toBe(false);
        expect(Math.hypot(player.x - sailing.x, player.z - sailing.z), 'the boat under him').toBeLessThan(0.5);
        expect(player.y, 'standing on the deck').toBeCloseTo(BOAT.DECK, 5);
        expect(chunks.waterAt(sailing.x, sailing.z), 'the hull is on loaded water').not.toBeNull();
        expect(chunks.heightAt(sailing.x, sailing.z), 'the hull has not climbed onto land').toBeNull();
      };
      const held = async (key: string, frames: number) => {
        game.input.hold(key);
        try {
          for (let step = 0; step < frames; step++) {
            game.frame(frame);
            aboard();
            await breathe();
          }
        } finally {
          game.input.release(key);
        }
        for (let step = 0; step < 3; step++) { game.frame(frame); await breathe(); }
        aboard();
      };
      aboard();
      expect(game.presentation.action, 'the live action follows him aboard').toBe('Step ashore');

      // Up rows along the bow; left and right turn it, rather than walking him off the deck.
      await held('w', 12);
      expect((sailing.x - moored.x) * pier.dx + (sailing.z - moored.z) * pier.dz, 'rowed out from the jetty')
        .toBeGreaterThan(1);
      const yaw = sailing.yaw;
      await held('a', 6);
      expect(sailing.yaw - yaw, 'left puts the tiller over').toBeGreaterThan(0.2);
      const turned = sailing.yaw;
      await held('d', 6);
      expect(turned - sailing.yaw, 'right brings the bow back').toBeGreaterThan(0.2);
      expect(sailing.yaw, 'pointing out along the jetty again').toBeCloseTo(yaw, 5);

      // Down rows backwards into the walkable decking. Keep asking after she reaches it: a boat
      // may slide along a coast, but cannot sail across the dry ground that stops her here.
      const out = { x: sailing.x, z: sailing.z };
      await held('s', 30);
      expect((out.x - sailing.x) * pier.dx + (out.z - sailing.z) * pier.dz, 'rowed back toward the jetty')
        .toBeGreaterThan(1);
      const stopped = { x: sailing.x, z: sailing.z };
      expect(chunks.heightAt(stopped.x - pier.dx * 0.5, stopped.z - pier.dz * 0.5), 'dry decking in her path')
        .not.toBeNull();
      await held('s', 12);
      expect(Math.hypot(sailing.x - stopped.x, sailing.z - stopped.z), 'stopped against the decking').toBeLessThan(0.25);

      expect(opened.act('interact'), 'the app can step ashore').toBe(true);
      expect(sailing.sailing, 'off the boat').toBe(false);
      for (let step = 0; step < 10; step++) { game.frame(frame); await breathe(); }
      expect(chunks.heightAt(player.x, player.z), 'standing on dry ground after landing').not.toBeNull();
      expect(chunks.blocked(player.x, player.z), 'the landing is clear').toBe(false);
      expect(sailing.bought, 'the boat is still his').toBe(true);
      expect(Math.hypot(sailing.x - stopped.x, sailing.z - stopped.z), 'left moored in the water').toBeLessThan(0.25);
    } finally {
      opened.dispose();
    }
  });
});

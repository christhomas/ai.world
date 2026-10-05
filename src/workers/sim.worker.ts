import { systemClock } from '../../server/host-clock';
import { LocalWorldHost } from './local-world-host';
import { BrowserVault } from '../net/browservault';
import { Forgetful } from '../../server/vault';
import { bootWorld } from './world-boot';

/**
 * The world server, running in a thread beside the game.
 *
 * This is the same simulation the Raspberry Pi runs — the same clock, the same market, the same
 * post shelf, the same log of what has been changed — hosted in a Web Worker instead of in a
 * process, and reached over a `MessagePort` instead of a socket. Somebody playing alone is
 * therefore playing against the server, and single player stops being a second implementation that
 * quietly drifts from the first.
 *
 * It is deliberately a thread rather than something in the page. The point of moving work off the
 * client is that the client has other things to do — drawing, mostly — and a simulation sharing the
 * main thread with the frame loop would be the same work in the same place with more ceremony.
 *
 * One player, one world, no network. `docs/server-authority.md` for where it goes next.
 */

/**
 * One player, one world, and the world's own creatures.
 *
 * `ground: true` is what makes this the authority rather than a clock with a market attached: it
 * grows the same terrain the page is drawing, spawns the herds on it, steps them, and tells the
 * page what is near. The page stops inventing its own the moment it is told anything.
 */
const boot = bootWorld(async () => {
  const capturing = self.name === 'shots-capture';
  const vault = capturing ? new Forgetful() : await BrowserVault.open();
  const host = new LocalWorldHost({
    vault, clock: systemClock,
    // bytes are handed over rather than copied, which is what makes passing a chunk of country
    // between the world and the page next door cost nothing
    post: (parcel) => self.postMessage(parcel, parcel instanceof ArrayBuffer ? [parcel] : []),
    // A normal host close waits for accepted writes. Link.close still needs its own acknowledgement.
    closed: () => {
      if (vault instanceof Forgetful) { self.close(); return; }
      void vault.flush().then(() => self.close(), failStorage);
    },
  }, {}, capturing);
  return {
    receive(parcel: unknown) {
      host.receive(parcel);
      // Every simulation write already enters the ordered durable queue. A message boundary
      // observes failures, including the strict save done when the page parks the authority.
      if (!(vault instanceof Forgetful)) void vault.flush().catch(failStorage);
    },
    dispose: () => host.dispose(),
  };
}, failStorage);

function failStorage(error: unknown): void {
  console.error('Could not keep the local world', error);
  self.postMessage('world-storage-failed');
  self.close();
}

/**
 * Everything the page says, and the two things it says to this thread rather than through it.
 *
 * A hidden tab draws nothing — the browser stops asking for frames and `main.ts` stands the chunk
 * workers and the audio down on `visibilitychange` — but this world went on running at its full
 * ten ticks a second with nobody watching, plus a clock broadcast every five seconds to a page
 * that was not listening. Nothing was wrong with it; nothing had ever told it to stop.
 *
 * `stop()` is the right thing to reach for rather than a flag of our own, because it is the same
 * door the Raspberry Pi goes out of: it clears both intervals and saves every room, so a tab put
 * in the background is also a tab whose world is on disk. `start()` refuses to arm a second ticker
 * and resets the clock it measures its own step from, so a world coming back from an hour in the
 * background takes one ordinary tick rather than an hour of them at once.
 *
 * Except in a capture, whose clock is the harness's: see `worldDoor`.
 */
self.onmessage = (e: MessageEvent<unknown>) => boot.receive(e.data);

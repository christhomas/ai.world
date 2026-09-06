import { Simulation } from '../../server/sim';
import type { Wire } from '../../server/rooms';
import { BrowserVault } from '../net/browservault';

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
const sim = new Simulation({ dataDir: 'worlds', vault: new BrowserVault(), ground: true });

/** The page, as the roster sees it: exactly what a websocket looks like from the same angle. */
const wire: Wire = {
  send: (text) => self.postMessage(text),
  // a worker's port is open for as long as the worker is, and the page ends it by terminating us
  open: true,
  close: () => {},
};

const player = sim.attach(wire);
sim.start();

self.onmessage = (e: MessageEvent<string>) => {
  player.receive(e.data);
};

import type { Grower } from './grower';
import { createCountryGrower } from './country-jobs';
import type { CountryReply } from './countrymessages';
import type { PatchCountry } from './patchcountry';

/**
 * The country worker, wired up.
 *
 * The browser adapter stays out of `grower.ts`: everything in there is testable
 * without a browser, and `new Worker(new URL(...))` is the one thing that is not. The seam is the
 * `send` function — a test passes a list to push onto, the game passes a worker.
 */
export function growerFor(seed: number, country: PatchCountry): Grower {
  const worker = new Worker(new URL('../workers/country.worker.ts', import.meta.url), { type: 'module' });
  return createCountryGrower(seed, country.store, {
    send: (message) => worker.postMessage(message),
    listen: (reply, failed) => {
      worker.onmessage = (e: MessageEvent<CountryReply>) => { if (e.data) reply(e.data); };
      worker.onerror = failed;
      worker.onmessageerror = failed;
      return () => { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
    },
    stop: () => worker.terminate(),
  });
}

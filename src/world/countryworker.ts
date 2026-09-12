import { Grower } from './grower';
import type { CountryReply } from './countrymessages';
import type { PatchCountry } from './patchcountry';

/**
 * The country worker, wired up.
 *
 * Three lines of assembly kept out of `grower.ts` on purpose: everything in there is testable
 * without a browser, and `new Worker(new URL(...))` is the one thing that is not. The seam is the
 * `send` function — a test passes a list to push onto, the game passes a worker.
 */
export function growerFor(seed: number, country: PatchCountry): Grower {
  const worker = new Worker(new URL('../workers/country.worker.ts', import.meta.url), { type: 'module' });
  const grower = new Grower(seed, country.store, (msg) => worker.postMessage(msg));
  worker.onmessage = (e: MessageEvent<CountryReply>) => {
    if (e.data?.type === 'grown') grower.took(e.data);
  };
  return grower;
}

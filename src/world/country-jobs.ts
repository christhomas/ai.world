import { Grower } from './grower';
import type { CountryReply, CountryRequest } from './countrymessages';
import type { Patchwork } from './patchwork';

/** A platform job transports shared patch parts; the game owns its lifetime. */
export interface CountryGrowthJob {
  send(request: CountryRequest): void;
  listen(reply: (message: CountryReply) => void, failed: () => void): () => void;
  stop(): void;
}

export function createCountryGrower(seed: number, patches: Patchwork, job: CountryGrowthJob): Grower {
  let detach = () => {};
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const failures: unknown[] = [];
    try { detach(); } catch (error) { failures.push(error); }
    try { job.stop(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Country growth job cleanup failed');
  };
  const grower = new Grower(seed, patches, (request) => {
    try { job.send(request); }
    catch { grower.dispose(); } // Growth is optional; Patchwork still grows the square underfoot.
  }, undefined, release);
  try {
    const unlisten = job.listen((message) => grower.took(message), () => grower.dispose());
    // A host may report its failure synchronously while installing the listener.
    if (released) unlisten();
    else detach = unlisten;
  } catch (error) {
    try { grower.dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Country growth job setup failed'); }
    throw error;
  }
  return grower;
}

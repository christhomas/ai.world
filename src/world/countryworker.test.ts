import { afterEach, expect, it, vi } from 'vitest';
import { growerFor } from './countryworker';
import { shutDownGame } from '../game/lifecycle';
import { Patchwork } from './patchwork';
import type { PatchCountry } from './patchcountry';
import type { CountryReply } from './countrymessages';

afterEach(() => vi.unstubAllGlobals());

it('the production Worker adapter is owned by session shutdown, including queued callbacks', () => {
  class TestWorker {
    static instance: TestWorker;
    onmessage: ((event: MessageEvent<CountryReply>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { TestWorker.instance = this; }
  }
  vi.stubGlobal('Worker', TestWorker);
  const store = new Patchwork(11);
  const grower = growerFor(11, { store } as PatchCountry);
  grower.want('0,0'); grower.want('1,0');
  const worker = TestWorker.instance, late = worker.onmessage!;
  shutDownGame({ stop: () => {}, controls: [], disconnect: () => {}, clear: () => {}, resources: [grower] });
  late({ data: { type: 'grown', patch: '0,0', took: 1, parts: {} } } as MessageEvent<CountryReply>);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(store.holding()).toEqual([]);
  expect(grower.waiting).toEqual([]);
});

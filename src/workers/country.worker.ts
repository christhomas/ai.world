import { answerCountry } from '../world/country-answer';
import type { CountryRequest, CountryReply } from '../world/countrymessages';

/** The page's country worker: every request answered by `answerCountry`, off the drawing thread. */
const post = (msg: CountryReply) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<CountryRequest>) => {
  const reply = answerCountry(e.data, () => Date.now());
  if (reply) post(reply);
};

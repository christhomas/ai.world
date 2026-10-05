import { socketLink, workerLink, type Link, type LinkEvents } from '../net/link';

/** Browser composition chooses transport; the shared protocol client never imports it. */
export function browserWorldLink(url: string, events: LinkEvents): Link | null {
  return url ? socketLink(url, events) : workerLink(events);
}

import type { Link, LinkEvents, Parcel } from '../net/link-contract';
import type { Json, ParcelEvent } from '../../shared/mobile/host-contract';

import { fromBase64, toBase64 } from './bytes';

/**
 * A shared world, reached through the app's own socket (#565).
 *
 * An embedded engine has no WebSocket, so the game's `Online` is handed this link for any address
 * that is not the world in this engine. Asking to connect, every parcel sent, and closing are
 * left for the next reply, as `link` and `outbox`; the app opens its socket, sends what was sent,
 * and passes back what the socket does as `parcel` requests. Each connection has a generation, so a
 * socket the game has since replaced or closed cannot speak for the one that came after it.
 */
export class ParcelLink {
  private generation = 0;
  private live: { generation: number; events: LinkEvents; link: { ready: boolean } } | null = null;
  private asked: Json = null;
  private outbox: Json[] = [];

  /** The `WorldLinkFactory` the game is given for a shared world. */
  readonly connect = (url: string, events: LinkEvents): Link | null => {
    if (!url) return null;
    const generation = ++this.generation;
    const link = {
      ready: false,
      send: (parcel: Parcel) => {
        if (this.live?.generation !== generation) return;
        this.outbox.push(typeof parcel === 'string' ? { text: parcel } : { binary: toBase64(new Uint8Array(parcel)) });
      },
      close: () => {
        if (this.live?.generation !== generation) return;
        this.live = null;
        link.ready = false;
        this.outbox = [];
        this.asked = { close: generation };
      },
    };
    // a new connection replaces whatever was asked for before, and drops what it had not sent
    this.live = { generation, events, link };
    this.outbox = [];
    this.asked = { connect: url, generation };
    return link;
  };

  /** What the app's socket did. Anything for a connection that is no longer the live one is dropped. */
  deliver(event: ParcelEvent): void {
    const live = this.live;
    if (!live || live.generation !== event.generation) return;
    if (event.event === 'open') {
      live.link.ready = true;
      live.events.onOpen();
    } else if (event.event === 'message') {
      live.events.onMessage(event.text !== null ? event.text : fromBase64(event.binary).buffer as ArrayBuffer);
    } else {
      this.live = null;
      live.link.ready = false;
      this.outbox = [];
      live.events.onClose(event.why);
    }
  }

  /** What the app is asked to do and send since the last reply, or nothing. */
  take(): { link?: Json; outbox?: Json } {
    const out: { link?: Json; outbox?: Json } = {};
    if (this.asked !== null) { out.link = this.asked; this.asked = null; }
    if (this.outbox.length > 0) { out.outbox = this.outbox; this.outbox = []; }
    return out;
  }
}

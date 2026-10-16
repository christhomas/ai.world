import type { Link, LinkEvents, Parcel } from '../net/link-contract';
import type { Json, ParcelEvent } from '../../shared/mobile/host-contract';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Bytes as base64: what a binary parcel is on a bridge that carries only text. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8) | (i + 2 < bytes.length ? bytes[i + 2] : 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return out;
}

/** Base64 back to bytes. The contract has already refused anything that is not base64. */
function fromBase64(text: string): Uint8Array {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = ((VALUES.get(text[i]) ?? 0) << 18) | ((VALUES.get(text[i + 1]) ?? 0) << 12)
      | ((VALUES.get(text[i + 2]) ?? 0) << 6) | (VALUES.get(text[i + 3]) ?? 0);
    if (at < bytes.length) bytes[at++] = (n >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (n >> 8) & 255;
    if (at < bytes.length) bytes[at++] = n & 255;
  }
  return bytes;
}

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

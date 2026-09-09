/**
 * The way the game talks to the world server, whichever world server it is.
 *
 * Two of them. A `SocketLink` reaches a server across a network, which is what a shared world is. A
 * `WorkerLink` reaches the same simulation running in a thread beside the page, which is what
 * playing alone is now — the same clock, the same market, the same post shelf, the same code,
 * a `postMessage` instead of a frame on the wire.
 *
 * The client above this cannot tell which it has, and that is the point rather than a nicety. The
 * moment it can, single player and multiplayer start being two games that share a repository.
 * `docs/server-authority.md` has the shape of it.
 */
/**
 * What goes over a link.
 *
 * Words for everything the two halves say to each other, and bytes for the one thing they cannot
 * say in words: the world itself. A chunk of country is 3.3 kB of heights and tile kinds, which as
 * numbers in a JSON array is four times that and unreadable at both ends — so it travels as the
 * arrays it already is. A websocket carries either natively and a worker port carries either by
 * transfer, so this is a widening rather than a second channel.
 */
export type Parcel = string | ArrayBuffer;

export interface Link {
  send(parcel: Parcel): void;
  close(): void;
  /** Ready to carry a message. Both kinds start false and say so when they are up. */
  readonly ready: boolean;
}

export interface LinkEvents {
  onOpen: () => void;
  onMessage: (parcel: Parcel) => void;
  /** The other end has gone, or was never there. `why` is for the player, not for a log. */
  onClose: (why: string) => void;
}

/** A world across a network. */
export function socketLink(url: string, events: LinkEvents): Link | null {
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    return null;
  }
  socket.onopen = () => events.onOpen();
  socket.binaryType = 'arraybuffer';
  socket.onmessage = (e) => events.onMessage(e.data instanceof ArrayBuffer ? e.data : String(e.data));
  socket.onclose = () => events.onClose('Disconnected from the server.');
  socket.onerror = () => events.onClose(`Could not reach ${url}.`);
  return {
    send: (parcel) => { if (socket.readyState === WebSocket.OPEN) socket.send(parcel); },
    close: () => socket.close(),
    get ready(): boolean { return socket.readyState === WebSocket.OPEN; },
  };
}

/**
 * A world in the next thread along.
 *
 * There is no handshake to wait for — a worker is up as soon as it is made — but `onOpen` is still
 * announced on a later turn of the loop rather than during construction, because a caller that
 * hears "open" before it has finished connecting is a caller that has to be written twice.
 */
export function workerLink(events: LinkEvents): Link {
  const worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
  let up = false;
  worker.onmessage = (e: MessageEvent<Parcel>) => events.onMessage(e.data);
  worker.onerror = () => events.onClose('The world in this tab stopped.');
  queueMicrotask(() => { up = true; events.onOpen(); });
  return {
    // an ArrayBuffer is handed over rather than copied: the sender loses it, which is what makes a
    // chunk of country cost nothing to pass between threads
    send: (parcel) => worker.postMessage(parcel, parcel instanceof ArrayBuffer ? [parcel] : []),
    close: () => { up = false; worker.terminate(); },
    get ready(): boolean { return up; },
  };
}

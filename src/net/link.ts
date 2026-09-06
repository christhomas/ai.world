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
export interface Link {
  send(text: string): void;
  close(): void;
  /** Ready to carry a message. Both kinds start false and say so when they are up. */
  readonly ready: boolean;
}

export interface LinkEvents {
  onOpen: () => void;
  onMessage: (text: string) => void;
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
  socket.onmessage = (e) => events.onMessage(String(e.data));
  socket.onclose = () => events.onClose('Disconnected from the server.');
  socket.onerror = () => events.onClose(`Could not reach ${url}.`);
  return {
    send: (text) => { if (socket.readyState === WebSocket.OPEN) socket.send(text); },
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
  worker.onmessage = (e: MessageEvent<string>) => events.onMessage(e.data);
  worker.onerror = () => events.onClose('The world in this tab stopped.');
  queueMicrotask(() => { up = true; events.onOpen(); });
  return {
    send: (text) => worker.postMessage(text),
    close: () => { up = false; worker.terminate(); },
    get ready(): boolean { return up; },
  };
}

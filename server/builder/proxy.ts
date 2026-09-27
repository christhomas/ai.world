import type { IncomingMessage } from 'node:http';

/**
 * The retired fixed-address worker setting remains a type so a caller still using it gets an
 * explicit startup error. Connected workers now route through `channel.ts`.
 */

export interface BuilderAt {
  host: string;
  port: number;
  /** What the worker checks. Given to the portal by the deployment, never seen by a page. */
  secret: string;
}

/** Read a body with a ceiling, so a page that has gone wrong is an error rather than a memory leak. */
export async function bodyOf(req: IncomingMessage, most = 16 * 1024): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The signed note that says who is logged in, and for how much longer.
 *
 * HS256 by hand rather than a dependency, and the reason is the same one that keeps playwright out
 * of `package.json`: this file is installed by the Pages build and by the server image, twice, once
 * per architecture. Forty lines of `node:crypto` is cheaper than a supply chain, and a symmetric
 * signature is the right shape anyway — one service signs these and the same service verifies them,
 * so there is no second party to hold a public key.
 *
 * ## Why there is a session row as well
 *
 * A signed token cannot be taken back. That is the whole difficulty with them: logging out of a
 * plain JWT means asking the browser nicely to forget it, and a stolen one keeps working until it
 * expires whatever the server thinks. So every token carries a `jti`, the store keeps a row per
 * session, and logging out deletes the row — the signature still verifies and the session is gone.
 *
 * The token is what makes the *common* case cheap: a request with a valid signature and a live
 * expiry needs one HMAC and no disk. The row is what makes revocation real.
 */

/** What a token says. Short on purpose: a claim nobody reads is a claim that can be wrong. */
export interface Claims {
  /** Who: the account id. */
  sub: string;
  /** This session, so it can be revoked without revoking the account. */
  jti: string;
  /** Seconds since the epoch, both of them, because that is what every other tool expects. */
  iat: number;
  exp: number;
}

/**
 * How long a token is good for.
 *
 * Twelve hours: long enough that somebody using the builder through an afternoon is not asked
 * again, short enough that a token copied off a machine is worthless by the next morning. The
 * session row outlives it slightly so that a logout still has something to delete.
 */
export const TOKEN_LASTS = 12 * 60 * 60;

const b64 = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

function signature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** A new session id, long enough that guessing one is not a strategy. */
export function newSessionId(): string { return randomBytes(18).toString('base64url'); }

/** Sign a note saying this account is logged in until then. */
export function signToken(
  claims: Pick<Claims, 'sub' | 'jti'>, secret: string, now = Math.floor(Date.now() / 1000),
): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...claims, iat: now, exp: now + TOKEN_LASTS } satisfies Claims));
  const signed = `${head}.${body}`;
  return `${signed}.${signature(signed, secret)}`;
}

/**
 * Read a token back, or nothing at all.
 *
 * Nothing rather than a reason, everywhere: a route that tells the internet *why* its token was
 * refused is a route that helps somebody work out what a valid one looks like. The caller has one
 * question — is this person logged in — and one answer is the whole of it.
 *
 * The algorithm in the header is checked against the one we sign with, which is the oldest trap
 * there is: a verifier that trusts the header will happily accept `alg: none`, or verify an RS256
 * token's signature using the public key as an HMAC secret.
 */
export function readToken(
  token: string, secret: string, now = Math.floor(Date.now() / 1000),
): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sent] = parts;
  const want = signature(`${head}.${body}`, secret);
  const a = Buffer.from(sent), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let header: unknown, claims: unknown;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch { return null; }
  if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'HS256') return null;
  if (!claims || typeof claims !== 'object') return null;
  const said = claims as Record<string, unknown>;
  if (typeof said.sub !== 'string' || said.sub === '') return null;
  if (typeof said.jti !== 'string' || said.jti === '') return null;
  if (typeof said.iat !== 'number' || typeof said.exp !== 'number') return null;
  if (said.exp <= now) return null;
  // a token stamped in the future is a clock somebody else is keeping
  if (said.iat > now + 60) return null;
  return { sub: said.sub, jti: said.jti, iat: said.iat, exp: said.exp };
}

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * What a stored password is, which is never the password.
 *
 * `scrypt`, salted per user, with the parameters written into the stored string rather than into a
 * constant somewhere. That is the whole trick and it costs nothing: a hash that carries the cost it
 * was made at can be re-read years later by a version that has raised the cost, and the day the
 * numbers go up the old hashes still verify — they simply get re-made on the next successful login.
 * A cost baked into the verifier instead is a cost nobody can ever change without locking everybody
 * out.
 *
 * Account creation uses the synchronous form because it happens at bootstrap or from an operator
 * command. Login verification uses the asynchronous form below: the work must remain expensive to
 * an attacker without stopping world ticks and every unrelated HTTP request while it runs.
 */

/**
 * How hard to make it, today.
 *
 * `N` is the memory-and-time cost and the only one worth tuning; 2^15 is a few tens of milliseconds
 * and about 32MB per attempt, which is nothing for a person logging in once and a great deal for
 * somebody working through a stolen database. `maxmem` has to be raised to match, because Node's
 * default ceiling is below what N this size asks for and the failure is a thrown error rather than
 * a quiet downgrade.
 */
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;

const maxmemFor = (N: number, r: number): number => 256 * N * r * 2;

/** A password, made into the thing that is safe to keep: `scrypt$N$r$p$salt$hash`, all base64url. */
export function hashPassword(password: string, salt = randomBytes(SCRYPT.saltLength)): string {
  const { N, r, p, keyLength } = SCRYPT;
  const key = scryptSync(password.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: maxmemFor(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

const derive = (
  password: string, salt: Buffer, length: number, cost: { N: number; r: number; p: number },
): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password.normalize('NFKC'), salt, length, { ...cost, maxmem: maxmemFor(cost.N, cost.r) },
    (why, key) => why ? reject(why) : resolve(key));
});

/** The asynchronous form used by request handlers, so one password cannot stop every world tick. */
export async function hashPasswordAsync(
  password: string, salt = randomBytes(SCRYPT.saltLength),
): Promise<string> {
  const { N, r, p, keyLength } = SCRYPT;
  const key = await derive(password, salt, keyLength, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Whether this password made that hash, verified on libuv's crypto pool rather than the event loop.
 * Malformed stored values are `false`, and the derived keys are compared in constant time.
 */
export async function passwordMatchesAsync(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, key] = parts;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;
  if (cost.N < 2 || cost.r < 1 || cost.p < 1) return false;
  let want: Buffer;
  try { want = Buffer.from(key, 'base64url'); } catch { return false; }
  if (want.length === 0) return false;
  try {
    const got = await derive(password, Buffer.from(salt, 'base64url'), want.length, cost);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

/** Whether a stored hash was made at a weaker cost than today's, and should be re-made on login. */
export function wantsRehashing(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT.N || Number(parts[2]) < SCRYPT.r || Number(parts[3]) < SCRYPT.p;
}

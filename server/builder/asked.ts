/**
 * What the builder may be asked, and by whom, decided before anything is spawned.
 *
 * `tools/askclaude.ts` is the same door on a dev server, and its comment is worth reading before
 * this one: *"anything that can post to it can ask Claude for anything Claude's own permissions on
 * this machine allow, in this repository. That is acceptable here and nowhere else — it is a
 * development tool, on the owner's own machine."*
 *
 * This is the "nowhere else" being made somewhere else, so every one of the four things holding
 * that door where it is has to be replaced with something that survives being on a network:
 *
 * | the dev server                     | here                                                  |
 * | ---------------------------------- | ----------------------------------------------------- |
 * | the socket's own remote address    | a signed session the portal issued, and a shared secret |
 * | a header a form cannot send        | the portal is the only thing that can reach the worker |
 * | `--permission-mode acceptEdits`    | the same, in a worktree that is not the checkout        |
 * | the prompt is an argv element      | the same, and bounded, and one at a time                |
 *
 * The decisions live here, apart from the spawning, because they are the part that can be wrong in
 * a way nobody notices until somebody is inside — and the spawning cannot be unit-tested without
 * running Claude.
 */

/**
 * How long a prompt may be.
 *
 * Not a security boundary, and the dev server's comment says why: a short prompt can ask for
 * anything a long one can. What it stops is a page that has gone wrong sending the same thing
 * repeatedly, which is an expensive afternoon rather than an attack. Smaller than the dev server's
 * eight thousand because this one is reached over a network by whoever has a login.
 */
export const LONGEST_PROMPT = 4000;

/** And how long a run may take before it is given up on, in case something is waiting to be asked. */
export const GIVE_UP = 10 * 60 * 1000;

/** What a page asks for: some words, and which thing on screen they are about. */
export interface Asked {
  prompt: string;
  /** The creature or prop the page was showing, for the record rather than for the prompt. */
  about: string;
}

/** Why an ask was refused, in words for the person and never for the page to act on. */
export type Refusal = 'empty' | 'too long' | 'busy';

/**
 * Read what a page posted, or say why not.
 *
 * Trimmed and bounded, and nothing else — no rewriting, no instructions added. The dev server's
 * rule holds here for the same reason: *"it is deliberately a pipe rather than a librarian. A route
 * that quietly added instructions of its own would be a route nobody could reason about."*
 *
 * `about` is cut to something that fits in a log line and is never put in the prompt. It is there
 * so the record of a run says which thing on screen it was about, which is the question anybody
 * reading the audit actually has.
 */
export function whatWasAsked(body: unknown): Asked | Refusal {
  if (!body || typeof body !== 'object') return 'empty';
  const said = body as Record<string, unknown>;
  const prompt = typeof said.prompt === 'string' ? said.prompt.trim() : '';
  if (prompt === '') return 'empty';
  if (prompt.length > LONGEST_PROMPT) return 'too long';
  const about = typeof said.about === 'string' ? said.about.trim().slice(0, 80) : '';
  return { prompt, about };
}

/**
 * One at a time, per worktree.
 *
 * Two runs of `claude --permission-mode acceptEdits` in one working tree is two processes editing
 * the same files with no idea the other exists, and the result is not a conflict anybody is shown —
 * it is one of them writing over the other's edit and reporting success. So a worktree takes one
 * run and refuses the next, rather than queueing it: somebody waiting at a page wants to be told
 * the builder is busy, not to have their prompt run twenty minutes later against a tree that has
 * changed underneath it.
 */
export class OneAtATime {
  private running: string | null = null;

  /** Whether a run is in hand, and whose. */
  get busy(): string | null { return this.running; }

  /** Take the worktree, or be told who has it. */
  take(who: string): boolean {
    if (this.running !== null) return false;
    this.running = who;
    return true;
  }

  /** Give it back. Idempotent, because a run that fails and a run that ends both come through here. */
  release(): void { this.running = null; }
}

/**
 * What is written down about a run, which is what somebody reading the audit needs and nothing
 * more.
 *
 * The issue lists the fields: who, when, what was being looked at, what changed, and whether it
 * worked. What is deliberately absent is the session token and the prompt's own text — the first
 * because a log that carries credentials is a second place to steal them from, and the second
 * because it is the one field that can contain anything at all, including whatever somebody was
 * persuaded to paste into it.
 */
export interface Recorded {
  /** The account id from the portal's session, never the token it rode in. */
  who: string;
  when: number;
  about: string;
  /** How long the prompt was, since the prompt itself is not kept. */
  length: number;
  changed: string[];
  ok: boolean;
  note: string;
}

/**
 * Whether anything in this record could be a secret, asked of the record rather than of the writer.
 *
 * A rule enforced where the data is is a rule that holds when somebody adds a field in a hurry; a
 * rule enforced where the data is written is a comment. This is called on the way into the book.
 */
export function carriesASecret(record: Recorded): boolean {
  const said = [record.who, record.about, record.note, ...record.changed].join(' ');
  // a signed note has three dot-separated base64url parts and is the one shape worth naming
  return /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(said)
    || /\bscrypt\$\d+\$/.test(said);
}

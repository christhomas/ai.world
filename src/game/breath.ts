/**
 * Breath, and putting your arm up.
 *
 * Swinging was free and defence did not exist, so there was exactly one thing to do in a fight and
 * the only question was how fast you could press it. Everything here exists to make that press
 * cost something and to give you something else to spend the moment on.
 *
 * Breath is the meter. A swing costs some, holding a guard drains it, and it comes back only when
 * you are doing neither — so a flurry is affordable and a permanent flurry is not, and backing off
 * for a second is a real move rather than a waste of time.
 *
 * The guard is the decision. Held early it is a block: it takes most of a blow and costs breath.
 * Raised late, in the moment the thing in front of you is already committed to its swing, it is a
 * parry: it takes all of the blow, staggers whoever threw it, and hands the breath back. That is
 * deliberately the harder and better option, because the whole complaint about this fight was that
 * there was nothing in it to get good at.
 */

export const BREATH = {
  /** A full chest. */
  MOST: 100,
  /** What one swing costs, so about four of them empty you. */
  SWING: 23,
  /** What holding a guard costs a second. */
  GUARD: 26,
  /** And what comes back a second once you stop doing both. */
  RECOVERS: 38,
  /** How long after the last exertion before any of it comes back. */
  CATCH: 0.5,
  /**
   * How long a guard counts as freshly raised, in seconds.
   *
   * This is the width of the whole skill. Long enough that a person reacting to a wind-up can make
   * it, short enough that holding the key down never does — hold the guard from before the blow
   * was thrown and the window has passed, so you block instead of parrying. You cannot get the
   * good outcome by keeping it pressed, which is the entire point.
   */
  PARRY_WINDOW: 0.3,
  /** What a blow that lands on a raised guard is worth, as a share. */
  BLOCKED: 0.35,
  /** What a parry hands back, as a share of a full chest. Less than a swing, so it is not free. */
  PARRY_REFUND: 0.18,
  /** How long a parried creature is left flat-footed. Long enough for two swings. */
  STAGGER: 1.1,
  /** Below this share of a chest, a swing is a tired one. */
  WINDED: 0.2,
  /** And what a tired swing is worth. Feeble, not nothing: being out of breath is not being unarmed. */
  TIRED: 0.45,
  /** How much of your pace a raised guard costs you. */
  GUARDED_PACE: 0.45,
} as const;

/** What a blow that arrived while the guard was up came to. */
export type Answered = 'parried' | 'blocked' | 'open';

export class Breath {
  private left: number = BREATH.MOST;
  /** Seconds since the last thing that cost breath, for the pause before it comes back. */
  private since: number = BREATH.CATCH;
  /** How long the guard has been up, or null when it is down. */
  private raised: number | null = null;

  /** How full the chest is, nought to one. For the HUD, and for deciding a swing is a tired one. */
  get share(): number { return this.left / BREATH.MOST; }
  get guarding(): boolean { return this.raised !== null; }
  get winded(): boolean { return this.share < BREATH.WINDED; }

  /** Time passing: the guard ages, and breath comes back when nothing is spending it. */
  age(dt: number): void {
    if (this.raised !== null) {
      this.raised += dt;
      this.left = Math.max(0, this.left - BREATH.GUARD * dt);
      this.since = 0;
      // nothing left to hold it up with: the guard drops on its own, and you have to raise it again
      if (this.left <= 0) this.raised = null;
      return;
    }
    this.since += dt;
    if (this.since >= BREATH.CATCH) this.left = Math.min(BREATH.MOST, this.left + BREATH.RECOVERS * dt);
  }

  /** Put the arm up, if it is not up already. Ignored when there is nothing left to hold it with. */
  raise(): void {
    if (this.raised !== null || this.left <= 0) return;
    this.raised = 0;
  }

  /** And take it down. */
  drop(): void {
    this.raised = null;
    this.since = 0;
  }

  /**
   * Throw a swing. Returns what it is worth as a share of a full-strength one: one when there was
   * breath for it, less when there was not.
   *
   * A winded swing still happens. Refusing it outright reads as the controls being broken, and
   * anybody out of breath in front of a bear is going to swing anyway.
   */
  swing(): number {
    const tired = this.winded;
    this.left = Math.max(0, this.left - BREATH.SWING);
    this.since = 0;
    this.raised = null;   // you cannot swing from behind your own guard
    return tired ? BREATH.TIRED : 1;
  }

  /**
   * A blow arrives. Says what the guard made of it and takes the cost out of the chest.
   *
   * The whole of the skill is in the first line: a guard that went up in the last fraction of a
   * second is a parry, and one that has been held since before the blow was thrown is only a block.
   */
  answer(): Answered {
    if (this.raised === null) return 'open';
    if (this.raised <= BREATH.PARRY_WINDOW) {
      this.left = Math.min(BREATH.MOST, this.left + BREATH.MOST * BREATH.PARRY_REFUND);
      this.raised = null;   // the parry spends the guard: you have to raise it for the next one
      return 'parried';
    }
    // a block soaks it with the body behind the arm, and that costs
    this.left = Math.max(0, this.left - BREATH.SWING);
    if (this.left <= 0) this.raised = null;
    return 'blocked';
  }

  /** What a blow is worth after the guard has had its say. */
  static after(answered: Answered, damage: number): number {
    if (answered === 'parried') return 0;
    if (answered === 'blocked') return Math.max(1, Math.round(damage * BREATH.BLOCKED));
    return damage;
  }

  /** Filled right back up: waking after a knockout, or a night's sleep. */
  refill(): void {
    this.left = BREATH.MOST;
    this.since = BREATH.CATCH;
    this.raised = null;
  }
}

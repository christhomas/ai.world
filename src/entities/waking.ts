/**
 * The hours a village keeps.
 *
 * One constant and one question, kept apart from `entity.ts` because they are about the clock
 * rather than about a body: a shop counter asks whether it is open, a haunt asks whether it is out,
 * and neither of them is an entity. `entity.ts` reached the length a person can hold in their head
 * and this was the part of it that was never entities.
 */

/** Villagers are out between these times; outside them they head home and stay in. */
export const AWAKE = [0.27, 0.82] as const;

/** Is it the part of the day when people are about? `time` is a fraction of one day. */
export function isDaytime(time: number): boolean {
  return time >= AWAKE[0] && time < AWAKE[1];
}

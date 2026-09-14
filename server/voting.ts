import type { WorldDelta } from './protocol';
import { bodyOfTheHall } from '../src/world/hall';
import type { Register } from '../src/world/register';
import { doorTile, type Village } from '../src/world/structures';

/** A hall conversation reaches a few paces beyond its doorstep, and no farther. */
export const AT_THE_HALL = 2.2;

interface VoteContext {
  register: Register;
  village: Village;
  hero: { x: number; z: number };
  day: number;
  commit: (vote: Extract<WorldDelta, { kind: 'voted' }>) => boolean;
}

/**
 * Call the next civic vote at the hall the world says this hero is standing beside.
 *
 * The client supplies only a village name. Rank, day, electorate, treasury, hall body and position
 * all come from the authoritative world; the resulting fact is committed before the register
 * spends a coin.
 */
export function callTownVote(ctx: VoteContext): Extract<WorldDelta, { kind: 'voted' }> | null {
  const { register, village, hero } = ctx;
  const hall = register.hallOf(village.name);
  const body = bodyOfTheHall(hall, village.houses, register.living(village.name), village.hall?.building);
  if (!body) return null;
  const [x, z] = doorTile(body);
  if (Math.hypot(hero.x - x, hero.z - z) > AT_THE_HALL) return null;

  const ballot = register.ballotOf(village.name);
  if (!ballot?.ready) return null;
  const vote = { kind: 'voted', village: village.name, rank: ballot.rank, day: Math.floor(ctx.day) } as const;
  if (!ctx.commit(vote)) return null;
  return register.apply(vote) ? vote : null;
}

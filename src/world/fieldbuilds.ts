import { A_CREW_TAKES, A_DAY_OF_BUILDING, whoIsPaidToRaiseIt } from './founding';
import { FIELD, fieldOfWork, fieldRoomFor, fieldWork, fieldsAt, type FieldTile } from './fields';
import { isTheHall, ownedBy, type Holding, type Owner } from './holdings';
import type { Person } from './people';
import { PROSPER } from './prosperity';
import type { Settlement } from './settlement';
import type { TerrainSampler } from './terrain';
import type { Village } from './structures';

/** Clearing one acre is one house-room's share of the same building crew. */
export const FIELD_CLEARING_COST = A_CREW_TAKES * A_DAY_OF_BUILDING;

export interface FieldClearing extends FieldTile {
  holding: string;
  payer: Owner;
  costs: number;
  wages: Map<Owner, number>;
  work: string;
}

/**
 * The one farm that clears ground this morning, or none.
 *
 * A family improves its own holding and keeps a week's dinners after paying. Richest first makes
 * the choice deterministic and gives a second farm its turn once the first reaches the local cap.
 * The crew is exactly the crew a roof uses: builders where the village has them, working neighbours
 * where it does not. One farm per village per morning is the visible pace, not a loop over purses.
 */
export function whichFieldClears(
  village: Village,
  settlement: Settlement,
  sampler: TerrainSampler,
): FieldClearing | null {
  const already = new Set(settlement.works.map(fieldOfWork)
    .filter((field): field is NonNullable<typeof field> => field !== null)
    .map((field) => `${field.x},${field.z}`));
  const candidates: Array<{ holding: Holding; payer: Person }> = [];
  for (const holding of settlement.holdings ?? []) {
    if (holding.kind !== 'farm' || isTheHall(holding.owner)
      || fieldsAt(settlement.works, holding.id) >= FIELD.MOST) continue;
    const payer = settlement.people.find((person) => ownedBy(person) === holding.owner);
    if (!payer || payer.purse - FIELD_CLEARING_COST < PROSPER.KEEPS_BACK) continue;
    candidates.push({ holding, payer });
  }
  candidates.sort((a, b) => b.payer.purse - a.payer.purse || a.holding.id.localeCompare(b.holding.id));

  for (const candidate of candidates) {
    const tile = fieldRoomFor(sampler, village, candidate.holding, settlement.people)
      .find((at) => !already.has(`${at.x},${at.z}`));
    if (!tile) continue;
    const wages = whoIsPaidToRaiseIt(settlement.people, FIELD_CLEARING_COST);
    if (!wages) return null;
    return {
      holding: candidate.holding.id,
      payer: ownedBy(candidate.payer),
      costs: FIELD_CLEARING_COST,
      wages,
      x: tile.x,
      z: tile.z,
      work: fieldWork(candidate.holding.id, tile.x, tile.z),
    };
  }
  return null;
}

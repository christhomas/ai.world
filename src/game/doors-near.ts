import type { Doorway } from '../world/structures';

/**
 * The doors nearest somebody, for `doors` at the console (#684): where to stand outside each and the
 * building it opens, nearest first. What a player who cannot see a door from where they stand asks,
 * and what the device playtest walks into by touch.
 */
export function doorsNear(doors: readonly Doorway[], x: number, z: number, like?: string, many = 5) {
  // a word narrows it to a kind of building or a village: `doors store`, `doors blackby`
  const asked = like?.trim().toLowerCase();
  return doors
    .filter((door) => !asked || door.kind === asked || door.village.toLowerCase().includes(asked))
    .map((door) => ({ door, away: Math.hypot(door.x + 0.5 - x, door.z + 0.5 - z) }))
    .sort((a, b) => a.away - b.away)
    .slice(0, many)
    .map(({ door, away }) => ({
      name: `${door.kind} in ${door.village}`, away: Math.round(away), x: door.x, z: door.z, bx: door.bx, bz: door.bz,
    }));
}

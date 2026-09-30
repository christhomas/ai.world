/**
 * Pick a house side with a clear ten-tile horse approach, while retaining a four-tile foot fallback.
 * Null when no side has even a clear four-tile foot walk that stays off the doorsteps.
 */
function chooseHouseApproach(
  { x, z, rot }, solid = globalThis.__solid,
  grounded = (px, pz) => globalThis.__player?.ground?.heightAt(px, pz) !== null,
  crowd = globalThis.__entitiesFull?.() ?? [],
  doors = globalThis.__doors ?? [],
) {
  // `stride` walks round both ground props and people/animals. A ray clear of buildings can still
  // end several tiles short if it starts through a cow or villager. Leave enough room for the horse
  // body around every sampled point and choose another side before blaming the house wall.
  const crowdClear = (px, pz) => crowd.every((e) => e.dead || e.role === 'mount' ||
    Math.hypot(e.x - px, e.z - pz) >= 1.8);
  // A walk that ends on a doorstep goes indoors instead of meeting the wall, and indoors the hero
  // stands in the room's own coordinates, so the check read "moved 86 tiles" whenever the door had
  // armed in time. Keep every approach's foot walk, from four tiles out to the wall, clear of doors.
  const doorClear = (angle) => doors.every((door) => {
    for (let step = 4; step >= 0.5; step -= 0.25) {
      if (Math.hypot(x - Math.cos(angle) * step - door.x, z - Math.sin(angle) * step - door.z) < 1.5) return false;
    }
    return true;
  });
  let footOnly = null;
  for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
    const angle = rot + turn;
    const from = { x: x - Math.cos(angle) * 4, z: z - Math.sin(angle) * 4, angle };
    const clear = (far, wide) => {
      for (let step = far; step >= 2.8; step -= 0.2) {
        // `blocked` asks about a point, not the mounted box. Sample out to the horse's half-width
        // plus a margin so scenery the body would overlap cannot sit just beyond a clear centre ray.
        for (const side of wide ? [-1, -0.55, 0, 0.55, 1] : [0]) {
          const px = x - Math.cos(angle) * step - Math.sin(angle) * side;
          const pz = z - Math.sin(angle) * step + Math.cos(angle) * side;
          if (solid(px, pz) || !grounded(px, pz) ||
              (Math.hypot(px - x, pz - z) > 4 && !crowdClear(px, pz))) return false;
        }
      }
      return true;
    };
    if (!doorClear(angle) || !clear(4, false)) continue;
    if (clear(10, true)) return { ...from, fullRay: true };
    if (!footOnly) footOnly = { ...from, fullRay: false };
  }
  // No side is safe. The front is the side most likely to hold the door, so falling back to it
  // walked the hero indoors and blamed the wall. Say so, and let the caller try another house.
  return footOnly;
}

/** Prefer a nearby door that already has ground under its outside tile. */
function chooseGroundedDoors(
  doors = globalThis.__doors, player = globalThis.__player,
  heightAt = (x, z) => globalThis.__player.ground.heightAt(x, z),
  solid = globalThis.__solid,
) {
  return doors.filter((door) => heightAt(door.x, door.z) !== null && !solid(door.x, door.z))
    .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
}

module.exports = { chooseHouseApproach, chooseGroundedDoors };

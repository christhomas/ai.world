import * as THREE from 'three';
import { WORLD } from '../../core/config';
import { FERRY, ferryStateAt, formatCountdown, worldSeconds, type FerryLine } from '../ferry';
import { BOAT } from '../sailing';
import type { Surroundings } from './context';

/**
 * Getting about by water: the ferries that run to their own timetable, and a boat of your own.
 * The ferry ride lives here too, because who is aboard is nobody else's business.
 */
export function travelInteractions(ctx: Surroundings) {
  const { player, state, structures, chunks, dialogue, hud, sound, sailing, ferries, persist } = ctx;

  const dockTile = (line: FerryLine, end: 'from' | 'to'): [number, number] => {
    const pier = end === 'from' ? line.fromPier : line.toPier;
    const [x, z] = pier.tiles[pier.tiles.length - 1];
    return [x + 0.5, z + 0.5];
  };

  /** Board a docked ferry, or read the timetable at a pier. Returns false if no ferry is nearby. */
  const tryFerry = (): boolean => {
    const now = worldSeconds(state.day, state.time);
    for (const { line } of ferries) {
      const st = ferryStateAt(line, now);
      const nearBoat = Math.hypot(st.x - player.x, st.z - player.z) < FERRY.BOARD_RANGE;
      const nearFrom = Math.hypot(line.fromPier.dockX + 0.5 - player.x, line.fromPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      const nearTo = Math.hypot(line.toPier.dockX + 0.5 - player.x, line.toPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      if (st.docked && nearBoat) {
        const dest = st.docked === 'from' ? 'to' : 'from';
        const destName = dest === 'to' ? line.toName : line.fromName;
        dialogue.start({
          speaker: 'Ferryman', emoji: '⛵',
          pages: [`Ferry to ${destName}. We cast off in ${formatCountdown(st.departsIn)}. Coming aboard?`],
          choices: [
            { label: 'Board', next: () => { riding = { line, dest }; player.riding = true; sound.chime(); return null; } },
            { label: 'Not now', next: () => null },
          ],
        });
        return true;
      }
      if (nearFrom || nearTo) {
        const here = nearFrom ? 'from' : 'to';
        const destName = here === 'from' ? line.toName : line.fromName;
        dialogue.start({ speaker: 'Timetable', emoji: '🪧', pages: [`Ferry to ${destName}: next boat in ${formatCountdown(st.arrivesIn[here])}.`] });
        return true;
      }
    }
    return false;
  };

  /** Enter at a pier or beside your own boat: buy one, cast off, or step ashore. */
  const tryBoat = (): boolean => {
    if (sailing.sailing) {
      const spot = sailing.land(chunks);
      if (!spot) { hud.flash('No shore within reach. Steer closer to land.'); return true; }
      player.teleport(spot[0], spot[1]);
      hud.flash('You step ashore and haul the boat up.');
      sound.select();
      persist();
      return true;
    }
    if (sailing.near(player.x, player.z)) {
      sailing.board();
      hud.flash('You cast off. W and S to row, A and D to steer, Enter to land.');
      sound.chime();
      return true;
    }
    // a pier is where boats are sold
    const pier = structures.piers.find((p) => Math.hypot(p.dockX + 0.5 - player.x, p.dockZ + 0.5 - player.z) < 4);
    if (!pier || sailing.bought) return false;
    dialogue.start({
      speaker: 'Boatwright', emoji: '🛶',
      pages: [`A little sailing boat, sound enough for these waters. ${BOAT.PRICE} gold and she is yours to take anywhere.`],
      choices: [
        { label: `Buy the boat (${BOAT.PRICE}g)`, next: () => {
          if (state.inventory.gold < BOAT.PRICE) {
            return { speaker: 'Boatwright', emoji: '🛶', pages: [`Come back with ${BOAT.PRICE} gold.`] };
          }
          state.inventory.gold -= BOAT.PRICE;
          state.version++;
          sailing.buy(pier.dockX + 0.5 + pier.dx, pier.dockZ + 0.5 + pier.dz, Math.atan2(-pier.dz, pier.dx));
          sound.jingle();
          hud.flash('The boat is yours, moored at the end of the pier.');
          persist();
          return null;
        } },
        { label: 'Another time', next: () => null },
      ],
    });
    return true;
  };

  /** The ferry the hero is riding, and which end they are bound for. */
  let riding: { line: FerryLine; dest: 'from' | 'to' } | null = null;
  const aboard = (): boolean => riding !== null;

  /**
   * Ferries follow the clock rather than any simulation, so their position is a function of the
   * time. A rider is carried along with the boat and put ashore when it ties up.
   */
  const sailFerries = (now: number, time: number): void => {
    for (const { line, mesh } of ferries) {
      const st = ferryStateAt(line, now);
      mesh.position.x = st.x; mesh.position.z = st.z;
      mesh.position.y = WORLD.WATER_Y - 0.12 + Math.sin(time * 1.3 + st.x) * 0.03;
      mesh.rotation.y = st.yaw;
      if (!riding || riding.line !== line) continue;

      player.entity.x = st.x + 0.2; player.entity.z = st.z; player.entity.y = WORLD.WATER_Y + FERRY.DECK_HEIGHT;
      player.entity.yaw = st.yaw;
      if (st.docked !== riding.dest) continue;

      const [dx, dz] = dockTile(line, riding.dest);
      riding = null;
      player.riding = false;
      player.teleport(dx, dz);
      hud.flash(`Arrived at ${st.docked === 'to' ? line.toName : line.fromName}`);
      sound.jingle();
      persist();
    }
  };

  return { tryFerry, tryBoat, sailFerries, aboard };
}

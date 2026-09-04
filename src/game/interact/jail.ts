import { REACH } from '../places';
import { clockAt, hoursSaid, type Jail } from '../jail';
import type { Surroundings } from './context';

/**
 * What Enter does at the door of a village police station: look in, and see who the village is
 * holding and how much longer it has him.
 *
 * The station takes `jail` on top of the ordinary surroundings, which is the one thing here that
 * nothing else needs yet. Looking in never opens anything: the cell answers questions and that is
 * all, so the only ways out of it remain the hour on the clock and somebody taking the roof off.
 */
export function jailInteractions(ctx: Surroundings & { jail: Jail }) {
  const { player, state, structures, jail, dialogue } = ctx;

  /** Enter at the cell door: whoever is behind it, or the reason there is nobody. */
  const tryCell = (): boolean => {
    for (const village of structures.villages) {
      const station = village.station;
      if (!station) continue;
      if (Math.hypot(station.doorX + 0.5 - player.x, station.doorZ + 0.5 - player.z) > REACH.BUILDING_DOOR) continue;

      const speaker = `${village.name} Station`;
      if (jail.lawless(village.name, state.day)) {
        const days = Math.max(1, Math.ceil(jail.standingAgain(village.name) - state.day));
        dialogue.start({ speaker, emoji: '🔓', pages: [
          'The door is off its hinges and there is sky where the cell roof was. Whoever was in here is long gone.',
          `Timber is stacked in the street. Another ${days} day${days === 1 ? '' : 's'} before anybody is held here again.`,
        ] });
        return true;
      }

      const held = jail.holds(village.name, clockAt(state));
      dialogue.start({ speaker, emoji: '🔒', pages: held
        ? [
          `${held.who} is on the bench behind the grille, and does not look up.`,
          `${hoursSaid(jail.hoursLeft(village.name, clockAt(state)))} of it left, out of ${hoursSaid(held.hours)}.`,
        ]
        : ['Clean straw, a cold stove, and the key on a nail where anybody can see it. Nobody is being held here.'],
      });
      return true;
    }
    return false;
  };

  return { tryCell };
}

import * as THREE from 'three';
import { WORLD } from '../../core/config';
import { FERRY, ferryStateAt, formatCountdown, worldSeconds, type FerryLine } from '../ferry';
import { BOAT } from '../sailing';
import { EYRIE, SKYWARD, eyrieAt, tooHeavy, tooDear } from '../eyries';
import { ITEMS } from '../items';
import { LOFT, NOWHERE_TO_SEND, loftFlights, type Destination } from '../loft';
import { chunkKey } from '../../world/spatial';
import type { SkyIsland } from '../../world/skyisland';
import type { Surroundings } from './context';

/**
 * Getting about by water: the ferries that run to their own timetable, and a boat of your own.
 * The ferry ride lives here too, because who is aboard is nobody else's business.
 *
 * And getting about by air, which is the same idea and belongs beside it: the crag with an eagle
 * on it that crosses a mountain range, the birds at the foot of a waterfall coming out of the sky
 * that go up through the cloud instead, and the loft at the top of that fall which will send you
 * back down anywhere you have already been.
 */
export function travelInteractions(ctx: Surroundings) {
  const { player, state, structures, chunks, dialogue, hud, sound, sailing, ferries, eyries, persist } = ctx;
  const { skies, mount, discovered } = ctx;

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

  /**
   * A crag with an eagle on it. It will carry you over the range and put you down on the far
   * side, which is the only way across a mountain that is not a day's walk round it.
   */
  const tryEagle = (): boolean => {
    const here = eyrieAt(eyries, player.x, player.z);
    if (!here) return false;
    const there = eyries.find((e) => e.id === here.partner);
    if (!there) return false;

    if (state.inventory.gold < here.fare) {
      dialogue.start({ speaker: 'Eagle', emoji: '🦅', pages: [tooDear(here, state.inventory.gold)] });
      return true;
    }
    dialogue.start({
      speaker: 'Eagle', emoji: '🦅',
      pages: [`It is bigger than a horse and it has been watching you climb. Over the range to ${there.name}, ${here.fare} gold?`],
      choices: [
        {
          label: `Fly (${here.fare}g)`,
          next: () => {
            state.inventory.gold -= here.fare;
            state.version++;
            player.teleport(there.x, there.z);
            sound.chime();
            hud.flash(`Over the clouds, and down at ${there.name}.`);
            persist();
            return null;
          },
        },
        { label: 'Walk round', next: () => null },
      ],
    });
    return true;
  };

  /**
   * The birds standing in the spray at the foot of a waterfall that comes out of the sky.
   *
   * This is the only way up to a village in the clouds, and it is at the bottom of the fall rather
   * than on a mountain crag because a world can be grown with no range in it worth an eagle — every
   * road-tree world is — and a place you can see from the ground and cannot reach in most of the
   * worlds anybody plays is worse than no place at all.
   */
  const trySkyward = (): boolean => {
    const isle = skies.calledFrom(player.x, player.z);
    if (!isle) return false;
    dialogue.start({
      speaker: 'Eagle', emoji: '🦅',
      pages: [
        'Half a dozen of them stand in the spray with their backs to it. Follow the water up with your eye: it comes down out of nothing, and there is an island where the sky ought to be.',
        `${SKYWARD.FARE} gold and one of them will take you up to ${isle.name}. Coming back down costs nothing — they like the way down.`,
      ],
      choices: [
        { label: `Fly up (${SKYWARD.FARE}g)`, next: () => climb(SKYWARD.FARE, isle, { x: player.x, z: player.z }) },
        { label: 'Stand and watch', next: () => null },
      ],
    });
    return true;
  };

  const bird = (line: string) => ({ speaker: 'Eagle', emoji: '🦅', pages: [line] });

  /**
   * The flight up, once whoever is going is on their own two feet.
   *
   * Two things can still stop it and each says which one it was and by how much, because a bird
   * that simply refuses teaches nobody anything — least of all somebody who has walked to the
   * falls with ninety gold and eight loads of timber.
   */
  const lift = (fare: number, isle: SkyIsland, from: { x: number; z: number }) => {
    const load = tooHeavy(state.inventory.items);
    if (load) {
      const worst = ITEMS[load.worst]?.name ?? load.worst;
      return bird(`It spreads its wings, thinks better of it, and folds them. That pack weighs ${load.weight} to a bird that can lift ${SKYWARD.LIFT}, and the ${worst.toLowerCase()} is most of it.`);
    }
    if (state.inventory.gold < fare) return bird(`${fare} gold to go up, and you have ${state.inventory.gold}.`);
    state.inventory.gold -= fare;
    state.version++;
    skies.fly(isle, from);
    return null;
  };

  /** And the horse, which is the one piece of luggage that can be argued with. */
  const climb = (fare: number, isle: SkyIsland, from: { x: number; z: number }) => {
    if (!mount.riding) return lift(fare, isle, from);
    return {
      ...bird('It looks at the horse, and then at you, and does not move. The horse is not coming.'),
      choices: [
        { label: 'Get down and fly', next: () => { mount.dismount(player, chunks); return lift(fare, isle, from); } },
        { label: 'Ride on', next: () => null },
      ],
    };
  };

  /**
   * Enter, up in the clouds: the crag the bird waits on, or the loft's door.
   *
   * Nothing else on the island answers, which is on purpose — the hero is standing directly over
   * an island with its own villages and its own doors on it, and without this the whole ground-
   * level chain would happily open a door twenty-six units below their feet.
   */
  const trySky = (): boolean => {
    const isle = skies.aloft;
    if (!isle) return false;
    if (skies.atLoft(player.x, player.z)) { openLoft(); return true; }
    if (!skies.atPerch(player.x, player.z)) return false;
    dialogue.start({
      speaker: 'Eagle', emoji: '🦅',
      pages: ['The bird shifts along the crag and turns its head to the drop. It will take you back down for nothing; it wants to be flying, not to be paid.'],
      choices: [
        { label: 'Go back down', next: () => { skies.descend(); return null; } },
        { label: 'Stay a while', next: () => null },
      ],
    });
    return true;
  };

  /** Everywhere the loft could send a bird: the country's villages, and the landmarks on it. */
  const abroad = (): Destination[] => [
    ...structures.villages.map((v) => ({ name: v.name, x: v.x, z: v.z })),
    ...structures.pois.map((p) => ({ name: p.name, x: p.x, z: p.z })),
  ];

  /**
   * Somewhere counts as been-to when its ground has been walked over, which the explored map
   * already records, or when it has been named outright. Villages are never "discovered" the way
   * a shrine is — you simply arrive in one — so asking the discovery set alone would have offered
   * the hero nothing but ruins and caves.
   */
  const beenTo = (place: Destination): boolean =>
    discovered.has(place.name)
    || state.explored.has(chunkKey(Math.floor(place.x / WORLD.CHUNK_SIZE), Math.floor(place.z / WORLD.CHUNK_SIZE)));

  const openLoft = (): void => {
    const isle = skies.aloft;
    if (!isle) return;
    const flights = loftFlights({ x: isle.site.x, z: isle.site.z }, abroad(), beenTo);
    if (flights.length === 0) {
      dialogue.start({ speaker: 'Loftkeeper', emoji: '🪶', pages: [NOWHERE_TO_SEND] });
      return;
    }
    dialogue.start({
      speaker: 'Loftkeeper', emoji: '🪶',
      pages: [
        'Forty birds in here and not one of them has ever seen a road. They do not need one.',
        `Name a place you have stood in and one of them will take you to it. ${LOFT.FARE_BASE} gold and a little more for the distance — and you walk back to a crag and pay to come up again, mind, so choose somewhere worth going.`,
      ],
      choices: [
        ...flights.map((f) => ({
          label: `${f.name} — ${f.tiles} tiles (${f.fare}g)`,
          next: () => {
            if (state.inventory.gold < f.fare) {
              return { speaker: 'Loftkeeper', emoji: '🪶', pages: [`${f.fare} gold for that one, and you have ${state.inventory.gold}.`] };
            }
            state.inventory.gold -= f.fare;
            state.version++;
            skies.descend({ x: f.x, z: f.z }, `The bird sets you down at ${f.name} and is gone before you have your feet.`);
            return null;
          },
        })),
        { label: 'Not today', next: () => null },
      ],
    });
  };

  return { tryFerry, tryBoat, tryEagle, trySkyward, trySky, sailFerries, aboard };
}

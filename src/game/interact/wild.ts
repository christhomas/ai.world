import { mulberry32 } from '../../core/rng';
import { ITEMS } from '../items';
import { StructureKind } from '../../world/structures';
import { CROPS, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from '../farming';
import { FISHING } from '../fishing';
import { Digging, groundOf, seamAt, type Ground } from '../digging';
import { GRAPH } from '../../core/config';
import { villageAt } from '../../world/structures';
import type { Surroundings } from './context';

/**
 * What Enter does out in the country: the way underground, a wreck's hold, a campfire to sleep
 * by, a line cast into water, a furrow to sow or reap, and a hole dug in a hillside.
 */
export function wildInteractions(ctx: Surroundings) {
  const {
    player, state, structures, sampler, chunks, manifest, places, remains,
    dialogue, hud, sound, fishing, plots, online, seed, raining, discover, persist,
  } = ctx;

  /**
   * The holes dug this sitting. It lives here rather than in the world because what a tile holds
   * is derivable from the seed: every player works it out for themselves, and nobody has to be
   * told about anybody else's hole.
   */
  const digging = new Digging();

  /** Enter/Space at a shrine or a cave mouth offers the way underground. */
  const tryShrine = (): boolean => {
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Shrine || Math.hypot(poi.x - player.x, poi.z - player.z) > 3) continue;
      dialogue.start({ speaker: poi.name, emoji: '⛩️', pages: ['Worn steps lead down beneath the stones. Descend?'], choices: [
        { label: 'Descend', next: () => { places.enterDungeon(poi); return null; } },
        { label: 'Not now', next: () => null },
      ] });
      return true;
    }
    for (const cave of structures.caves) {
      if (Math.hypot(cave.x - player.x, cave.z - player.z) > 3.2) continue;
      discover(cave.name);
      dialogue.start({ speaker: cave.name, emoji: '🕳️', pages: ['A cold draught comes out of the dark. Go in?'], choices: [
        { label: 'Go in', next: () => { places.enterDungeon(cave, 'cave', `cave:${cave.id}`); return null; } },
        { label: 'Not now', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  /**
   * A pack lying in the grass where somebody was killed. Going through it is a small, grubby
   * decision the game does not moralise about — though something else might, later.
   */
  const tryRemains = (): boolean => {
    const pack = remains.nearest(player.x, player.z);
    if (!pack) return false;
    const named = pack.items.map((id) => ITEMS[id]?.name ?? id);
    const worth = [pack.gold > 0 ? `${pack.gold} gold` : '', ...named].filter(Boolean);
    dialogue.start({
      speaker: `${pack.who}'s pack`,
      emoji: '🎒',
      pages: [
        `Whatever took ${pack.who} did not want the pack. ${worth.length ? `There is ${worth.join(', ')} in it.` : 'It is empty.'}`,
      ],
      choices: [
        { label: worth.length ? 'Take it' : 'Leave it', next: () => {
          const took = remains.take(pack);
          state.inventory.gold += took.gold;
          for (const id of took.items) state.give(id, 1);
          state.version++;
          if (worth.length) { sound.chime(); hud.flash(`Took ${worth.join(', ')} from ${pack.who}'s pack`); }
          persist();
          return null;
        } },
        { label: 'Leave it be', next: () => null },
      ],
    });
    return true;
  };

  /** A wreck's hold can be looted once; the anchor remembers it. */
  const tryWreck = (): boolean => {
    for (const wreck of structures.wrecks) {
      if (Math.hypot(wreck.x - player.x, wreck.z - player.z) > 3.4) continue;
      discover(wreck.name);
      const anchor = manifest.ensure(`wreck:${wreck.id}`, 'wreck', wreck.x, wreck.z);
      const lootId = `${anchor.id}:hold`;
      if (state.opened.has(lootId)) {
        dialogue.start({ speaker: wreck.name, emoji: '🚢', pages: ['Picked clean. Only sand and barnacles now.'] });
        return true;
      }
      dialogue.start({ speaker: wreck.name, emoji: '🚢', pages: ['The hold is half buried, but the hatch still gives. Search it?'], choices: [
        { label: 'Search', next: () => {
          const roll = mulberry32(anchor.seed);
          const gold = 25 + Math.floor(roll() * 60);
          state.inventory.gold += gold;
          const prizes = ['rod', 'rope', 'lantern', 'map', 'potion', 'gem', 'cap'].filter((p) => !state.owns(p) || p === 'potion' || p === 'gem');
          const prize = prizes[Math.floor(roll() * prizes.length)];
          let extra = '';
          if (prize) { state.give(prize, 1); extra = ` and ${ITEMS[prize].emoji} ${ITEMS[prize].name}`; }
          state.opened.add(lootId);
          state.version++;
          sound.chime();
          hud.flash(`Salvaged ${gold} gold${extra}`);
          persist();
          return null;
        } },
        { label: 'Leave it', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  /** Rest at a campfire: sleep to dawn, fully healed. */
  const tryCampfire = (): boolean => {
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Campfire || Math.hypot(poi.x - player.x, poi.z - player.z) > 3) continue;
      dialogue.start({ speaker: poi.name, emoji: '🔥', pages: ['The embers are still warm. Rest here until dawn?'], choices: [
        { label: 'Rest', next: () => { state.rest(); sound.chime(); hud.flash('You sleep by the fire and wake at dawn.'); persist(); return null; } },
        { label: 'Move on', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  /** Water within reach of the hero, or null. */
  const waterNearby = (): [number, number] | null => {
    for (let r = 1; r <= FISHING.REACH; r += 0.6) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = player.x + Math.cos(ang) * r, z = player.z + Math.sin(ang) * r;
        if (chunks.waterAt(x, z) !== null || (!chunks.heightAt(x, z) && sampler.probe(x, z).land === false && Math.hypot(x, z) < GRAPH.RADIUS + 40)) {
          if (chunks.waterAt(x, z) !== null) return [x, z];
        }
      }
    }
    return null;
  };

  const tryFish = (): boolean => {
    if (!fishing.active && !state.can('fish')) {
      // carrying a rod is not the same as holding one
      if (state.has('rod') && waterNearby()) {
        hud.flash('Hold the fishing rod in your off hand to cast (I).');
        return true;
      }
      return false;
    }
    if (fishing.active) {
      const caught = fishing.strike();
      if (caught) {
        state.give(caught.id, 1);
        sound.jingle();
        hud.flash(`Caught a ${caught.name}! ${caught.emoji}`);
        persist();
      } else {
        sound.select();
        hud.flash('The line goes slack.');
      }
      return true;
    }
    const spot = waterNearby();
    if (!spot) return false;
    fishing.cast(spot[0], spot[1], sampler.probe(player.x, player.z).biome, seed, state.day, raining());
    sound.select();
    return true;
  };

  /** The ground under the hero's feet, read the way somebody holding a shovel would read it. */
  const underfoot = (): Ground => {
    const tile = sampler.newSample();
    sampler.sampleTile(Math.floor(player.x), Math.floor(player.z), tile);
    return groundOf(tile);
  };

  /**
   * Enter with a shovel in hand: turn over the tile you are standing on. Highlands and hillsides
   * keep metal, meadows mostly keep stones, and a tile gives up what it had only once.
   */
  const tryDig = (): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    if (!state.can('dig')) {
      // carrying a spade is not the same as holding one, but the reminder only comes where it
      // would have paid, so that a shovel in the pack does not answer every press out in the country
      if (state.has('shovel') && seamAt(seed, tx, tz, underfoot())) {
        hud.flash('The gravel here is loose. Hold the shovel in your off hand to dig (I).');
        return true;
      }
      return false;
    }
    const found = digging.dig(seed, tx, tz, underfoot());
    if (!found) return false;
    const item = ITEMS[found.item];
    state.give(item.id, found.count);
    sound.jingle();
    hud.flash(`Dug up ${found.count > 1 ? `${found.count}× ` : ''}${item.name} ${item.emoji}`);
    persist();
    return true;
  };

  /**
   * Enter on bare earth near a village: sow a seed you are carrying, or lift a ripe crop.
   * Ground must be plain grass or sand within reach of a settlement, so fields stay near homes.
   */
  /** The world day with its fraction, which is what a growing thing actually measures. */
  const growingDay = (): number => state.day + state.time;

  /** How long a planting has left, said the way somebody waiting for it would say it. */
  const untilRipe = (crop: { days: number }, planting: { planted: number }): string => {
    const daysLeft = crop.days - (growingDay() - planting.planted);
    if (daysLeft <= 0) return 'ready now';
    if (daysLeft >= 1) return `about ${Math.ceil(daysLeft)} day${Math.ceil(daysLeft) === 1 ? '' : 's'} to go`;
    const hours = Math.max(1, Math.round(daysLeft * 24));
    return `about ${hours} hour${hours === 1 ? '' : 's'} to go`;
  };

  const tryFarm = (): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const standing = plots.at(tx, tz);
    if (standing) {
      if (!isRipe(standing, growingDay())) {
        const crop = CROPS[standing.crop];
        hud.flash(`${crop.name} coming along: ${untilRipe(crop, standing)} (${Math.round(ripeness(standing, growingDay()) * 100)}%).`);
        return true;
      }
      const lifted = plots.harvest(tx, tz, growingDay())!;
      online.report({ kind: 'reap', tile: `${tx},${tz}` });
      state.give(lifted.crop.id, lifted.amount);
      sound.jingle();
      hud.flash(`Harvested ${lifted.amount}× ${lifted.crop.name} ${lifted.crop.emoji}`);
      persist();
      return true;
    }

    const seeds = Object.keys(SEED_TO_CROP).filter((id) => state.count(id) > 0);
    if (seeds.length === 0) return false;
    const village = villageAt(structures.villages, player.x, player.z);
    const nearVillage = village !== null || structures.villages.some((v) => Math.hypot(v.x - player.x, v.z - player.z) < v.radius + 25);
    if (!nearVillage) { hud.flash('Too far from any village to break ground here.'); return true; }
    if (!chunks.isPlantable(player.x, player.z)) { hud.flash('Nothing will grow on this ground.'); return true; }

    dialogue.start({
      speaker: 'Bare Earth', emoji: '🌱',
      pages: ['Turned soil, and no one using it. What goes in?'],
      choices: [
        ...seeds.map((id) => {
          const crop = SEED_TO_CROP[id];
          const ok = canPlant(crop, state.day);
          const wait = ok ? '' : ` — wrong season, ${daysUntilSeason(crop, state.day)}d`;
          return { label: `${crop.emoji} ${crop.name} (${state.count(id)})${wait}`, next: () => {
            if (!ok) return { speaker: 'Bare Earth', emoji: '🌱', pages: [`${crop.name} will not take now. Wait about ${daysUntilSeason(crop, state.day)} days.`] };
            state.take(id, 1);
            plots.plant(tx, tz, crop.id, growingDay());
            online.report({ kind: 'sow', tile: `${tx},${tz}`, crop: crop.id, day: state.day });
            sound.select();
            hud.flash(`${crop.name} sown. Ripe in ${crop.days} days.`);
            persist();
            return null;
          } };
        }),
        { label: 'Leave it', next: () => null },
      ],
    });
    return true;
  };

  return { tryShrine, tryWreck, tryCampfire, tryFish, tryDig, tryFarm, tryRemains };
}

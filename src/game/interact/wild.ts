import { mulberry32 } from '../../core/rng';
import { ITEMS } from '../items';
import { saidOfTheWater, whatIsLeft, yearsSheHasLain } from '../../world/pickings';
import { StructureKind } from '../../world/structures';
import { CROPS, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from '../farming';
import { FISHING } from '../fishing';
import { Digging, groundOf, seamAt, type Ground } from '../digging';
import { mineIdOf } from '../mines';
import { villageAt } from '../../world/structures';
import { AWAY, buy, holds } from '../../world/deeds';
import { SHRINE_FEE } from '../../world/shrine';
import type { Surroundings } from './context';

/**
 * What Enter does out in the country: the way underground, a wreck's hold, a campfire to sleep
 * by, a line cast into water, a furrow to sow or reap, and a hole dug in a hillside.
 */
/**
 * How far a shrine's valley may be, in tiles.
 *
 * A shrine stands apart from the places it serves — that is most of what makes one a shrine — but
 * not so far apart that the magic reaches a village nobody standing here could see. A day's walk.
 */
const SHRINE_REACHES = 220;

export function wildInteractions(ctx: Surroundings) {
  const {
    player, state, structures, sampler, chunks, manifest, places, remains,
    dialogue, hud, sound, fishing, plots, online, seed, raining, discover, persist, register,
  } = ctx;

  /**
   * The holes dug this sitting. It lives here rather than in the world because what a tile holds
   * is derivable from the seed: every player works it out for themselves, and nobody has to be
   * told about anybody else's hole.
   */
  const digging = new Digging();

  /** Enter/Space at a shrine or a cave mouth offers the way underground. */
  /**
   * The village a shrine would send somebody to: the nearest one, empty or not.
   *
   * Nearest rather than nearest-empty, because a shrine that quietly picked a ruin four valleys away
   * would be doing something the player cannot see. If the place beside you is full, the magic has
   * nothing to offer you here and says so.
   */
  const valleyOf = (poi: { x: number; z: number }): { name: string; empty: boolean } | null => {
    const near = structures.villages.reduce<{ v: typeof structures.villages[number]; d: number } | null>(
      (best, v) => {
        const d = Math.hypot(v.x - poi.x, v.z - poi.z);
        return best === null || d < best.d ? { v, d } : best;
      }, null);
    if (!near || near.d > SHRINE_REACHES) return null;
    return { name: near.v.name, empty: register.living(near.v.name).length === 0 };
  };

  /**
   * Pay the shrine to raise a soul, which is the only way a dead valley comes back.
   *
   * The fee is the price of a house rather than the price of a meal, because magic that is
   * affordable is a tap: see `world/shrine.ts`, where the number comes from what a village pays its
   * own people to raise a roof. What it buys is one grown adult with a name of their own, on the
   * register, in the nearest village — the same as anybody else from the moment they arrive.
   */
  const raiseSomebody = (poi: { name: string; x: number; z: number }, valley: { name: string }) => {
    if (state.inventory.gold < SHRINE_FEE) {
      hud.flash(`The stones want ${SHRINE_FEE} gold, and you have ${Math.floor(state.inventory.gold)}.`);
      return null;
    }
    const raised = register.raiseAtShrine(valley.name, state.day);
    if (raised.length === 0) { hud.flash('The stones are cold. Not today.'); return null; }
    /*
     * And the coin goes into the bowl, which is out of the world.
     *
     * It left by subtraction until now — `state.inventory.gold -= SHRINE_FEE` — which is the thing
     * `deeds.ts` was written to end, and the doctor's fee was called "one of the last places" when
     * it was converted. It was not the last. This was, and it was the worst one to miss: the shrine
     * is the most expensive act in the game, so the single largest sum a player ever spends was the
     * one sum no instrument could see going.
     *
     * `AWAY` rather than a village's till, because nobody receives it. A coin laid in a bowl at a
     * shrine is gone, and saying so out loud is the difference between money that left the world
     * and money that was never counted.
     */
    buy(holds(state.inventory), AWAY, SHRINE_FEE);
    state.version++;
    sound.chime();
    hud.flash(`${raised[0].name} walks out of ${poi.name} and takes the road to ${valley.name}.`);
    persist();
    return null;
  };

  const tryShrine = (preview = false): boolean => {
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Shrine || Math.hypot(poi.x - player.x, poi.z - player.z) > 3) continue;
      if (preview) return true;
      const valley = valleyOf(poi);
      dialogue.start({ speaker: poi.name, emoji: '⛩️', pages: [
        'Worn steps lead down beneath the stones.',
        valley === null
          ? 'There is nobody within a day of here for the stones to send anywhere.'
          : valley.empty
            ? `The valley below is empty. Names are cut into the stones, and there is a bowl worn smooth by coins.`
            : `${valley.name} is below, and it is doing well enough. The bowl in the stones is dry.`,
      ], choices: [
        { label: 'Descend', next: () => { places.enterDungeon(poi); return null; } },
        // offered only where it would do something: a shrine over a living village is a staircase
        ...(valley !== null && valley.empty
          ? [{ label: `Lay ${SHRINE_FEE} gold in the bowl`, next: () => raiseSomebody(poi, valley) }]
          : []),
        { label: 'Not now', next: () => null },
      ] });
      return true;
    }
    // A great tree with a way in under it. Same layout as a cave, because both grew rather than
    // being cut, but it is wood the whole way through and lit green — and the camera is held in
    // close down there, so it is a place you are inside rather than one you look down at.
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.GiantTree || Math.hypot(poi.x - player.x, poi.z - player.z) > 3.2) continue;
      if (preview) return true;
      discover(poi.name);
      dialogue.start({ speaker: poi.name, emoji: '🌳', pages: [
        'The branches come down to the ground on every side, and there is a gap where the roots lift. It is dark in there and it does not smell of earth.',
      ], choices: [
        { label: 'Push through', next: () => { places.enterDungeon(poi, 'thicket', `thicket:${poi.name}`); return null; } },
        { label: 'Leave it', next: () => null },
      ] });
      return true;
    }
    for (const cave of structures.caves) {
      if (Math.hypot(cave.x - player.x, cave.z - player.z) > 3.2) continue;
      if (preview) return true;
      discover(cave.name);
      dialogue.start({ speaker: cave.name, emoji: '🕳️', pages: ['A cold draught comes out of the dark. Go in?'], choices: [
        { label: 'Go in', next: () => { places.enterDungeon(cave, 'cave', mineIdOf(cave)); return null; } },
        { label: 'Not now', next: () => null },
      ] });
      return true;
    }
    /*
     * A castle's gatehouse is deliberately not here any more.
     *
     * It used to be: press Enter within three tiles of the gate, read a sentence, choose "Go in".
     * Three deliberate acts to walk through an open arch, when every cottage in the country opens
     * by being walked into. It is a doorstep now — see `Gateway` in `game/doorways.ts` — which
     * also puts the way in and the way out on the same latch, so coming out of a castle onto its
     * own gate tile does not immediately take you back in.
     */
    return false;
  };

  /**
   * A pack lying in the grass where somebody was killed. Going through it is a small, grubby
   * decision the game does not moralise about — though something else might, later.
   */
  const tryRemains = (preview = false): boolean => {
    const pack = remains.nearest(player.x, player.z);
    if (!pack) return false;
    if (preview) return true;
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

  /**
   * A wreck you can go aboard, and a hold you can go down into.
   *
   * It was one thing you could do once — press Enter, take the salvage, and afterwards be told
   * forever that it was picked clean — which made a landmark you can see from half a mile off into
   * a chest with a boat drawn round it. A hull the sea runs in and out of is a way *in*: below the
   * waterline she is flooded, and what is down there is not what is in a cave.
   *
   * The floor is the drowned kind (`sunken`), which the game already has for the caverns under a
   * whirlpool — the same green-black light and the same water underfoot — and what lives in it is
   * the drowned roster rather than the depth-one one: fish-folk in twos and threes, a squid that
   * makes a room cost you something to cross, and now and then a shark that has come in under the
   * hull with the tide.
   *
   * The anchor is the wreck's own, and it is `ensure`d here as a wreck before anything else asks
   * for it. That matters: an anchor's seed comes from its kind as well as its id, so a wreck whose
   * hold was first opened by going below and a wreck first opened by searching it have to end up
   * with the same seed, or two people in one world would find different salvage in the same boat.
   */
  const tryWreck = (preview = false): boolean => {
    for (const wreck of structures.wrecks) {
      if (Math.hypot(wreck.x - player.x, wreck.z - player.z) > 3.4) continue;
      if (preview) return true;
      discover(wreck.name);
      const anchor = manifest.ensure(`wreck:${wreck.id}`, 'wreck', wreck.x, wreck.z);
      const lootId = `${anchor.id}:hold`;
      const goBelow = {
        label: 'Go below',
        next: () => {
          places.enterDungeon({ name: wreck.name, x: wreck.x, z: wreck.z }, 'wreck', anchor.id);
          return null;
        },
      };
      /*
       * And what she looks like from the deck, before anybody gets wet.
       *
       * The fish-folk are in her for the cargo and have been since she went down, so how many of
       * them there are and how much is left are the same number — which is only worth tying
       * together if the player is shown it. Said here rather than found out down there: the whole
       * bargain is that looking is cheaper than swimming.
       */
      const water = saidOfTheWater(whatIsLeft(yearsSheHasLain(anchor.seed)));
      if (state.opened.has(lootId)) {
        dialogue.start({ speaker: wreck.name, emoji: '🚢', pages: [
          'Picked clean above the waterline. Below it the water is still going in and out of her, and it is a long way down to the keel.',
          water,
        ], choices: [goBelow, { label: 'Leave it', next: () => null }] });
        return true;
      }
      dialogue.start({ speaker: wreck.name, emoji: '🚢', pages: ['The hold is half buried, but the hatch still gives. Search it — or go down into her?', water], choices: [
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
        goBelow,
        { label: 'Leave it', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  /** Rest at a campfire: sleep to dawn, fully healed. */
  const tryCampfire = (preview = false): boolean => {
    for (const poi of structures.pois) {
      if (poi.kind !== StructureKind.Campfire || Math.hypot(poi.x - player.x, poi.z - player.z) > 3) continue;
      if (preview) return true;
      dialogue.start({ speaker: poi.name, emoji: '🔥', pages: ['The embers are still warm. Rest here until dawn?'], choices: [
        { label: 'Rest', next: () => { state.rest(); sound.chime(); hud.flash('You sleep by the fire and wake at dawn.'); persist(); return null; } },
        { label: 'Move on', next: () => null },
      ] });
      return true;
    }
    return false;
  };

  /**
   * Water within reach of the hero, or null.
   *
   * The chunks are the only authority here, and asking them is enough: a cast is a couple of tiles
   * long and the ground that close to the hero is always loaded. There used to be a second arm to
   * this — the sampler saying "sea", provided the point was inside the world's radius plus a
   * margin, which was how the open sea past the last chunk was told from the nothing past the edge
   * of the world. It could never return anything: the line below only hands back a point the
   * chunks already hold water for, so the sampler's answer was thrown away every time. It went
   * with the radius, and neither is missed.
   */
  const waterNearby = (): [number, number] | null => {
    for (let r = 1; r <= FISHING.REACH; r += 0.6) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = player.x + Math.cos(ang) * r, z = player.z + Math.sin(ang) * r;
        if (chunks.waterAt(x, z) !== null) return [x, z];
      }
    }
    return null;
  };

  const tryFish = (preview = false): boolean => {
    if (!fishing.active && !state.can('fish')) {
      // carrying a rod is not the same as holding one
      if (state.has('rod') && waterNearby()) {
        if (preview) return true;
        hud.flash('Hold the fishing rod in your off hand to cast (I).');
        return true;
      }
      return false;
    }
    if (fishing.active) {
      if (preview) return true;
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
    if (preview) return true;
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
  const tryDig = (preview = false): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    if (!state.can('dig')) {
      // carrying a spade is not the same as holding one, but the reminder only comes where it
      // would have paid, so that a shovel in the pack does not answer every press out in the country
      if (state.has('shovel') && seamAt(seed, tx, tz, underfoot())) {
        if (preview) return true;
        hud.flash('The gravel here is loose. Hold the shovel in your off hand to dig (I).');
        return true;
      }
      return false;
    }
    const ground = underfoot();
    const found = preview
      ? (digging.turned(tx, tz) ? null : seamAt(seed, tx, tz, ground))
      : digging.dig(seed, tx, tz, ground);
    if (!found) return false;
    if (preview) return true;
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

  const tryFarm = (preview = false): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const standing = plots.at(tx, tz);
    if (standing) {
      if (!isRipe(standing, growingDay())) {
        if (preview) return true;
        const crop = CROPS[standing.crop];
        hud.flash(`${crop.name} coming along: ${untilRipe(crop, standing)} (${Math.round(ripeness(standing, growingDay()) * 100)}%).`);
        return true;
      }
      if (preview) return true;
      const lifted = plots.harvest(tx, tz, growingDay())!;
      const tile = `${tx},${tz}`;
      // asked rather than announced: the world empties the tile itself when it agrees there was
      // something ripe on it, and a page that reported the reaping as well could empty a field the
      // world had refused it. See `mayReport`. The field is already empty and the crop is already in
      // the pack — see `Harvests` — because a ripe field should answer the button, not the network
      online.harvest(plots.claims.ask({
        tile, crop: lifted.crop.id, amount: lifted.amount, planted: standing.planted,
      }), tile);
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
    if (!nearVillage) {
      if (preview) return true;
      hud.flash('Too far from any village to break ground here.');
      return true;
    }
    if (!chunks.isPlantable(player.x, player.z)) {
      if (preview) return true;
      hud.flash('Nothing will grow on this ground.');
      return true;
    }
    if (preview) return true;

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
            const tile = `${tx},${tz}`;
            online.report({ kind: 'sow', tile, crop: crop.id, day: state.day });
            // and ask, the same way a harvest does: the seed is already in the ground, and the
            // world says afterwards whether that ground, that day and that tile allowed it
            online.sow(plots.sowings.ask({ tile, seed: id }), tile, crop.id);
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

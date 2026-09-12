import {
  BUILD, beside, buildable, builderIn, canAttachTo, canBuildAt, canLayAKeel, deposit, isFinished,
  Houses, onOffer, owed, saidOfJob, storeysOf, type Buildable, type Commission,
} from '../building';
import { moorageFor } from '../sailing';
import { buy, give, holds } from '../../world/deeds';
import { boxOf, handOver, packOf } from '../../world/goods';
import { settle } from '../../world/works';
import { villageTill } from '../tills';
import { ITEMS } from '../items';
import { footprintLevel } from '../../world/footprint';
import type { Pier, Structure, Village } from '../../world/structures';
import { regardOf } from '../grudge';
import type { DialogueChoice, DialogueNode, Surroundings } from './context';

/**
 * Commissioning a house, and what a finished one is for.
 *
 * The rules live in `building.ts`; this is the three places a player meets them. You take a
 * builder on in the pub, you tell him where by standing on the spot, and afterwards you come back
 * to the house because there is a locked box in it.
 *
 * It is its own file rather than more of `village.ts` because it is three interactions in three
 * different places that only make sense together — a pub choice, a press on open ground, and a
 * press at your own front door — and splitting them across the files they geographically belong
 * to would mean nobody could read the feature.
 */

/** How close you have to be to your own front door for Enter to open the strongbox, in tiles. */
const AT_THE_DOOR = 3.4;

/**
 * How much of the map to consider when asking what is already standing near a plot.
 *
 * Only needs to beat BUILD.CLEAR_OF, but it is generous because the sweep is over the whole
 * country's structure list and happens once, on one key press, rather than every frame.
 */
const LOOK_AROUND = 40;

/** How many things you are offered at once when filling or emptying the box. A menu, not a ledger. */
const SHOWN = 8;

const BOX = { speaker: 'Strongbox', emoji: '🧰' } as const;

/** The world day with its fraction, which is what a thing being built actually measures. */
const buildingDay = (ctx: Surroundings): number => ctx.state.day + ctx.state.time;

/**
 * How far the nearest jetty is from a point, in tiles, or Infinity where the country has none.
 *
 * Module level because two quite different places need the same number and they have to agree. The
 * pub asks it of the village, to decide whether this man offers boats at all; the shore asks it of
 * the plot the player is standing on, to decide whether a keel may be laid there. One measure, one
 * distance in `BUILD.PIER_WITHIN`, and so no village that offers a boat has nowhere to build one.
 */
function toTheJetty(piers: ReadonlyArray<Pier>, x: number, z: number): number {
  let nearest = Infinity;
  for (const pier of piers) {
    nearest = Math.min(nearest, Math.hypot(pier.dockX + 0.5 - x, pier.dockZ + 0.5 - z));
  }
  return nearest;
}

/**
 * Where to go and stand to say where it goes, in the builder's own words.
 *
 * One sentence per kind of ground rather than a conditional written out at each of the two places
 * he says it, because there are three kinds now and the two places had been kept in step by hand.
 * The shore one is the only one that names a condition the player cannot see from where they are
 * standing when he says it, which is why it names both: a beach with no jetty on it is a refusal
 * they would otherwise walk half a mile to earn.
 *
 * `again` is the second of those two moments — you have taken him on, wandered off, and come back
 * to ask him where. He does not repeat the conditions then, he repeats that it is your decision,
 * which is a different sentence rather than the same one twice.
 */
function whereToStand(wants: Buildable, again = false): string {
  if (wants.on === 'house') {
    return again
      ? `Stand at the house you want ${wants.name} on, on the side you want it, and press Enter.`
      : `Go and stand at the house you want ${wants.name} on, on the side you want it, and press Enter. I put a second floor on the Merrow place last spring; the same hands do a pool.`;
  }
  if (wants.on === 'shore') {
    return again
      ? 'A flat piece of shore within sight of a jetty. Stand on it and press Enter and I will lay her keel there.'
      : 'Find me a piece of shore by a jetty — flat, above the tide, with the water at the end of it — stand on it and press Enter. I will lay her keel there and she goes in when she is paid for.';
  }
  return again
    ? 'Go and stand where you want it and press Enter. I am not choosing it for you — you are the one who has to live in it.'
    : 'Walk out to wherever you want it and press Enter on the spot. Flat ground, off the road, and not on top of anybody.';
}


/**
 * The builder's own menu: taking him on, hearing how yours is coming along, and settling up.
 *
 * His, and not the pub's. The pub is only where he drinks — these choices are added to the room's
 * dialogue because a room should be one conversation rather than a door that opens into a second
 * one, the same way the errand-giver's are. What is on the menu is a fact about the man and his
 * trade, which is why `onOffer` decides it and this only lays it out.
 */
export function builderChoices(ctx: Surroundings, village: Village): DialogueChoice[] {
  const { state, houses, hud, sound, persist, seed } = ctx;
  const name = builderIn(village.name, seed);
  const day = buildingDay(ctx);
  const choices: DialogueChoice[] = [];
  const held = houses.hired;
  const mine = houses.entries().filter((job) => job.village === village.name);
  const due = mine.filter((job) => owed(job, day) > 0);
  const going = mine.filter((job) => !isFinished(job, day));

  if (!held && !going.length && !due.length) {
    /*
     * What this man will put up for you.
     *
     * A menu rather than the one line it was, because building is a verb that takes an object and
     * a verb with one possible object is a verb nobody has to think about. Which of them he offers
     * is `onOffer`'s business rather than this file's: it depends on what you already own, and what
     * a builder will take on is a fact about builders rather than about the room he is sitting in.
     */
    const offered = onOffer(mine, day, toTheJetty(ctx.structures.piers, village.x, village.z) <= BUILD.PIER_WITHIN);
    choices.push({
      label: 'Have something built',
      next: () => ({
        speaker: name, emoji: '🔨',
        pages: ['What is it you want putting up?'],
        choices: [
          ...offered.map((entry) => ({
            label: `${entry.name[0].toUpperCase()}${entry.name.slice(1)} — ${entry.price}g, ${deposit(entry.price)}g down`,
            next: () => order(entry),
          })),
          { label: 'Nothing today', next: () => null },
        ],
      }),
    });

    /** Taking him on for one particular thing: the deposit leaves, and he waits to be told where. */
    function order(entry: Buildable): DialogueNode {
      const down = deposit(entry.price);
      if (state.inventory.gold < down) {
        return { speaker: name, emoji: '🔨', pages: [`It is ${down} gold to start and you have ${state.inventory.gold}. Come back when you have it.`] };
      }
      // one act rather than two halves that have to agree: the gold leaves the rucksack
      // and arrives in the village, and `villageTill` decides who in it is the better off
      buy(holds(state.inventory), villageTill(ctx.register, village.name), down);
      houses.takeOn(village.name, entry.price, down, entry.id);
      state.version++;
      sound.select();
      persist();
      return {
        speaker: name, emoji: '🔨',
        pages: [
          `${down} gold, and I will not ask for the rest until it is standing. ${entry.price - down} more on the day it is done.`,
          whereToStand(entry),
        ],
      };
    }
  }
  if (held && held.village === village.name) {
    const wants = buildable(held.what);
    choices.push({
      label: 'Where do you want it, then?',
      next: () => ({
        speaker: name, emoji: '🔨',
        pages: [whereToStand(wants, true)],
      }),
    });
  }
  for (const job of going) {
    // named rather than always "my house", because the catalogue has five things in it and asking
    // after your house while a boat is on the stocks is asking after the wrong job
    const what = buildable(job.what).name;
    choices.push({ label: `How is ${what} coming along?`, next: () => ({ speaker: name, emoji: '🔨', pages: [saidOfJob(job, day)] }) });
  }
  for (const job of due) {
    const balance = owed(job, day);
    choices.push({
      label: `Settle up (${balance}g)`,
      next: () => {
        if (state.inventory.gold < balance) {
          return { speaker: name, emoji: '🔨', pages: [`${balance} gold, and you have ${state.inventory.gold}. It stands there locked until you have it, and the village hears about it every day it does.`] };
        }
        // one deed: the money leaves the rucksack, arrives in the village, and the commission
        // records what it has been paid. Three lines that had to agree about one number, and they
        // very nearly did not — the conversion that caught the deposit above missed this because
        // `houses.pay` sat between the two halves of it
        settle(holds(state.inventory), villageTill(ctx.register, village.name), job);
        const built = buildable(job.what);
        // and the one job that is handed over rather than simply finished: she comes off the
        // stocks when she is paid for, which is the same bargain as the key under the step
        if (built.moves) launchHer(ctx, job, day);
        state.version++;
        sound.jingle();
        hud.flash(built.done);
        persist();
        return {
          speaker: name, emoji: '🔨',
          pages: [built.on === 'land'
            ? 'Paid in full. The key is under the step, and there is a box inside for whatever you would rather not carry.'
            : built.moves
              ? 'Paid in full. We put her down the beach on the ebb — she is at the jetty, and she is yours.'
              : 'Paid in full. Enjoy it.'],
        };
      },
    });
  }
  return choices;
}

/**
 * She comes off the stocks, and the yard she was built in goes back to being a beach.
 *
 * Three things, and the order of them is the whole of the handover: the commission is marked with
 * the day she went in, which is what stops her being drawn on the shore as well as at the jetty;
 * `Sailing` is given her, which is what makes her a thing the player can board; and the moorage is
 * the nearest jetty, which is where the boatwright at the end of a pier leaves one too.
 *
 * A yard with no jetty left near it is not supposed to be reachable — laying the keel refuses it —
 * but a world can be reopened after its coast has been grown differently, so she is put in the
 * water beside her own yard rather than nowhere at all. Better an odd mooring than a boat that was
 * paid for and does not exist.
 */
function launchHer(ctx: Surroundings, job: Commission, day: number): void {
  const lies = moorageFor(job, ctx.structures.piers) ?? { x: job.x, z: job.z, yaw: job.rot ?? 0 };
  ctx.houses.launch(job, day);
  ctx.sailing.buy(lies.x, lies.z, lies.yaw);
}

/** Choosing the plot, and what a finished house is for. */
export function builderInteractions(ctx: Surroundings) {
  const { player, state, structures, sampler, chunks, houses, grudges, dialogue, hud, sound, persist, seed } = ctx;

  /** The world day with its fraction, which is what a thing being built actually measures. */
  const today = (): number => buildingDay(ctx);

  /** The nearest village to a point, which is whose builder would take the job. */
  const villageNear = (x: number, z: number): Village | null => {
    let best: Village | null = null;
    let nearest = Infinity;
    for (const village of structures.villages) {
      const away = Math.hypot(village.x - x, village.z - z);
      if (away < nearest) { nearest = away; best = village; }
    }
    return best;
  };

  /**
   * What is already standing near a plot, as the nearest point of each thing rather than its
   * centre. Measured to the edge because that is what "no closer than seven tiles to anything
   * standing" means to somebody looking at it: a village square eleven tiles across would
   * otherwise happily take a house four tiles inside its own cobbles.
   */
  const standingNear = (x: number, z: number): Array<{ x: number; z: number }> => {
    const edgeOf = (s: Structure) => ({
      x: Math.max(s.tx - s.hw, Math.min(s.tx + s.hw, x)),
      z: Math.max(s.tz - s.hd, Math.min(s.tz + s.hd, z)),
    });
    const near = structures.all
      .filter((s) => Math.abs(s.tx - x) < LOOK_AROUND && Math.abs(s.tz - z) < LOOK_AROUND)
      .map(edgeOf);
    // and your own houses, so a second one cannot be built inside the first
    for (const job of houses.entries()) near.push({ x: job.x, z: job.z });
    return near;
  };

  // --- choosing the plot -----------------------------------------------------------------

  /**
   * Is there anything growing on the plot?
   *
   * Trees and boulders are not structures — they live on the chunk rather than in the world's list
   * of things it built — so the footprint rule has nothing to say about them, and the first house
   * put up while trying this out had an oak coming through the middle of the roof. `blocked` is
   * what the walker uses to decide it cannot walk into something, which is the same question.
   */
  const clearOfTrees = (tx: number, tz: number): boolean => {
    for (let dz = -BUILD.PLOT; dz <= BUILD.PLOT; dz++) {
      for (let dx = -BUILD.PLOT; dx <= BUILD.PLOT; dx++) {
        if (chunks.blocked(tx + dx + 0.5, tz + dz + 0.5)) return false;
      }
    }
    return true;
  };

  /**
   * Enter on open ground with a builder taken on: build it here?
   *
   * Whether the ground will take it is the world's own answer — the same footprint rule a village
   * uses when it decides where its houses go — and everything else is `canBuildAt`. A refusal
   * always says which of the four conditions failed, because "you cannot build here" with no
   * reason is a bug report rather than a rule.
   */
  /**
   * Start the work, wherever it was decided it goes, and tell the world.
   *
   * Shared by the two ways of choosing a spot, because everything after the choosing is the same:
   * the commission is made, the world hears about it — a village is a building bigger for
   * everybody, whoever paid — and the corner says how long it will be.
   */
  const begin = (x: number, z: number, wants: Buildable, to?: string): void => {
    const job = houses.place(x, z, today(), player.entity.yaw, to);
    if (!job) return;
    /*
     * Everybody hears about a building, and nobody needs to hear about a boat.
     *
     * A village is a building bigger for everybody, whoever paid for it — that is why this is told
     * at all, and it is what lets another player walk past your house and see it. A boat is not
     * that. She is on the shore for five days and then she is wherever you sailed her, so a delta
     * that put a hull on somebody else's beach would put it there for ever: they never settle up
     * for her, so on their screen she would never be launched and the yard would never clear.
     */
    if (!wants.moves) {
      ctx.told({
        kind: 'built', id: job.id, village: job.village,
        x: job.x, z: job.z, rot: job.rot ?? 0, day: Math.floor(job.began),
        what: job.what, to: job.to,
      });
    }
    state.version++;
    sound.chime();
    hud.flash(wants.moves ? `A keel on the blocks. ${wants.days} days.` : `Pegs and string. ${wants.days} days.`);
    persist();
  };

  const tryBuild = (): boolean => {
    const held = houses.hired;
    if (!held) return false;
    const wants = buildable(held.what);
    const name = builderIn(held.village, seed);
    if (wants.on === 'house') return addToAHouse(wants, name);
    if (wants.on === 'shore') return layAKeel(wants, name);
    return buildOnLand(wants, name);
  };

  /**
   * How far the nearest open water is from a tile, in tiles, or Infinity if there is none near.
   *
   * Rings outward rather than scanning a square, so the answer is the distance to the nearest wet
   * tile rather than to whichever wet tile happened to be looked at first — and it stops the moment
   * it finds one, which for a plot actually on a shore is the first ring. Water is the same
   * question the boat itself asks: ground with nothing to stand on.
   */
  const toTheWater = (x: number, z: number): number => {
    for (let r = 1; r <= BUILD.SHORE_WITHIN; r++) {
      for (let a = 0; a < r * 8; a++) {
        const angle = (a / (r * 8)) * Math.PI * 2;
        const wx = x + Math.cos(angle) * r, wz = z + Math.sin(angle) * r;
        if (chunks.heightAt(wx, wz) === null) return r;
      }
    }
    return Infinity;
  };

  /**
   * A boat: the same ground rules as a house, and two more that only a coast can satisfy.
   *
   * She is laid on dry land — a hull is built above the tide line and goes in on the last day — so
   * the plot is checked exactly as a house's is, with the world's own footprint rule. What is added
   * is the sea at the end of it and a jetty to tie her to, and both are measured here because both
   * are questions about the world. `canLayAKeel` is handed the two distances and knows nothing else.
   */
  const layAKeel = (wants: Buildable, name: string): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const x = tx + 0.5, z = tz + 0.5;
    const flat = footprintLevel(sampler, tx, tz, BUILD.PLOT, BUILD.PLOT, null) !== null;
    const verdict = canLayAKeel(
      x, z, flat, villageNear(x, z), standingNear(x, z), clearOfTrees(tx, tz),
      toTheWater(x, z), toTheJetty(structures.piers, x, z),
    );
    if (!verdict.ok) {
      dialogue.start({ speaker: name, emoji: '🔨', pages: [`Not here. ${verdict.why}`] });
      return true;
    }
    dialogue.start({
      speaker: name, emoji: '🔨',
      pages: [`A yard, then. ${wants.days} days on the stocks, and she goes down the beach the day you pay me the rest.`],
      choices: [
        { label: 'Lay her keel here', next: () => { begin(x, z, wants); return null; } },
        { label: 'Let me walk the shore', next: () => null },
      ],
    });
    return true;
  };

  /** A building of its own: the ground has to take it, and nothing may be standing on it. */
  const buildOnLand = (wants: Buildable, name: string): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const x = tx + 0.5, z = tz + 0.5;
    const flat = footprintLevel(sampler, tx, tz, BUILD.PLOT, BUILD.PLOT, null) !== null;
    const verdict = canBuildAt(x, z, flat, villageNear(x, z), standingNear(x, z), clearOfTrees(tx, tz));
    if (!verdict.ok) {
      dialogue.start({ speaker: name, emoji: '🔨', pages: [`Not here. ${verdict.why}`] });
      return true;
    }
    dialogue.start({
      speaker: name, emoji: '🔨',
      pages: [`Here, then. ${wants.days} days, and the rest of the money when you can stand in it.`],
      choices: [
        { label: 'Build it here', next: () => { begin(x, z, wants); return null; } },
        { label: 'Let me look elsewhere', next: () => null },
      ],
    });
    return true;
  };

  /**
   * An addition: it goes on a house you already own, and on the side of it you are standing.
   *
   * The spot is not chosen by standing on it, because the spot is not yours to choose — a pool
   * belongs to a yard and a storey belongs to a roof. What standing decides is *which* building
   * and which side of it, which is the same statement of intent a house's own facing comes from.
   */
  const addToAHouse = (wants: Buildable, name: string): boolean => {
    const parent = houses.nearest(player.x, player.z, BUILD.BESIDE_WITHIN);
    const verdict = canAttachTo(parent, wants.id, today(), houses.entries());
    if (!verdict.ok || !parent) {
      dialogue.start({ speaker: name, emoji: '🔨', pages: [verdict.ok ? 'Not here.' : verdict.why] });
      return true;
    }
    const spot = beside(parent, wants.id, player.x, player.z);
    const tx = Math.floor(spot.x), tz = Math.floor(spot.z);
    // the ground still has to take it: a fountain half in a river is not a fountain, and a storey
    // is the only one this cannot refuse because the house is already standing on its own ground
    if (!wants.changes) {
      const flat = footprintLevel(sampler, tx, tz, BUILD.PLOT, BUILD.PLOT, null) !== null;
      if (!flat || !clearOfTrees(tx, tz)) {
        dialogue.start({
          speaker: name, emoji: '🔨',
          pages: ['Not on that side. Walk round to where the ground is level and clear, and ask me again.'],
        });
        return true;
      }
    }
    dialogue.start({
      speaker: name, emoji: '🔨',
      pages: [wants.changes
        ? `On this one, then. ${wants.days} days, and you will hear us on the roof.`
        : `This side, then. ${wants.days} days.`],
      choices: [
        { label: 'Yes, there', next: () => { begin(spot.x, spot.z, wants, parent.id); return null; } },
        { label: 'Let me think where', next: () => null },
      ],
    });
    return true;
  };

  // --- what a house is for ---------------------------------------------------------------

  /** What is in the box, in words, because a list of nothing reads worse than a sentence. */
  const contents = (job: Commission): string => {
    const box = houses.strongbox(job);
    const lots = Object.entries(box.items).filter(([, n]) => n > 0)
      .map(([id, n]) => `${ITEMS[id]?.emoji ?? ''} ${ITEMS[id]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`);
    const all = [box.gold > 0 ? `${box.gold} gold` : '', ...lots].filter(Boolean);
    return all.length ? all.join('\n') : 'Empty, and lined with sacking.';
  };

  /** Everything in the rucksack, worth putting somewhere safe or not. */
  const putIn = (job: Commission): DialogueNode => {
    const box = houses.strongbox(job);
    const carried = [...state.inventory.items.entries()].filter(([id, n]) => n > 0 && ITEMS[id]);
    return {
      ...BOX,
      pages: carried.length || state.inventory.gold > 0 ? ['What goes in?'] : ['You are carrying nothing to leave.'],
      choices: [
        ...(state.inventory.gold > 0 ? [{ label: `All your gold (${state.inventory.gold}g)`, next: () => {
          give(holds(state.inventory), holds(box), state.inventory.gold);
          state.version++;
          sound.select();
          persist();
          return chest(job);
        } }] : []),
        ...carried.slice(0, SHOWN).map(([id, n]) => ({
          label: `${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (${n})` : ''}`,
          next: () => {
            // one deed rather than a take and an add that have to agree about the number: see
            // `handOver`, which moves what was actually taken and never what was asked for
            handOver(packOf(state.inventory.items), boxOf(box.items), id, 1);
            sound.select();
            persist();
            return chest(job);
          },
        })),
        { label: 'Never mind', next: () => chest(job) },
      ],
    };
  };

  const takeOut = (job: Commission): DialogueNode => {
    const box = houses.strongbox(job);
    const stored = Object.entries(box.items).filter(([id, n]) => n > 0 && ITEMS[id]);
    return {
      ...BOX,
      pages: stored.length || box.gold > 0 ? ['What comes out?'] : ['There is nothing in it.'],
      choices: [
        ...(box.gold > 0 ? [{ label: `The gold (${box.gold}g)`, next: () => {
          give(holds(box), holds(state.inventory), box.gold);
          state.version++;
          sound.jingle();
          persist();
          return chest(job);
        } }] : []),
        ...stored.slice(0, SHOWN).map(([id, n]) => ({
          label: `${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (${n})` : ''}`,
          next: () => {
            handOver(boxOf(box.items), packOf(state.inventory.items), id, 1);
            sound.select();
            persist();
            return chest(job);
          },
        })),
        { label: 'Shut the lid', next: () => chest(job) },
      ],
    };
  };

  /**
   * The one thing a finished house is actually for.
   *
   * A bed would have been the other answer, but there are already campfires and inns and the
   * bath house to sleep in, so a fourth would have been a house you never needed. This is the
   * only place in the game where something you own is not on your body — and being knocked out
   * takes gold off your body, so a strongbox is the difference between carrying four hundred gold
   * across a moor and leaving it at home. That is a real decision, and it is the reason to ride
   * back.
   */
  const chest = (job: Commission): DialogueNode => ({
    ...BOX,
    pages: [
      storeysOf(job, houses.entries(), today()) > 1
        ? `Your house, in ${job.village}'s parish, two floors of it. There is a banded box under the window.`
        : `Your house, in ${job.village}'s parish. There is a banded box under the window.`,
      contents(job),
    ],
    choices: [
      { label: 'Put something in', next: () => putIn(job) },
      { label: 'Take something out', next: () => takeOut(job) },
      { label: 'Leave it shut', next: () => null },
    ],
  });

  /** Enter at your own house: the box inside it, or the reason there is not one yet. */
  const tryChest = (): boolean => {
    // a house, rather than whatever is nearest: a storey stands on the same tile as the house it
    // is on and a pool three tiles off it, and neither has a strongbox under the window
    const job = houses.nearest(player.x, player.z, AT_THE_DOOR, Houses.isABuilding);
    if (!job) return false;
    const day = today();
    const name = builderIn(job.village, seed);
    if (!isFinished(job, day)) {
      dialogue.start({ speaker: name, emoji: '🔨', pages: [saidOfJob(job, day)] });
      return true;
    }
    const balance = owed(job, day);
    if (balance > 0) {
      dialogue.start({
        speaker: 'Your house', emoji: '🏠',
        pages: [
          `It is finished, and the door is locked. ${balance} gold still to go to ${name}, and until it does this is his house with your name on it.`,
          `He drinks in the pub in ${job.village}.`,
        ],
      });
      return true;
    }
    dialogue.start(chest(job));
    return true;
  };

  // --- the debt --------------------------------------------------------------------------

  /** The last thing each village was heard to think of you, so a souring is only said once. */
  const said = new Map<string, string>();

  /**
   * A day has turned over with a balance still standing.
   *
   * Chosen over having the builder simply down tools, because he has already finished: the roof is
   * on, and the argument is about money. A village is twenty people who carry each other's news,
   * and a man who is owed four hundred gold for a house that is standing there in front of
   * everybody will have said so in the pub by now. So it goes on the grudge the village already
   * keeps, which sours its prices and eventually its welcome, and which fades once you have paid.
   */
  const builderDay = (): void => {
    const bills = houses.charge(state.day);
    if (bills.length === 0) return;
    for (const bill of bills) {
      const before = grudges.regard(bill.village, state.day);
      const after = regardOf(grudges.slighted(bill.village, state.day, bill.weight));
      if (after !== before && after !== 'fine' && said.get(bill.village) !== after) {
        said.set(bill.village, after);
        hud.flash(after === 'unwelcome'
          ? `${bill.village} has had enough of being owed for that house.`
          : `${bill.village} is talking about the house you have not paid for.`);
      }
    }
    persist();
  };

  return { tryBuild, tryChest, builderDay };
}

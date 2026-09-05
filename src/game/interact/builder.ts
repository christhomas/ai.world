import { BUILD, builderIn, canBuildAt, deposit, isFinished, owed, saidOfJob, type Commission } from '../building';
import { ITEMS } from '../items';
import { footprintLevel } from '../../world/footprint';
import type { Structure, Village } from '../../world/structures';
import { PROSPER } from '../../world/prosperity';
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
 * Money the player hands a builder does not stop there.
 *
 * He buys timber with it, and pays the two men who carry it, and drinks some of it — so it is
 * spread across everybody still living in the village rather than pushed into one purse. That
 * matters because a village's prosperity is the sum of its purses: a house commissioned is a
 * village that can afford another storey on somebody else's, which is the same builder's next job.
 * If the village has nobody left in it the coin is simply gone, which is the honest answer to
 * paying a place that no longer exists.
 */
function paidInto(ctx: Surroundings, village: string, gold: number): void {
  const folk = ctx.register.living(village);
  if (folk.length === 0) return;
  const each = gold / folk.length;
  for (const person of folk) person.purse = Math.min(PROSPER.MOST, person.purse + each);
}

/**
 * The choices a builder adds to a pub's dialogue: taking him on, hearing how yours is coming
 * along, and settling up at the end.
 *
 * A plain function rather than part of the interaction object below, because the pub's dialogue is
 * assembled in `village.ts` and the pub is one room: one room should be one conversation, not a
 * door that opens into a second one. The builder is a regular of it, the way the errand-giver is.
 */
export function builderPubChoices(ctx: Surroundings, village: Village): DialogueChoice[] {
  const { state, houses, hud, sound, persist, seed } = ctx;
  const name = builderIn(village.name, seed);
  const day = buildingDay(ctx);
  const choices: DialogueChoice[] = [];
  const held = houses.hired;
  const mine = houses.entries().filter((job) => job.village === village.name);
  const due = mine.filter((job) => owed(job, day) > 0);
  const going = mine.filter((job) => !isFinished(job, day));

  if (!held && !going.length && !due.length) {
    choices.push({
      label: `Have a house built (${deposit()}g down)`,
      next: () => {
        if (state.inventory.gold < deposit()) {
          return { speaker: name, emoji: '🔨', pages: [`It is ${deposit()} gold to start and you have ${state.inventory.gold}. Come back when you have it.`] };
        }
        state.inventory.gold -= deposit();
        paidInto(ctx, village.name, deposit());
        houses.takeOn(village.name, BUILD.PRICE, deposit());
        state.version++;
        sound.select();
        persist();
        return {
          speaker: name, emoji: '🔨',
          pages: [
            `${deposit()} gold, and I will not ask for the rest until you can stand in it. ${BUILD.PRICE - deposit()} more on the day it is done.`,
            'Walk out to wherever you want it and press Enter on the spot. Flat ground, off the road, and not on top of anybody. I put a second floor on the Merrow place last spring; I can put a whole house up for you.',
          ],
        };
      },
    });
  }
  if (held && held.village === village.name) {
    choices.push({
      label: 'Where do you want it, then?',
      next: () => ({
        speaker: name, emoji: '🔨',
        pages: ['Go and stand where you want it and press Enter. I am not choosing it for you — you are the one who has to live in it.'],
      }),
    });
  }
  for (const job of going) {
    choices.push({ label: 'How is my house coming along?', next: () => ({ speaker: name, emoji: '🔨', pages: [saidOfJob(job, day)] }) });
  }
  for (const job of due) {
    const balance = owed(job, day);
    choices.push({
      label: `Settle up (${balance}g)`,
      next: () => {
        if (state.inventory.gold < balance) {
          return { speaker: name, emoji: '🔨', pages: [`${balance} gold, and you have ${state.inventory.gold}. It stands there locked until you have it, and the village hears about it every day it does.`] };
        }
        state.inventory.gold -= balance;
        houses.pay(job, balance);
        paidInto(ctx, village.name, balance);
        state.version++;
        sound.jingle();
        hud.flash('The house is yours. There is a strongbox in it.');
        persist();
        return { speaker: name, emoji: '🔨', pages: ['Paid in full. The key is under the step, and there is a box inside for whatever you would rather not carry.'] };
      },
    });
  }
  return choices;
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
  const tryBuild = (): boolean => {
    if (!houses.hired) return false;
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const x = tx + 0.5, z = tz + 0.5;
    const flat = footprintLevel(sampler, tx, tz, BUILD.PLOT, BUILD.PLOT, null) !== null;
    const verdict = canBuildAt(x, z, flat, villageNear(x, z), standingNear(x, z), clearOfTrees(tx, tz));
    const name = builderIn(houses.hired.village, seed);
    if (!verdict.ok) {
      dialogue.start({ speaker: name, emoji: '🔨', pages: [`Not here. ${verdict.why}`] });
      return true;
    }
    dialogue.start({
      speaker: name, emoji: '🔨',
      pages: [`Here, then. ${BUILD.DAYS} days, and the rest of the money when you can stand in it.`],
      choices: [
        { label: 'Build it here', next: () => {
          const job = houses.place(x, z, today(), player.entity.yaw);
          if (!job) return null;
          state.version++;
          sound.chime();
          hud.flash(`Pegs and string. ${BUILD.DAYS} days.`);
          persist();
          return null;
        } },
        { label: 'Let me look elsewhere', next: () => null },
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
          box.gold += state.inventory.gold;
          state.inventory.gold = 0;
          state.version++;
          sound.select();
          persist();
          return chest(job);
        } }] : []),
        ...carried.slice(0, SHOWN).map(([id, n]) => ({
          label: `${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (${n})` : ''}`,
          next: () => {
            state.take(id, 1);
            box.items[id] = (box.items[id] ?? 0) + 1;
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
          state.inventory.gold += box.gold;
          box.gold = 0;
          state.version++;
          sound.jingle();
          persist();
          return chest(job);
        } }] : []),
        ...stored.slice(0, SHOWN).map(([id, n]) => ({
          label: `${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (${n})` : ''}`,
          next: () => {
            box.items[id] = n - 1;
            if (box.items[id] <= 0) delete box.items[id];
            state.give(id, 1);
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
    pages: [`Your house, in ${job.village}'s parish. There is a banded box under the window.`, contents(job)],
    choices: [
      { label: 'Put something in', next: () => putIn(job) },
      { label: 'Take something out', next: () => takeOut(job) },
      { label: 'Leave it shut', next: () => null },
    ],
  });

  /** Enter at your own house: the box inside it, or the reason there is not one yet. */
  const tryChest = (): boolean => {
    const job = houses.nearest(player.x, player.z, AT_THE_DOOR);
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

import { HIRE } from '../hire';
import { clockAt } from '../jail';
import { NEMESIS, heardOfHim, saidOfWant, saidOfWork, type Nemesis, type Outcome, type Realm, type Tool } from '../nemesis';
import type { Person } from '../../world/people';
import type { Surroundings } from './context';

/**
 * What Enter does about Old Nettle: read a village that is losing people, and answer the one
 * question he ever asks.
 *
 * Only the second of those is really an interaction. The choice is put in front of the player by
 * the fight rather than by a keypress, and this file exists so that pressing Enter while the clock
 * runs puts it back in front of them wherever they have got to, because a dialogue dismissed by a
 * fat thumb must never be how somebody finds out they let a village drown.
 *
 * He comes in beside the rest of the surroundings rather than inside them until the field is
 * wired into `context.ts`; nothing below will notice when it is.
 */
export function nemesisInteractions(ctx: Surroundings & { nemesis: Nemesis }) {
  const {
    player, state, structures, register, jail, hires, online, sailing, mount, nemesis,
    dialogue, hud, sound, seed, persist,
  } = ctx;

  /** The world clock as one number, which is what everything about him counts in. */
  const now = (): number => clockAt(state);

  /** Everything the cycle is allowed to reach, assembled fresh: none of it is his to hold on to. */
  const realm = (): Realm => ({ register, jail, villages: structures.villages, hero: online.name });

  /**
   * What the hero could actually answer a disaster with. Owning is the test rather than holding,
   * because somebody who has bought a boat has a boat, and a game that drowns a village over which
   * hand a shovel is in has stopped being about the decision.
   */
  const kit = (): Tool[] => {
    const carried: Tool[] = [];
    if (sailing.bought) carried.push('boat');
    if (mount.owned) carried.push('horse');
    if (state.owns('shovel')) carried.push('shovel');
    if (state.owns('sword') || state.owns('steelsword') || state.owns('axe')) carried.push('sword');
    return carried;
  };

  /** The side the hero's hired swords are fighting for: their own in a shared world, and you alone otherwise. */
  const side = (): string => online.id || HIRE.ALONE;

  /**
   * Somebody who will hold him while you run. A hired sword is the whole of it here; another
   * player doing the same is the same field filled in from the wire, and this is where that goes.
   */
  const holder = (): string => hires.roster(side())[0]?.name ?? '';

  /** How an outcome is told: one line in the HUD, and the world already changed under it. */
  const settle = (outcome: Outcome | null): void => {
    if (!outcome) return;
    if (outcome.saved.length > 0) sound.chime(); else sound.thud();
    hud.flash(outcome.said);
    persist();
  };

  /**
   * The fight is over and he is still standing, because he always is. Raises the choice and shows
   * it. Called by whoever swung the blade, when `knocked` says he has taken enough.
   */
  const heWentDown = (): boolean => {
    const choice = nemesis.beaten(realm(), now(), kit(), holder());
    if (!choice) return false;
    sound.thud();
    showChoice();
    return true;
  };

  /** The two ways out of it, and no third: whichever you pick, the other one happens without you. */
  const showChoice = (): void => {
    const choice = nemesis.choice;
    if (!choice) return;
    const seconds = Math.max(1, Math.round(choice.left));
    const both = choice.holder !== '';
    dialogue.start({
      speaker: NEMESIS.NAME,
      emoji: '🎩',
      pages: [
        `He is on his knees in the grass and he is laughing at you. "Go on, then."`,
        choice.said,
        `${saidOfWant(choice.wants, choice.ready)} About ${seconds} seconds, at a guess.`,
      ],
      choices: [
        { label: 'Take him', next: () => { settle(nemesis.chase(realm(), now())); return null; } },
        {
          label: both ? `Leave ${choice.holder} holding him and run` : 'Leave him and run',
          next: () => { settle(nemesis.help(realm(), now())); return null; },
        },
      ],
    });
  };

  /**
   * Enter while the clock runs, from anywhere in the world. It puts the same question back up
   * rather than doing anything, so there is no way to spend the ninety seconds having accidentally
   * closed the only thing that mattered.
   */
  const tryChoice = (): boolean => {
    if (!nemesis.choice) return false;
    showChoice();
    return true;
  };

  /**
   * Run the clock down by a frame. An outcome comes back only when nobody answered in time, which
   * is its own decision and is reported as flatly as the other two.
   */
  const runClock = (dt: number): void => {
    settle(nemesis.tick(dt, realm(), now()));
  };

  /**
   * Enter inside the village he has settled on. It tells you what the place has noticed, which is
   * never him: it is the well, or the road, or a fever that takes the strong first.
   */
  const tryScheme = (): boolean => {
    const scheme = nemesis.scheme;
    if (!scheme) return false;
    const village = structures.villages.find((v) => v.name === scheme.village);
    if (!village || Math.hypot(village.x - player.x, village.z - player.z) > village.radius) return false;

    const days = Math.max(1, state.day - scheme.began);
    dialogue.start({
      speaker: village.name,
      emoji: '🕯️',
      pages: [
        saidOfWork(scheme.work, scheme.village),
        `It has been going on ${days} day${days === 1 ? '' : 's'}, and nobody has come.`,
      ],
    });
    return true;
  };

  /**
   * The line a villager drops about him, for whoever is putting a conversation together. It has to
   * be sayable before he has ever been seen, because the whole of the design rests on the player
   * having been told he always gets away by somebody who thought it was old news.
   */
  const wordOfHim = (person: Person): string =>
    heardOfHim(seed, person.id, structures.villages.map((v) => v.name));

  return { tryChoice, tryScheme, heWentDown, runClock, wordOfHim };
}

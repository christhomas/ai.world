import type { DialogueChoice, DialogueNode, Surroundings } from './context';
import {
  affectedPlaces, askForHighland, mayPray, prayerSite, PRAYER_REACH, PRAYER_WAIT,
  type PrayerDirection,
} from '../prayers';

const DIRECTIONS: readonly PrayerDirection[] = ['north', 'east', 'south', 'west'];

/** Shrine prayers alter the private world's ground only after a warned, saved wait. */
export function prayerInteractions(ctx: Surroundings) {
  const { state, manifest, around, online, hud, sound, persistStrict, prayerHost } = ctx;
  let reloading = false;
  const eligible = (): boolean => prayerHost.isLive() && online.connected && !online.away && !!ctx.sampler.within;
  const save = (written: () => void, failed: () => void): void => {
    try { void persistStrict().then(written, failed); }
    catch { failed(); }
  };

  const choicesAt = (shrine: { name: string; x: number; z: number }): DialogueChoice[] => [{
    label: 'Ask the stones to raise high ground',
    next: (): DialogueNode => {
      if (!prayerHost.isLive()) return null;
      if (!online.connected || online.away || !ctx.sampler.within) return {
        speaker: shrine.name, emoji: '⛩️',
        pages: ['A prayer that moves the ground can harm another person’s home. The stones answer this prayer only in a world of your own.'],
        choices: [{ label: 'Leave it', next: () => null }],
      };
      return {
        speaker: shrine.name, emoji: '⛩️',
        pages: [`Name a place around ${shrine.name}. The gods will answer in ${PRAYER_WAIT} world days, and the raised ground stays in this world. The high country may bring ogres and other dangers.`],
        choices: [
          ...DIRECTIONS.map((direction): DialogueChoice => {
            const site = prayerSite(shrine, direction);
            return { label: site.name, next: () => {
              if (!prayerHost.isLive()) return null;
              const refused = mayPray(state.prayers, manifest, site.id, state.day);
              if (refused) return { speaker: shrine.name, emoji: '⛩️', pages: [refused],
                choices: [{ label: 'Leave it', next: () => null }] };
              const places = affectedPlaces(site, around.surveyVillages(site.x, site.z, PRAYER_REACH));
              const warning = places.length
                ? `This rise may change the ground beneath ${places.join(', ')}. Homes, fields, roads and people there may be harmed.`
                : 'No known village is within its reach, but paths and people in the country may still be harmed.';
              return {
                speaker: shrine.name, emoji: '⛩️',
                pages: [`${site.name} will rise around ${site.x}, ${site.z}, within at most ${PRAYER_REACH} tiles.`,
                  warning, 'This change cannot be undone by reloading the world. Ask anyway?'],
                choices: [
                  { label: 'Pray and accept the consequence', next: () => {
                    // A displayed choice may outlive its session, or be pressed twice while saving.
                    if (!eligible()) return null;
                    const refused = mayPray(state.prayers, manifest, site.id, state.day);
                    if (refused) { hud.flash(refused); return null; }
                    // The seed is drawn once and saved with the request. The answered anchor carries
                    // that same roll, so closing the tab cannot offer another outcome.
                    const seed = prayerHost.randomSeed();
                    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('invalid prayer seed');
                    const prayer = askForHighland(shrine, direction, state.day, seed);
                    // Pushed before the save so the save carries it; confirmed only once the save
                    // is known to be written, because a promise the reload cannot keep is worse
                    // than a prayer the player is asked to make again.
                    state.prayers.push(prayer);
                    save(() => {
                      if (!prayerHost.isLive()) return;
                      sound.chime();
                      hud.flash(`The stones will answer for ${site.name} on day ${prayer.due}.`);
                    }, () => {
                      if (!prayerHost.isLive()) return;
                      const index = state.prayers.indexOf(prayer);
                      if (index >= 0) state.prayers.splice(index, 1);
                      hud.flash('The prayer could not be saved. Please try again.');
                    });
                    return null;
                  } },
                  { label: 'Leave the ground as it is', next: () => null },
                ],
              };
            } };
          }),
          { label: 'Not now', next: () => null },
        ],
      };
    },
  }];

  /** The answer is put into the saved manifest on the next boot, before either side grows land. */
  const tick = (): void => {
    if (reloading || !eligible()) return;
    if (!state.prayers.some((p) => !p.answered && state.day >= p.due)) return;
    reloading = true;
    hud.flash('The stones have answered. The country is changing.');
    save(() => {
      if (!eligible()) { reloading = false; return; }
      try { prayerHost.restart(); }
      catch {
        reloading = false;
        hud.flash('The answer was saved, but the world could not reopen. Please reopen your game.');
      }
    }, () => {
      if (!prayerHost.isLive()) return;
      reloading = false;
      hud.flash('The answer could not be saved. The stones will try again.');
    });
  };

  return { choicesAt, tick };
}

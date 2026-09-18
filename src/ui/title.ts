import { SWITCHES, isOn, setOn } from './switches';
import { kindOf, type SaveStore, type SessionSave, type WorldKind } from '../save/store';
import { randomSeed } from '../core/rng';
import { drawAWorldWorthOpening } from '../world/goodseed';
import { measuringSeeds } from '../world/seedworker';
import { takeTheScreen } from './sideways';
import { paintTitleSky } from './titlesky';
import { GAME, today } from '../core/version';
import { cleanWorldName } from '../../server/protocol';

/** Three save slots. Each is a whole session (seed, hero, state). */
const SLOT_KEYS = ['ai.world/slot/1', 'ai.world/slot/2', 'ai.world/slot/3'];

/**
 * The things somebody can turn on before a world opens.
 *
 * Read and written here rather than anywhere in the game, because a render path cannot be swapped
 * once a scene is standing: the rig is built from the answer at boot. So the title screen is the
 * only honest place to ask, and that is why this is the first thing in the project that looks like
 * a menu.
 */
function offerTheSwitches(into: HTMLElement): void {
  into.innerHTML = SWITCHES.map((one) => `
    <label class="switch">
      <input type="checkbox" data-switch="${one.id}"${isOn(one.id) ? ' checked' : ''}>
      <span class="switch-name">${one.name}</span>
      <span class="switch-note">${one.note}</span>
    </label>`).join('');
  into.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest('[data-switch]') as HTMLInputElement | null;
    if (box) setOn(box.dataset.switch ?? '', box.checked);
  });
}
/**
 * What the switches add up to, read at the moment a world is actually made.
 *
 * At the moment rather than when the screen was drawn: somebody flips a switch and then picks a
 * slot, and the world they get has to be the one the switch was showing when they pressed it.
 */
function chosenWorld(): WorldKind {
  return isOn('endless') ? 'endless' : 'road';
}

/** Pre-slot saves lived here; migrated into slot 1 on first run. */
export const LEGACY_KEY = 'ai.world/session';

export interface SlotChoice {
  key: string;
  save: SessionSave | undefined;
  seed: number;
  /** The sayable name chosen for a new world, or kept with a continued one. */
  worldName?: string;
  /** Which world to grow. Taken from the save when continuing one, and from the switch when not. */
  world: WorldKind;
}

/**
 * How a saved world describes itself in its slot.
 *
 * It matters again now that there are two kinds: the same seed grows a completely different country
 * as an endless one, so a slot that did not say which it was would be a slot you could not tell
 * apart from its neighbour until you were standing in it. Saves with nothing written on them are
 * endless, for the reason `kindOf` gives.
 */
export function nameOf(world: WorldKind | undefined): string {
  return world === 'road' ? 'open country' : 'endless country';
}
/** Saved names are data even if storage was edited by hand. */
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

import { $ } from './dom';

/**
 * Title screen: shows the three slots and resolves when the player picks one.
 * Continue keeps the saved world; New World rolls a fresh seed into that slot.
 */
export async function showTitle(store: SaveStore): Promise<SlotChoice> {
  const saves: Array<SessionSave | undefined> = [];
  for (const key of SLOT_KEYS) saves.push(await store.load<SessionSave>(key));
  if (!saves[0]) {
    const legacy = await store.load<SessionSave>(LEGACY_KEY);
    if (legacy) { saves[0] = legacy; await store.save(SLOT_KEYS[0], legacy); await store.remove(LEGACY_KEY); }
  }

  // which build this is, said plainly. The first question of anything just deployed is which
  // version is actually being looked at, and the answer should not be "read the tag on the cluster"
  $('buildLine').textContent = `${GAME.name} v${GAME.version} · built ${GAME.builtOn} · ${today()}`;

  const root = $('title');
  const list = $('slots');
  const worldNameInput = $('worldNameInput') as HTMLInputElement;
  const worldSeedInput = $('worldSeedInput') as HTMLInputElement;
  const worldError = $('titleWorldError');
  offerTheSwitches($('titleExtras'));
  root.classList.add('show');

  return new Promise<SlotChoice>((resolve) => {
    const finish = (choice: SlotChoice) => {
      root.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      stopSky();
      resolve(choice);
    };
    /**
     * A slot is a band you press, not a box with buttons in it.
     *
     * The old shape asked two questions of somebody who has one thing in mind: which slot, and
     * then which of three buttons. A saved world has exactly one thing you want to do with it, so
     * the whole band does it, and the only other verb — throwing it away — is a small mark at the
     * far end of its own row rather than a red button sitting next to Play.
     */
    const render = () => {
      list.innerHTML = SLOT_KEYS.map((_key, i) => {
        const s = saves[i];
        const st = s?.state;
        const inside = s
          ? `<span class="slot-of">
               <span class="slot-day">${(s.worldName ?? `World ${s.seed}`).replace(/[&<>"']/g, (character) => HTML_ESCAPE[character])}<span class="slot-world">Day ${st?.day ?? 1} · ${nameOf(s.world)}</span></span>
               <span class="slot-facts">
                 <span>${st?.inventory?.gold} gold</span>
                 <span>${st?.discovered?.length ?? 0} place${(st?.discovered?.length ?? 0) === 1 ? '' : 's'} found</span>
                 <span class="slot-seed">seed ${s.seed}</span>
               </span>
             </span>
             <span class="slot-go">Continue ▸</span>`
          : `<span class="slot-of">Empty</span><span class="slot-go">＋ New world</span>`;
        return `<div class="slot${s ? '' : ' empty'}">
          <button class="band" data-act="${s ? 'continue' : 'new'}" data-slot="${i}">
            <span class="slot-no">${i + 1}</span>${inside}
          </button>
          ${s ? `<button class="slot-del" data-act="delete" data-slot="${i}" title="Delete this world" aria-label="Delete slot ${i + 1}">✕</button>` : ''}
        </div>`;
      }).join('');
    };
    const pick = (i: number, act: string) => {
      const key = SLOT_KEYS[i];
      // The tap that enters a world is the one moment a browser will give a page the whole screen,
      // so it is where it is asked for. On a phone the browser's own furniture is a fifth of the
      // glass and the game cannot be played through it; on anything else this does nothing at all.
      if (act !== 'delete') void takeTheScreen();
      if (act === 'delete') {
        if (!saves[i] || !window.confirm(`Delete slot ${i + 1}? This cannot be undone.`)) return;
        saves[i] = undefined;
        void store.remove(key);
        render();
        return;
      }
      if (act === 'continue' && saves[i]) {
        // Every part of a continued world's identity comes from its save. Older saves simply have
        // no name yet and continue by seed, which is their intact migration path.
        finish({ key, save: saves[i], seed: saves[i]!.seed, worldName: saves[i]!.worldName, world: kindOf(saves[i]!.world) });
        return;
      }
      const worldName = cleanWorldName(worldNameInput.value);
      if (!worldName) {
        worldError.textContent = 'Give the world a name using letters, numbers, spaces, _ or -.';
        worldNameInput.focus();
        return;
      }
      const askedSeed = worldSeedInput.value.trim();
      if (askedSeed && !/^\d+$/.test(askedSeed)) {
        worldError.textContent = 'A seed is a whole number.';
        worldSeedInput.focus();
        return;
      }
      worldError.textContent = '';
      const world = chosenWorld();
      /*
       * A seed somebody typed is theirs, and is handed over untouched.
       *
       * #323 is about the worlds the game *chooses*, and only those. A player who asks for 4815162342
       * has asked for that world — refusing it because a measurement dislikes it would make the seed
       * box a suggestion, and would make a shared link open a different country for the two people
       * holding it.
       */
      if (askedSeed) {
        finish({ key, save: undefined, seed: Number(askedSeed) >>> 0, worldName, world });
        return;
      }
      /*
       * And a country with an edge is not the country this was measured on.
       *
       * `readSeed` grows the *endless* home patch, which is what the distribution in
       * `docs/reports/seeds-report.txt` is a distribution of. A road-tree world is a different
       * generator, so a bar read off one and applied to the other would be rejecting seeds on the
       * strength of a world the player is not about to open.
       */
      if (world !== 'endless') {
        finish({ key, save: undefined, seed: randomSeed(), worldName, world });
        return;
      }
      /*
       * Otherwise: drawn, measured, and drawn again where nobody lives there — off this thread.
       *
       * The measuring is a whole patch grown, which is six hundred milliseconds on a desk and
       * fourteen seconds on a small ARM box. Done here it stopped the page painting at the exact
       * moment somebody had asked for a new world, so the only part of the feature a player ever
       * saw was the game appearing to hang. It goes to the worker that grows the country, which
       * does this work anyway and is already on the other side of that line. See #358.
       *
       * The worker is closed whatever happens. One left running is a thread outliving the screen
       * that made it, and this screen is about to be taken down.
       */
      worldError.textContent = 'Finding a world worth walking into…';
      const measurer = measuringSeeds();
      void drawAWorldWorthOpening(randomSeed, (seed) => measurer.measure(seed))
        .then((drawn) => finish({ key, save: undefined, seed: drawn.seed, worldName, world }))
        /*
         * And a world all the same if the measuring cannot be done at all.
         *
         * A worker that will not start — an old browser, a blocked module — must not be the thing
         * that stops somebody playing. `randomSeed()` is what the game handed out before any of
         * this existed, which is the floor the whole feature is built to: it may make the game
         * better and it must never make it worse.
         */
        .catch(() => finish({ key, save: undefined, seed: randomSeed(), worldName, world }))
        .finally(() => measurer.close());
    };
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!btn) return;
      pick(Number(btn.dataset.slot), btn.dataset.act!);
    });
    // the land behind it keeps moving while the choice is being made, and stops when it is
    const stopSky = paintTitleSky($('titleSky') as HTMLCanvasElement);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 3) pick(n - 1, saves[n - 1] ? 'continue' : 'new');
    };
    document.addEventListener('keydown', onKey);
    render();
  });
}

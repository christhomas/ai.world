import type { SaveStore, SessionSave, WorldKind } from '../save/store';
import { randomSeed } from '../core/rng';
import { takeTheScreen } from './sideways';
import { paintTitleSky } from './titlesky';
import { GAME, today } from '../core/version';

/** Three save slots. Each is a whole session (seed, hero, state). */
const SLOT_KEYS = ['ai.world/slot/1', 'ai.world/slot/2', 'ai.world/slot/3'];
/** Pre-slot saves lived here; migrated into slot 1 on first run. */
export const LEGACY_KEY = 'ai.world/session';

export interface SlotChoice {
  key: string;
  save: SessionSave | undefined;
  seed: number;
  /** Which world to grow. Taken from the save when continuing one, and chosen when starting one. */
  world: WorldKind;
}

/**
 * The switches in the corner: what a new world is made of, decided before you go in.
 *
 * Written as switches rather than as a pair of buttons on every slot because there will be more
 * than one of them. A world has a handful of things worth settling in advance and none of them
 * belong on the slot itself, which is about the hero rather than the country.
 *
 * `mountains` picks the polygon world over the older road tree. It is on by default and worth
 * being plain about why: the road tree cannot place a massif at all, because a massif wants thirty
 * tiles of room from the coast and its land is never wider than twenty-two. So the flat world has
 * no cliffs in it, and no eagles nesting on them.
 */
interface Switch {
  id: string;
  label: string;
  note: string;
  /** What it is set to when nobody has ever touched it. */
  fallback: boolean;
}

/*
 * Empty, and worth keeping empty rather than deleting.
 *
 * There was one switch: "Mountains", which chose the polygon world. It is gone with that world —
 * the country it grew read as a honeycomb at map scale, which is what made the choice a choice, and
 * the answer in the end was to make the good country mountainous rather than to keep the bad one
 * for its cliffs.
 *
 * The machinery stays because a title screen that can offer a choice about a world is a thing this
 * game will want again, and because it is nine lines. A list with nothing in it draws nothing.
 */
const SWITCHES: readonly Switch[] = [];

/** Where a switch remembers itself between visits, so it is set once rather than every time. */
const switchKey = (id: string) => `ai.world/new/${id}`;

function switchIsOn(id: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(switchKey(id));
    return saved === null ? fallback : saved === '1';
  } catch {
    return fallback;   // private browsing: the default will do
  }
}

function setSwitch(id: string, on: boolean): void {
  try { localStorage.setItem(switchKey(id), on ? '1' : '0'); } catch { /* nothing to do */ }
}

/** How a saved world describes itself in its slot. */
function nameOf(_world: WorldKind | undefined): string {
  return 'open country';
}

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
  const switches = $('titleSwitches');
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
               <span class="slot-day">Day ${st?.day ?? 1}<span class="slot-world">${nameOf(s.world)}</span></span>
               <span class="slot-facts">
                 <span>${st?.inventory?.gold ?? 50} gold</span>
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
      switches.innerHTML = SWITCHES.map((sw) => `
        <div class="tswitch" role="switch" tabindex="0" data-switch="${sw.id}" aria-checked="${switchIsOn(sw.id, sw.fallback)}">
          <div class="tswitch-track"></div>
          <div class="tswitch-label">${sw.label}<span class="tswitch-note">${sw.note}</span></div>
        </div>`).join('');
    };
    /** What the switches currently add up to, read at the moment a world is actually made. */
    const chosenWorld = (): WorldKind => 'road';

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
        // the saved world's own kind, whatever is on the screen or in the address bar: the ground
        // under a house does not get to change because somebody clicked a different button today
        finish({ key, save: saves[i], seed: saves[i]!.seed, world: saves[i]!.world ?? 'road' });
        return;
      }
      finish({ key, save: undefined, seed: randomSeed(), world: chosenWorld() });
    };
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!btn) return;
      pick(Number(btn.dataset.slot), btn.dataset.act!);
    });
    // the land behind it keeps moving while the choice is being made, and stops when it is
    const stopSky = paintTitleSky($('titleSky') as HTMLCanvasElement);
    const flip = (el: HTMLElement) => {
      const id = el.dataset.switch!;
      const now = el.getAttribute('aria-checked') !== 'true';
      setSwitch(id, now);
      el.setAttribute('aria-checked', String(now));
    };
    switches.addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.tswitch');
      if (sw) flip(sw);
    });
    // a switch is a control, so it answers the keyboard as well as the mouse
    switches.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.tswitch');
      if (!sw) return;
      e.preventDefault();
      flip(sw);
    });
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 3) pick(n - 1, saves[n - 1] ? 'continue' : 'new');
    };
    document.addEventListener('keydown', onKey);
    render();
  });
}

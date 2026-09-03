import type { SaveStore, SessionSave } from '../save/store';
import { randomSeed } from '../core/rng';

/** Three save slots. Each is a whole session (seed, hero, state). */
export const SLOT_KEYS = ['ai.world/slot/1', 'ai.world/slot/2', 'ai.world/slot/3'];
/** Pre-slot saves lived here; migrated into slot 1 on first run. */
export const LEGACY_KEY = 'ai.world/session';

export interface SlotChoice {
  key: string;
  save: SessionSave | undefined;
  seed: number;
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

  const root = $('title');
  const list = $('slots');
  root.classList.add('show');

  return new Promise<SlotChoice>((resolve) => {
    const finish = (choice: SlotChoice) => {
      root.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      resolve(choice);
    };
    const render = () => {
      list.innerHTML = SLOT_KEYS.map((_key, i) => {
        const s = saves[i];
        const st = s?.state;
        const summary = s
          ? `Day ${st?.day ?? 1} · seed ${s.seed} · 💰 ${st?.inventory?.gold ?? 50} · ${st?.discovered?.length ?? 0} places found`
          : 'Empty';
        return `<div class="slot" data-slot="${i}">
          <div class="slot-head">Slot ${i + 1} <span class="slot-key">[${i + 1}]</span></div>
          <div class="slot-summary">${summary}</div>
          <div class="slot-actions">
            ${s ? `<button data-act="continue" data-slot="${i}">Continue</button>` : ''}
            <button data-act="new" data-slot="${i}">New World</button>
            ${s ? `<button class="danger" data-act="delete" data-slot="${i}">Delete</button>` : ''}
          </div>
        </div>`;
      }).join('');
    };
    const pick = (i: number, act: string) => {
      const key = SLOT_KEYS[i];
      if (act === 'delete') {
        if (!saves[i] || !window.confirm(`Delete slot ${i + 1}? This cannot be undone.`)) return;
        saves[i] = undefined;
        void store.remove(key);
        render();
        return;
      }
      if (act === 'continue' && saves[i]) { finish({ key, save: saves[i], seed: saves[i]!.seed }); return; }
      finish({ key, save: undefined, seed: randomSeed() });
    };
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!btn) return;
      pick(Number(btn.dataset.slot), btn.dataset.act!);
    });
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 3) pick(n - 1, saves[n - 1] ? 'continue' : 'new');
    };
    document.addEventListener('keydown', onKey);
    render();
  });
}

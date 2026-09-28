import { SWITCHES, isOn, setOn } from './switches';
import { kindOf, type SaveStore, type SessionSave, type WorldKind } from '../save/store';
import { randomSeed } from '../core/rng';
import { aWorldWorthOpeningAsync, seedsReadOffThread } from '../world/goodseed';
import type { GrownPatch } from '../world/endless';
import { takeTheScreen } from './sideways';
import { paintTitleSky } from './titlesky';
import { GAME, today } from '../core/version';
import { cleanWorldName } from '../../server/protocol';
import type { TerrainLayer } from '../world/terrainlayers';
import { PREVIEW_SIZE, PREVIEW_SPAN, terrainPreview } from './terrainpreview';
import { elevationFor } from '../world/growworld';
import { Manifest, type Anchor } from '../world/manifest';
import { addMountain, mountainAnchor, mountainDraft, skyEyrieAnchor } from '../world/worldediting';
import { assessSavedEdit, type EditReach, type SavedEditAssessment } from '../world/savededit';
import { pinsInSave, villagesInSave, type PlacePin } from '../world/editimpacts';

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
  /**
   * The home patch, where choosing this seed happened to grow one.
   *
   * Part of the choice rather than something fetched afterwards, and that is the honest way round:
   * this screen does not own a country and cannot put a patch into one. What it can say is *"this
   * seed, and here is the square I looked at while deciding"* — a thing handed over with the
   * answer, which `boot.ts` carries to the game and `growCountry` gives to the country the moment
   * there is one. See #358.
   *
   * Nothing for a continued world, a typed seed or a bounded one: none of them measures anything,
   * so none of them has a patch to hand on.
   */
  home?: GrownPatch;
}

/** A new world's authored ground is saved before either half grows its first patch. */
export function terrainSave(seed: number, worldName: string, terrain: readonly TerrainLayer[]): SessionSave | undefined {
  if (terrain.length === 0) return undefined;
  return {
    seed, world: 'endless', worldName, cam: { x: 0, z: 0, rot: 0, zoom: 1 },
    manifest: { rootSeed: seed, anchors: [], terrain: [...terrain] },
  };
}

/** Validate one row before it enters a manifest or a worker message. */
export function terrainEntry(
  kind: string, x: string, z: string, reach: string, seed: string,
  random: () => number = randomSeed,
): TerrainLayer | null {
  if (x.trim() === '' || z.trim() === '' || reach.trim() === '') return null;
  const a = Number(x), b = Number(z), radius = Number(reach);
  if (kind !== 'land' && kind !== 'sea') return null;
  if (![a, b, radius].every(Number.isSafeInteger)) return null;
  if (Math.abs(a) > 1_000_000 || Math.abs(b) > 1_000_000 || radius < 1 || radius > 2048) return null;
  if (seed !== '' && (!/^\d+$/.test(seed) || Number(seed) > 0xffffffff)) return null;
  return { kind, x: a, z: b, reach: radius, seed: seed === '' ? random() >>> 0 : Number(seed) >>> 0 };
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
  const terrain: TerrainLayer[] = [];
  const mountains: Anchor[] = [];
  const skyEyries: Anchor[] = [];
  let editingSlot: number | null = null;
  let pinnedTerrain = 0;
  const terrainList = $('terrainLayers');
  const terrainError = $('terrainError');
  const previewButton = $<HTMLButtonElement>('terrainPreviewButton');
  const previewCanvas = $<HTMLCanvasElement>('terrainPreviewCanvas');
  const previewStatus = $('terrainPreviewStatus');
  let previewVersion = 0;
  let previewCentre = { x: 0, z: 0 };
  let previewOpen = false;
  let previewFocus: 'mountain' | 'terrain' = 'mountain';
  let previewDraftActive = false;
  const preview = () => {
    const version = ++previewVersion;
    const typed = worldSeedInput.value.trim();
    if (typed && (!/^\d+$/.test(typed) || Number(typed) > 0xffffffff)) {
      previewStatus.textContent = 'Use a whole seed from 0 to 4294967295.';
      previewCanvas.classList.remove('show');
      return;
    }
    if (!typed) worldSeedInput.value = String(randomSeed() >>> 0);
    if (!terrainInput('mountainSeed')) $<HTMLInputElement>('mountainSeed').value = String(randomSeed() >>> 0);
    const seed = Number(worldSeedInput.value) >>> 0;
    const draft = previewDraftActive ? readMountain() : null;
    previewCentre = previewFocus === 'terrain' && terrain.length
      ? { x: terrain.at(-1)!.x, z: terrain.at(-1)!.z }
      : draft ? { x: draft.x, z: draft.z }
        : mountains.length ? { x: mountains.at(-1)!.x, z: mountains.at(-1)!.z } : { x: 0, z: 0 };
    const centre = previewCentre;
    const layers = [...terrain];
    const manifest = new Manifest(seed, { rootSeed: seed, anchors: [
      ...mountains, ...(draft ? [mountainAnchor(draft, 'highland:edit:00000000-0000-4000-8000-000000000000')] : []),
    ] });
    previewStatus.textContent = `Growing seed ${seed} near ${centre.x}, ${centre.z}…`;
    // Let the title paint the progress line before patch growth takes the main thread.
    window.setTimeout(() => {
      if (version !== previewVersion) return;
      const pixels = terrainPreview(seed, layers, centre.x, centre.z, PREVIEW_SIZE, elevationFor(manifest));
      if (version !== previewVersion) return;
      const context = previewCanvas.getContext('2d');
      if (!context) return;
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), PREVIEW_SIZE, PREVIEW_SIZE), 0, 0);
      previewCanvas.classList.add('show');
      previewStatus.textContent = `Seed ${seed} · ${PREVIEW_SPAN} × ${PREVIEW_SPAN} tiles around ${centre.x}, ${centre.z}. ${draft ? 'Mountain draft shown; pin it to keep it. ' : ''}Select a point to set the next layer centre.`;
    }, 0);
  };
  previewButton.addEventListener('click', () => { previewOpen = true; preview(); });
  worldSeedInput.addEventListener('change', () => { if (previewOpen) preview(); });
  previewCanvas.addEventListener('click', (event) => {
    const rect = previewCanvas.getBoundingClientRect();
    $<HTMLInputElement>('terrainX').value = String(Math.round(previewCentre.x + ((event.clientX - rect.left) / rect.width - 0.5) * PREVIEW_SPAN));
    $<HTMLInputElement>('terrainZ').value = String(Math.round(previewCentre.z + ((event.clientY - rect.top) / rect.height - 0.5) * PREVIEW_SPAN));
    $<HTMLInputElement>('mountainX').value = $<HTMLInputElement>('terrainX').value;
    $<HTMLInputElement>('mountainZ').value = $<HTMLInputElement>('terrainZ').value;
    $<HTMLInputElement>('skyEyrieX').value = $<HTMLInputElement>('terrainX').value;
    $<HTMLInputElement>('skyEyrieZ').value = $<HTMLInputElement>('terrainZ').value;
    previewFocus = 'mountain';
    previewDraftActive = true;
    if (previewOpen) preview();
  });
  const terrainInput = (id: string) => ($<HTMLInputElement>(id)).value.trim();
  const readMountain = () => mountainDraft({
    x: Number(terrainInput('mountainX')), z: Number(terrainInput('mountainZ')),
    reach: Number(terrainInput('mountainReach')), lift: Number(terrainInput('mountainLift')),
    roughness: Number(terrainInput('mountainRoughness')),
    seed: Number(terrainInput('mountainSeed')),
  });
  const showMountains = () => {
    $('mountainLayers').replaceChildren(...mountains.map((anchor) => {
      const row = document.createElement('li');
      row.textContent = `Mountain at ${anchor.x}, ${anchor.z} · reach ${anchor.layer?.reach} · lift ${anchor.layer?.lift} · ridges ${anchor.layer?.roughness ?? 0}`;
      return row;
    }));
  };
  const showSkyEyries = (manifest: Manifest) => {
    const target = $<HTMLSelectElement>('skyEyrieTarget');
    const chosen = target.value;
    target.replaceChildren(...manifest.byKind('skyisle').map((site) => {
      const option = document.createElement('option');
      option.value = site.id; option.textContent = `Sky village at ${site.x}, ${site.z}`;
      return option;
    }));
    if (chosen && [...target.options].some((option) => option.value === chosen)) target.value = chosen;
    $('skyEyries').replaceChildren(...skyEyries.map((anchor) => {
      const row = document.createElement('li');
      row.textContent = `Eyrie at ${anchor.x}, ${anchor.z} for ${anchor.parent}`;
      return row;
    }));
  };
  $('skyEyrieAdd').addEventListener('click', () => {
    if (editingSlot === null) { terrainError.textContent = 'Play and save a world before placing an eagle for its sky village.'; return; }
    const old = saves[editingSlot];
    if (!old) return;
    const manifest = new Manifest(old.seed, old.manifest);
    const anchor = skyEyrieAnchor(manifest, $<HTMLSelectElement>('skyEyrieTarget').value,
      Number(terrainInput('skyEyrieX')), Number(terrainInput('skyEyrieZ')),
      `eyrie:edit:${crypto.randomUUID()}`);
    if (!anchor) { terrainError.textContent = 'Choose a pinned sky village and a whole-tile eyrie within 160 tiles of it.'; return; }
    skyEyries.push(anchor);
    showSkyEyries(manifest);
    terrainError.textContent = 'Skyward eyrie prepared. Save edits to check its footing.';
  });
  const checkEdit = (seed: number, before: ReturnType<Manifest['toJSON']>,
    after: ReturnType<Manifest['toJSON']>, changed: EditReach[], pins: PlacePin[],
    villages: string[], protectAllVillages: boolean): Promise<SavedEditAssessment> => {
    if (typeof Worker === 'undefined') return Promise.resolve(assessSavedEdit(seed, before, after,
      changed, pins, villages, protectAllVillages));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./editworker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<SavedEditAssessment>) => { worker.terminate(); resolve(event.data); };
      worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ seed, before, after, changed, pins, villages, protectAllVillages });
    });
  };
  $('saveWorldEdits').addEventListener('click', async () => {
    if (editingSlot === null) return;
    const slot = editingSlot;
    const old = saves[slot];
    if (!old) return;
    const manifest = new Manifest(old.seed, old.manifest);
    const before = manifest.toJSON();
    const changed: EditReach[] = [];
    for (const anchor of mountains) {
      if (!manifest.get(anchor.id) && !addMountain(manifest, anchor)) {
        terrainError.textContent = 'This mountain could not be saved. Check its parameters.';
        return;
      }
      if (!before.anchors.some((a) => a.id === anchor.id)) changed.push({ x: anchor.x, z: anchor.z, reach: anchor.layer!.reach });
    }
    for (const anchor of skyEyries) if (!manifest.get(anchor.id)) manifest.anchors.set(anchor.id, anchor);
    changed.push(...terrain.slice(pinnedTerrain).map(({ x, z, reach }) => ({ x, z, reach })));
    manifest.terrain.splice(0, manifest.terrain.length, ...terrain);
    terrainError.textContent = 'Checking saved places against the new ground…';
    let assessment: SavedEditAssessment;
    const villages = villagesInSave(old);
    try { assessment = await checkEdit(old.seed, before, manifest.toJSON(), changed, pinsInSave(old),
      villages.names, villages.all); }
    catch { terrainError.textContent = 'The world edit could not be checked.'; return; }
    if (assessment.conflict) { terrainError.textContent = assessment.conflict; return; }
    for (const site of assessment.sites) manifest.anchors.set(site.id, site);
    const updated = { ...old, manifest: manifest.toJSON() };
    void (store.saveStrict?.(SLOT_KEYS[slot], updated) ?? store.save(SLOT_KEYS[slot], updated)).then(() => {
      saves[slot] = updated;
      editingSlot = null;
      worldSeedInput.disabled = false;
      $<HTMLButtonElement>('saveWorldEdits').hidden = true;
      terrainError.textContent = 'World edits saved. Continue the slot to see the regrown country.';
    }).catch(() => { terrainError.textContent = 'The world edit could not be saved.'; });
  });
  $('mountainAdd').addEventListener('click', () => {
    if (!terrainInput('mountainSeed')) $<HTMLInputElement>('mountainSeed').value = String(randomSeed() >>> 0);
    const draft = readMountain();
    if (!draft || mountains.length >= 32) {
      terrainError.textContent = 'Use whole coordinates, reach 1–2048, lift 1–100, ridges 0–1, and at most 32 mountains.';
      return;
    }
    const anchor = mountainAnchor(draft, `highland:edit:${crypto.randomUUID()}`);
    mountains.push(anchor);
    previewFocus = 'mountain';
    previewDraftActive = false;
    terrainError.textContent = '';
    showMountains();
    if (previewOpen) preview();
  });
  for (const id of ['mountainX', 'mountainZ', 'mountainReach', 'mountainLift', 'mountainRoughness', 'mountainSeed']) {
    $(id).addEventListener('change', () => {
      previewFocus = 'mountain'; previewDraftActive = true;
      if (previewOpen) preview();
    });
  }
  const showTerrain = () => {
    terrainList.replaceChildren(...terrain.map((layer, i) => {
      const row = document.createElement('li');
      row.textContent = `${layer.kind} at ${layer.x}, ${layer.z} · reach ${layer.reach} · seed ${layer.seed}`;
      if (i >= pinnedTerrain) {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'Remove'; remove.dataset.terrain = String(i);
        row.append(remove);
      }
      return row;
    }));
  };
  $('terrainAdd').addEventListener('click', () => {
    if (terrain.length >= 32) { terrainError.textContent = 'A world can hold up to 32 terrain layers.'; return; }
    const layer = terrainEntry(($<HTMLSelectElement>('terrainKind')).value,
      terrainInput('terrainX'), terrainInput('terrainZ'), terrainInput('terrainReach'), terrainInput('terrainSeed'));
    if (!layer) { terrainError.textContent = 'Use whole coordinates, a reach from 1 to 2048, and an optional whole seed.'; return; }
    terrainError.textContent = '';
    terrain.push(layer);
    previewFocus = 'terrain';
    previewDraftActive = false;
    showTerrain();
    if (previewOpen) preview();
  });
  terrainList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-terrain]');
    if (!button) return;
    terrain.splice(Number(button.dataset.terrain), 1);
    showTerrain();
    if (previewOpen) preview();
  });
  offerTheSwitches($('titleExtras'));
  root.classList.add('show');

  return new Promise<SlotChoice>((resolve) => {
    const finish = (choice: SlotChoice) => {
      previewVersion++;
      root.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      stopSky();
      if (choice.save) void store.save(choice.key, choice.save).then(() => resolve(choice));
      else resolve(choice);
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
          ${s && kindOf(s.world) === 'endless' ? `<button class="slot-edit" data-act="edit" data-slot="${i}" title="Edit this world" aria-label="Edit slot ${i + 1}">Edit</button>` : ''}
          ${s ? `<button class="slot-del" data-act="delete" data-slot="${i}" title="Delete this world" aria-label="Delete slot ${i + 1}">✕</button>` : ''}
        </div>`;
      }).join('');
    };
    const pick = (i: number, act: string) => {
      const key = SLOT_KEYS[i];
      // The tap that enters a world is the one moment a browser will give a page the whole screen,
      // so it is where it is asked for. On a phone the browser's own furniture is a fifth of the
      // glass and the game cannot be played through it; on anything else this does nothing at all.
      if (act !== 'delete' && act !== 'edit') void takeTheScreen();
      if (act === 'edit' && saves[i]) {
        editingSlot = i;
        const existing = saves[i]!;
        worldSeedInput.value = String(existing.seed);
        worldSeedInput.disabled = true;
        worldNameInput.value = existing.worldName ?? `World ${existing.seed}`;
        terrain.splice(0, terrain.length, ...(existing.manifest?.terrain ?? []));
        pinnedTerrain = terrain.length;
        mountains.splice(0, mountains.length, ...new Manifest(existing.seed, existing.manifest).layers());
        previewFocus = mountains.length ? 'mountain' : 'terrain';
        previewDraftActive = false;
        skyEyries.splice(0, skyEyries.length, ...new Manifest(existing.seed, existing.manifest)
          .byKind('eyrie').filter((a) => a.version === 2));
        showTerrain(); showMountains(); showSkyEyries(new Manifest(existing.seed, existing.manifest));
        $<HTMLButtonElement>('saveWorldEdits').hidden = false;
        ($('terrainEditor') as HTMLDetailsElement).open = true;
        previewOpen = true; preview();
        return;
      }
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
      if (editingSlot !== null) {
        editingSlot = null;
        worldSeedInput.disabled = false;
        $<HTMLButtonElement>('saveWorldEdits').hidden = true;
        terrain.length = 0; mountains.length = 0; skyEyries.length = 0;
        pinnedTerrain = 0;
        showTerrain(); showMountains(); showSkyEyries(new Manifest(0));
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
      if ((terrain.length > 0 || mountains.length > 0) && world !== 'endless') {
        worldError.textContent = 'Authored layers need endless country. Turn on that world first.';
        return;
      }
      const choiceFor = (seed: number, home?: GrownPatch): SlotChoice => ({
        key, seed, worldName, world, home,
        save: mountains.length ? { seed, world: 'endless', worldName,
          cam: { x: 0, z: 0, rot: 0, zoom: 1 },
          manifest: { rootSeed: seed, anchors: [...mountains], terrain: [...terrain] } }
          : terrainSave(seed, worldName, terrain),
      });
      /*
       * A seed somebody typed is theirs, and is handed over untouched.
       *
       * #323 is about the worlds the game *chooses*, and only those. A player who asks for 4815162342
       * has asked for that world — refusing it because a measurement dislikes it would make the seed
       * box a suggestion, and would make a shared link open a different country for the two people
       * holding it.
       */
      if (askedSeed) {
        finish(choiceFor(Number(askedSeed) >>> 0));
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
        finish(choiceFor(randomSeed()));
        return;
      }
      // Seed quality was measured for the unedited country. Authored terrain changes that answer.
      if (terrain.length > 0) {
        finish(choiceFor(randomSeed()));
        return;
      }
      /*
       * Otherwise: drawn, measured, and drawn again where nobody lives there.
       *
       * Measured *in the country worker*, which is the whole of #358. It used to be a `setTimeout`
       * on this thread, and a tick is not a thread: it bought one paint of the line below and then
       * froze everything — fourteen seconds on a slow machine, because a measurement grows a whole
       * patch and a rejected seed grows another. The spinner could not spin and a tap could not
       * land.
       *
       * The worker was already there for exactly this work: growing a patch off the thread the game
       * is drawn on. A measurement is that grow with the patch thrown away.
       *
       * `aWorldWorthOpening` stops at the first world worth opening, so the common cost is one
       * grow; only the worlds being rejected pay for a second, which is under one in twenty.
       */
      worldError.textContent = 'Finding a world worth walking into…';
      const reader = seedsReadOffThread();
      void aWorldWorthOpeningAsync(randomSeed, reader.read)
        .then((drawn) => {
          /*
           * And the patch it grew to decide, which the world now opens with rather than growing
           * the same square over again. Taken before the worker is closed and by seed rather than
           * by hand: up to `TRIES` patches were grown and only one of them is the world being
           * opened — see `SeedsRead.grownFor`, which answers nothing when the tries ran out and
           * the seed settled for is not the one last measured.
           */
          const home = reader.grownFor(drawn.seed);
          reader.close();
          finish(choiceFor(drawn.seed, home));
        })
        .catch(() => {
          /*
           * A worker that will not start is not a reason to refuse somebody a world.
           *
           * Blocked workers, a very old browser, a page served from a file — in any of them the
           * honest answer is the world they would have had before any of this existed, drawn and
           * unmeasured, rather than a title screen that never opens one.
           */
          reader.close();
          finish(choiceFor(randomSeed()));
        });
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

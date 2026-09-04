import * as THREE from 'three';
import { GAMEPLAY, GRAPH, WORLD } from './core/config';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { mulberry32 } from './core/rng';
import { createSceneRig } from './render/scene';
import { IsoCamera } from './render/camera';
import { PropLibrary } from './render/props';
import { DayCycle } from './render/daycycle';
import { ChunkManager } from './world/chunkManager';
import { attachIslands, generateRoadGraph, planIslands } from './world/graph';
import { Manifest } from './world/manifest';
import { FERRY, ferryStateAt, formatCountdown, makeFerryLines, worldSeconds, type FerryLine } from './game/ferry';
import { buildBoat } from './render/boat';
import { StructureKind, compassDir } from './world/structures';
import { ITEMS } from './game/shops';
import { COMBAT, spoils, swing } from './game/combat';
import { Market, RENT, askingPrice, lotLine } from './game/market';
import { STALL_DAYS } from '../server/protocol';
import { Places, REACH } from './game/places';
import { SEASON_NAMES, Season, isWet, seasonAffects, seasonOf, seasonTint } from './game/seasons';
import { SLOTS } from './game/items';
import { Weather } from './render/weather';
import { SeasonTintMaterials } from './render/seasontint';
import { FISHING, Fishing } from './game/fishing';
import { Journal } from './ui/journal';
import { Clock } from './ui/clock';
import { Compass, type CompassTarget } from './ui/compass';
import { PhotoMode } from './ui/photo';
import { HORSE, Mount } from './game/mount';
import { Online, applyTrade, tradableItems, type TradeOffer, type WorldDelta } from './game/online';
import { Coop } from './game/coop';
import { OtherPlayers } from './render/others';
import { Chat } from './ui/chat';
import { CROPS, Plots, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from './game/farming';
import { CropField } from './render/crops';
import { BOAT, Sailing } from './game/sailing';
import { HeroGear } from './render/herogear';
import { Rucksack } from './ui/rucksack';
import { $ as el } from './ui/dom';
import { TerrainSampler } from './world/terrain';
import { BIOMES, HUB_NAME, SEA_NAME } from './world/biomes';
import { villageAt } from './world/structures';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { Fog, renderMapBase, type MapMarker } from './ui/mapbase';
import { WorldMap } from './ui/worldmap';
import { DialogueBox, type DialogueNode } from './ui/dialogue';
import { LEGACY_KEY, showTitle } from './ui/title';
import { IndexedDbStore, type SaveStore, type SessionSave } from './save/store';
import { GameState } from './game/state';
import { dialogueFor } from './game/talk';
import { generateQuests } from './game/quests';
import { Sound } from './game/audio';
import { damageEntity, yawFor, type Entity } from './entities/entity';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { $ } from './ui/dom';
import { SALT, derive } from './core/salts';


async function boot(): Promise<void> {
  const store = new IndexedDbStore();
  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get('seed');

  let slotKey: string, saved: SessionSave | undefined, seed: number;
  if (urlSeed !== null && /^\d+$/.test(urlSeed)) {
    // share / dev link: play the given seed in a scratch session, skip the title screen
    seed = Number(urlSeed) >>> 0;
    slotKey = LEGACY_KEY;
    saved = await store.load<SessionSave>(LEGACY_KEY);
    if (saved?.seed !== seed) saved = undefined;
  } else {
    $('loading').style.display = 'none';
    const choice = await showTitle(store);
    slotKey = choice.key; saved = choice.save; seed = choice.seed;
    $('loading').style.display = 'block';
  }
  startGame(store, slotKey, saved, seed, url);
}

function startGame(store: SaveStore, slotKey: string, saved: SessionSave | undefined, seed: number, url: URL): void {
  const rig = createSceneRig($('gameContainer'));
  const iso = new IsoCamera();
  const input = new Input(rig.renderer.domElement);
  const props = new PropLibrary();
  const graph = generateRoadGraph(seed);
  const manifest = new Manifest(seed, saved?.manifest);
  if (manifest.byKind('island').length === 0) for (const p of planIslands(graph, seed)) manifest.ensure(p.id, 'island', p.x, p.z);
  attachIslands(graph, manifest.byKind('island'));
  const sampler = new TerrainSampler(graph);
  const structures = sampler.structures;
  const daycycle = new DayCycle(rig);
  rig.sunDriven = true;
  const chunks = new ChunkManager(rig.scene, sampler, props, rig.water.material, daycycle.glowMaterial);
  const hud = new Hud(rig, seed);
  hud.onLightChange = (sun, hemi) => daycycle.setDayIntensities(sun, hemi);
  const mapBase = renderMapBase(graph);
  const fog = new Fog(mapBase);
  const minimap = new Minimap($('minimapCanvas') as HTMLCanvasElement, mapBase, fog);
  const worldMap = new WorldMap(mapBase, fog);
  const entityRenderer = new EntityRenderer(rig.scene);
  const entities = new EntityManager(entityRenderer, chunks, chunks, seed, structures.villages);
  const dialogue = new DialogueBox();
  const sound = new Sound();
  const weather = new Weather(rig.scene);
  const seasonTintMaterials = new SeasonTintMaterials();
  const fishing = new Fishing();
  const journal = new Journal();
  const clock = new Clock();
  const compass = new Compass();
  const photo = new PhotoMode();
  const heroGear = new HeroGear(rig.scene);
  const castbar = el('castbar');
  chunks.useSeasonTint(seasonTintMaterials);
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));
  const mount = Mount.from(saved?.state?.horse ?? null, lineRng);

  // --- other people ---
  const chat = new Chat();
  const online = new Online({
    onChat: (line) => chat.line(line),
    onSystem: (line) => { chat.line(line, 'sys'); hud.flash(line); },
    // the world's own time wins while you are in it, so everyone shares a dawn
    onClock: (clock) => { state.day = clock.day; state.time = clock.time; state.version++; },
    onDelta: (delta, catchingUp) => applyWorldDelta(delta, catchingUp),
    onMonsters: (place, snap, gone) => {
      const floor = places.underground;
      if (!floor) return;
      const mine = coop.applySnap(place, snap, gone, floor.monsters, (m) => floor.monsters.despawnEntity(m));
      // the floor's owner resolved the blow, so the spoils are handed out here instead
      for (const fallen of mine) creditKill(fallen);
    },
    onHit: (place, index, damage) => {
      // we own this floor, so a blow reported by somebody else is resolved here
      const floor = places.underground;
      if (!floor || !coop.hosting || place !== placeName()) return;
      const monster = floor.monsters.onRoster(index);
      if (!monster || monster.dead) return;
      if (damageEntity(monster, damage, monster.x + 1, monster.z, floor.world)) floor.monsters.despawnEntity(monster);
    },
    onStalls: (stalls) => { market.receive(stalls); pendingCost = 0; pendingStock = null; },
    onBought: (_stall, item, cost) => {
      state.inventory.gold = Math.max(0, state.inventory.gold - cost);
      state.give(item.id, item.count);
      state.version++;
      sound.jingle();
      hud.flash(`Bought ${ITEMS[item.id]?.name ?? item.id} for ${cost} gold`);
      persist();
    },
    onTakings: (_stall, gold) => {
      state.inventory.gold += gold;
      state.version++;
      if (gold > 0) sound.jingle();
      hud.flash(gold > 0 ? `Took ${gold} gold from the stall` : 'Nothing sold yet');
      persist();
    },
    onStallRefused: (_stall, reason) => {
      // put back whatever we handed over in hope: the stall would not take it
      if (pendingStock) { state.give(pendingStock, 1); pendingStock = null; }
      if (pendingCost) { state.inventory.gold += pendingCost; pendingCost = 0; }
      state.version++;
      hud.flash(reason);
    },
    onOffer: (offer, fromName) => showOffer(offer, fromName),
    onTradeResult: ({ accepted, offer, iSent }) => {
      if (!accepted) { chat.line('The trade was declined.', 'sys'); return; }
      const what = applyTrade(state, offer, iSent);
      chat.line(iSent ? `You handed over ${what}.` : `You received ${what}.`, 'sys');
      hud.flash(iSent ? `Gave ${what}` : `Received ${what}`);
      persist();
    },
  });
  const market = new Market();
  /** The pitch we last walked up to, so the same stall is only announced once. */
  let noticedPitch = '';
  /** Say whose stall this is as you come to it: a bare awning looks the same as a busy one. */
  const noticeStall = (): void => {
    const pitch = market.nearest(structures.villages, player.x, player.z);
    if (!pitch || !pitch.stall) { noticedPitch = pitch ? noticedPitch : ''; return; }
    if (pitch.id === noticedPitch) return;
    noticedPitch = pitch.id;
    const stall = pitch.stall;
    const lots = stall.items.length;
    hud.flash(stall.owner === online.name
      ? `Your stall — ${stall.takings} gold taken`
      : `${stall.owner}'s stall — ${lots ? `${lots} lot${lots === 1 ? '' : 's'} out` : 'nothing out'}`);
  };
  /** Goods and gold sent to a stall that has not been answered for yet, so a refusal can undo them. */
  let pendingStock: string | null = null;
  let pendingCost = 0;

  /** Bank what a monster somebody else resolved for us left behind. */
  const creditKill = (fallen: Entity): void => {
    const won = spoils(state, fallen, seed);
    state.inventory.gold += won.gold;
    state.version++;
    sound.chime();
    const spoilsText = [won.gold > 0 ? `${won.gold} gold` : '', ...won.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
    hud.flash(spoilsText.length ? `Defeated ${fallen.kind.label} (+${spoilsText.join(', ')})` : `Defeated ${fallen.kind.label}`);
    persist();
  };
  const others = new OtherPlayers(entityRenderer);
  const coop = new Coop({
    sendSnap: (place, snap, gone) => online.monsters(place, snap, gone),
    sendHit: (place, index, damage) => online.hit(place, index, damage),
  });

  /**
   * Everything the server needs from us this frame, and everyone else drawn where they say they
   * are. It runs in every branch of the loop, because people underground are still people.
   */
  const syncOnline = (dt: number, heightAt: (x: number, z: number) => number | null): void => {
    const standingIn = placeName();
    online.update(dt, {
      x: player.x, z: player.z, yaw: player.entity.yaw, walk: player.entity.walk,
      place: standingIn, riding: sailing.sailing ? 'boat' : mount.riding ? 'horse' : 'foot',
      gear: SLOTS.map((slot) => state.worn(slot)?.id ?? '').filter(Boolean),
    });
    others.sync(online.players.values(), standingIn);
    others.settle(heightAt);
    others.project(iso.camera, window.innerWidth, window.innerHeight);
    onlineStatus.textContent = online.connected ? `online · ${online.count + 1} here` : online.status;
  };

  /** The world the hero is standing in: the surface, a dungeon floor, or a building. */
  const placeName = (): string => places.underground
    ? `${places.underground.poi.name}:${places.underground.floor}`
    : places.indoors ? places.indoors.title : 'surface';

  /**
   * Something a player changed about the world: a chest opened, a vault unlocked, a crop sown or
   * lifted, a place named. Applying it locally is all it takes, because the rest of the world is
   * identical on every client.
   */
  const applyWorldDelta = (delta: WorldDelta, catchingUp: boolean): void => {
    switch (delta.kind) {
      case 'chest':
        state.opened.add(delta.id);
        places.underground?.scene.rebuildProps(state.opened);
        break;
      case 'key':
        state.keys.add(delta.id);
        if (places.underground?.world.anchorId.startsWith(delta.id)) places.underground.world.unlocked = true;
        break;
      case 'sow': {
        const [tx, tz] = delta.tile.split(',').map(Number);
        plots.plant(tx, tz, delta.crop, delta.day);
        break;
      }
      case 'reap': {
        const [tx, tz] = delta.tile.split(',').map(Number);
        plots.harvest(tx, tz, Number.MAX_SAFE_INTEGER);
        break;
      }
      case 'found':
        discovered.add(delta.name);
        break;
    }
    state.version++;
    if (!catchingUp) persist();
  };
  chat.onSend = (text) => online.say(text);

  /** Somebody has offered you something: show it and let the player answer. */
  const showOffer = (offer: TradeOffer, fromName: string): void => {
    const parts = [offer.gold > 0 ? `${offer.gold} gold` : '', ...offer.items.map(([id, n]) => `${n}× ${ITEMS[id]?.name ?? id}`)].filter(Boolean);
    dialogue.start({
      speaker: fromName, emoji: '🤝',
      pages: [`${fromName} offers you ${parts.join(', ') || 'nothing at all'}.`],
      choices: [
        { label: 'Accept', next: () => { online.answer(offer.from, true); return null; } },
        { label: 'Decline', next: () => { online.answer(offer.from, false); return null; } },
      ],
    });
  };

  /** Offer the nearest player some of what you carry. */
  const offerTrade = (): void => {
    if (!online.connected) { hud.flash('Join a server first: options, then join this world online.'); return; }
    const target = online.nearest(player.x, player.z, 6);
    if (!target) { hud.flash('Nobody close enough to trade with.'); return; }
    const goods = tradableItems(state).slice(0, 5);
    dialogue.start({
      speaker: `Trade with ${target.name}`, emoji: '🤝',
      pages: [`You have ${state.inventory.gold} gold and ${goods.length} kind${goods.length === 1 ? '' : 's'} of goods to hand.`],
      choices: [
        ...(state.inventory.gold >= 25 ? [{ label: 'Offer 25 gold', next: () => { online.offer(target.id, 25, []); chat.line(`You offered ${target.name} 25 gold.`, 'sys'); return null; } }] : []),
        ...goods.map(([id, n]) => ({
          label: `Offer ${ITEMS[id].emoji} ${ITEMS[id].name}${n > 1 ? ` (of ${n})` : ''}`,
          next: () => { online.offer(target.id, 0, [[id, 1]]); chat.line(`You offered ${target.name} a ${ITEMS[id].name}.`, 'sys'); return null; },
        })),
        { label: 'Never mind', next: () => null },
      ],
    });
  };
  const plots = new Plots(saved?.state?.plots);
  const sailing = Sailing.from(saved?.state?.boat ?? null);
  const ownBoat = buildBoat();
  ownBoat.visible = false;
  rig.scene.add(ownBoat);
  const cropField = new CropField(rig.scene, props, daycycle.glowMaterial);

  // --- state ---
  const state = GameState.from(saved?.state ?? (saved ? { discovered: saved.discovered, inventory: saved.inventory } : undefined));
  const discovered = state.discovered;
  const urlTime = url.searchParams.get('t');
  if (urlTime !== null) state.time = Math.max(0, Math.min(0.999, Number(urlTime) || 0));
  fog.reveal(state.explored);
  const questList = generateQuests(structures, seed);
  /** One line describing what an errand asks for. */
  const questLine = (q: { kind: string; target: string; count: number }): string =>
    q.kind === 'visit' ? `find the ${q.target}` : `bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
  const quests = new Map(questList.map((q) => [q.village, q]));

  // --- ferries ---
  const ferries = makeFerryLines(structures, structures.villages, graph.islands).map((line) => {
    const mesh = buildBoat();
    rig.scene.add(mesh);
    return { line, mesh };
  });
  let riding: { line: FerryLine; dest: 'from' | 'to' } | null = null;
  // --- dungeons ---
  /** Name a place the first time the hero reaches it: toast, jingle, minimap mark. */
  const discover = (name: string): void => {
    if (discovered.has(name)) return;
    discovered.add(name);
    online.report({ kind: 'found', name });
    state.version++;
    hud.flash(`Discovered: ${name}`);
    sound.jingle();
    persist();
  };

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

  /**
   * A market pitch in a village square. Anyone online can rent one, put goods out at their own
   * price, and come back for the money; the goods stay out while the trader is away.
   */
  const tryStall = (): boolean => {
    const pitch = market.nearest(structures.villages, player.x, player.z);
    if (!pitch) return false;
    const speaker = 'Market Pitch';
    const emoji = '🏪';
    if (!online.connected) {
      dialogue.start({ speaker, emoji, pages: ['A trestle and a striped awning, waiting for a trader. Join a world online to take it on.'] });
      return true;
    }
    const stall = pitch.stall;

    if (!stall) {
      dialogue.start({ speaker, emoji, pages: [`An empty pitch in ${pitch.village}. ${RENT} gold holds it for ${STALL_DAYS} days.`], choices: [
        { label: `Rent it (${RENT}g)`, next: () => {
          if (state.inventory.gold < RENT) { hud.flash(`You need ${RENT} gold for the pitch.`); return null; }
          state.inventory.gold -= RENT;
          pendingCost = RENT;
          state.version++;
          online.rentStall(pitch.id, pitch.village);
          hud.flash('The pitch is yours. Put something out.');
          return null;
        } },
        { label: 'Leave it', next: () => null },
      ] });
      return true;
    }

    if (stall.owner === online.name) {
      const stockMenu = (): DialogueNode => {
        const carried = tradableItems(state).filter(([id]) => ITEMS[id]);
        return {
          speaker, emoji,
          pages: carried.length ? ['What goes out on the trestle?'] : ['Your pack is empty of anything worth selling.'],
          choices: [
            ...carried.slice(0, 8).map(([id]) => ({
              label: `${ITEMS[id].emoji} ${ITEMS[id].name} — ask ${askingPrice(id)}g`,
              next: () => {
                state.take(id, 1);
                pendingStock = id;
                state.version++;
                online.stockStall(stall.id, { id, price: askingPrice(id), count: 1 });
                hud.flash(`${ITEMS[id].name} is on the stall at ${askingPrice(id)} gold.`);
                return null;
              },
            })),
            { label: 'Never mind', next: () => null },
          ],
        };
      };
      const lots = stall.items.length ? stall.items.map(lotLine).join('\n') : 'Nothing out yet.';
      dialogue.start({ speaker: `Your stall in ${stall.village}`, emoji, pages: [
        `Rent paid until day ${stall.until}. Takings: ${stall.takings} gold.`,
        lots,
      ], choices: [
        { label: 'Put something out', next: stockMenu },
        { label: `Take the takings (${stall.takings}g)`, next: () => { online.collectStall(stall.id); return null; } },
        { label: 'Pack up the stall', next: () => { online.closeStall(stall.id); hud.flash('The pitch is free again.'); return null; } },
        { label: 'Leave it be', next: () => null },
      ] });
      return true;
    }

    dialogue.start({ speaker: `${stall.owner}'s stall`, emoji, pages: [
      stall.items.length ? 'Take your pick.' : 'The trestle is bare. Come back when the trader has been by.',
    ], choices: [
      ...stall.items.slice(0, 6).map((lot, index) => ({
        label: lotLine(lot),
        next: () => {
          if (state.inventory.gold < lot.price) { hud.flash(`That costs ${lot.price} gold.`); return null; }
          online.buyFromStall(stall.id, index);
          return null;
        },
      })),
      { label: 'Walk on', next: () => null },
    ] });
    return true;
  };

  /**
   * Reading the village board: the errand posted here, taken or not, and what the village knows
   * about places nearby. Accepting from the board saves hunting for the elder.
   */
  const tryBoard = (): boolean => {
    for (const village of structures.villages) {
      if (!village.board) continue;
      if (Math.hypot(village.board[0] - player.x, village.board[1] - player.z) > 2.2) continue;
      const quest = quests.get(village.name);
      const status = quest ? state.quests.get(quest.id) : undefined;
      const nearby = [...structures.pois, ...structures.caves, ...structures.wrecks]
        .map((p) => ({ name: p.name, d: Math.hypot(p.x - village.x, p.z - village.z), x: p.x, z: p.z }))
        .filter((p) => p.d < 120)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((p) => `${state.discovered.has(p.name) ? p.name : 'somewhere unnamed'} — ${compassDir(p.x - village.x, p.z - village.z)}, ${Math.round(p.d)} tiles`);

      const pages = [`Notices of ${village.name}.`];
      if (!quest) pages.push('Nothing posted but old nails and older paper.');
      else if (status === 'done') pages.push(`The elder's notice has been struck through: ${questLine(quest)}. Settled.`);
      else if (status === 'active') pages.push(`Posted: ${questLine(quest)}. You have taken this on.`);
      else pages.push(`Posted by the elder: ${questLine(quest)}. Reward ${quest.reward} gold.`);
      if (nearby.length) pages.push(`Roads from here:\n${nearby.join('\n')}`);

      const choices = quest && status === undefined
        ? [
            { label: `Take the errand (${quest.reward}g)`, next: () => {
              state.quests.set(quest.id, 'active');
              state.version++;
              sound.select();
              hud.flash(`Errand taken: ${questLine(quest)}`);
              persist();
              return null;
            } },
            { label: 'Leave it', next: () => null },
          ]
        : undefined;
      dialogue.start({ speaker: 'Notice Board', emoji: '📜', pages, choices });
      return true;
    }
    return false;
  };

  /** Enter/Space at a doorway steps inside. */
  const tryDoor = (): boolean => {
    for (const door of structures.doors) {
      if (Math.hypot(door.x - player.x, door.z - player.z) > REACH.BUILDING_DOOR) continue;
      places.enterBuilding(door);
      return true;
    }
    return false;
  };

  const dockTile = (line: FerryLine, end: 'from' | 'to'): [number, number] => {
    const pier = end === 'from' ? line.fromPier : line.toPier;
    const [x, z] = pier.tiles[pier.tiles.length - 1];
    return [x + 0.5, z + 0.5];
  };

  // --- hero + camera ---
  let startX = 0, startZ = 0;
  if (saved) {
    iso.rotation = saved.cam.rot;
    iso.zoom = saved.cam.zoom;
    iso.resize();
    if (saved.player) { startX = saved.player.x; startZ = saved.player.z; }
  }
  const px = url.searchParams.get('x'), pz = url.searchParams.get('z');
  if (px !== null && pz !== null) { startX = Number(px) || 0; startZ = Number(pz) || 0; }
  const player = new Player(chunks, entityRenderer, startX, startZ);
  iso.target.set(startX, 0, startZ);
  if (url.searchParams.get('cam') === 'free') player.mode = 'free';
  const places = new Places({
    seed, manifest, state, props, rig, iso, player,
    overworld: chunks, overworldRenderer: entityRenderer, heroGear,
    minimapCanvas: $('minimapCanvas') as HTMLCanvasElement,
    rng: lineRng,
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    setCaveAmbience: (on) => { sound.cave = on; },
    persist: () => persist(),
    report: (delta) => online.report(delta),
  });

  chunks.onFirstChunk = () => {
    hud.hideLoading();
    mount.restore(chunks, entityRenderer);
  };

  const persist = () => {
    void store.save<SessionSave>(slotKey, {
      seed,
      cam: { x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom },
      player: { x: player.x, z: player.z },
      state: { ...state.toJSON(), horse: mount.toJSON(), plots: plots.toJSON(), boat: sailing.toJSON() },
      manifest: manifest.toJSON(),
    });
  };
  const toTitle = () => { persist(); window.setTimeout(() => { window.location.href = window.location.pathname; }, 150); };

  // --- HUD / sound hooks ---
  hud.setVolume(sound.volume);
  hud.onVolumeChange = (v) => sound.setVolume(v);
  hud.onReturnToTitle = toTitle;
  const rucksack = new Rucksack(state);
  rucksack.onChange = (message) => { hud.flash(message); sound.select(); persist(); };
  hud.onOpenRucksack = () => rucksack.toggle();
  dialogue.onType = () => sound.blip();
  dialogue.onMove = () => sound.select();

  // --- talking ---
  const talkCtx = {
    state, rng: lineRng, quests, time: state.time,
    onInventoryChange: () => { sound.chime(); persist(); },
    onQuestChange: (q: { village: string }, status: 'active' | 'done') => {
      if (status === 'done') { sound.fanfare(); hud.flash(`Quest complete for ${q.village}!`); } else sound.select();
      persist();
    },
  };
  const startTalk = (e: Entity) => {
    talkCtx.time = state.time;
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };
  /** Board a docked ferry, or read the timetable at a pier. Returns false if no ferry is nearby. */
  const tryFerry = (): boolean => {
    const now = worldSeconds(state.day, state.time);
    for (const { line } of ferries) {
      const st = ferryStateAt(line, now);
      const nearBoat = Math.hypot(st.x - player.x, st.z - player.z) < FERRY.BOARD_RANGE;
      const nearFrom = Math.hypot(line.fromPier.dockX + 0.5 - player.x, line.fromPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      const nearTo = Math.hypot(line.toPier.dockX + 0.5 - player.x, line.toPier.dockZ + 0.5 - player.z) < FERRY.BOARD_RANGE + 1;
      if (st.docked && nearBoat) {
        const dest = st.docked === 'from' ? 'to' : 'from';
        const destName = dest === 'to' ? line.toName : line.fromName;
        dialogue.start({
          speaker: 'Ferryman', emoji: '⛵',
          pages: [`Ferry to ${destName}. We cast off in ${formatCountdown(st.departsIn)}. Coming aboard?`],
          choices: [
            { label: 'Board', next: () => { riding = { line, dest }; player.riding = true; sound.chime(); return null; } },
            { label: 'Not now', next: () => null },
          ],
        });
        return true;
      }
      if (nearFrom || nearTo) {
        const here = nearFrom ? 'from' : 'to';
        const destName = here === 'from' ? line.toName : line.fromName;
        dialogue.start({ speaker: 'Timetable', emoji: '🪧', pages: [`Ferry to ${destName}: next boat in ${formatCountdown(st.arrivesIn[here])}.`] });
        return true;
      }
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
    fishing.cast(spot[0], spot[1], sampler.probe(player.x, player.z).biome, seed, state.day, raining);
    sound.select();
    return true;
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
  /** Read a fingerpost: names and distances of the nearest settlements. */
  const trySignpost = (): boolean => {
    for (const post of structures.signposts) {
      if (Math.hypot(post.x - player.x, post.z - player.z) > 2.4) continue;
      const lines = post.directions.map((d) => `${d.name} — ${d.dir}, ${d.tiles} tiles`);
      dialogue.start({ speaker: 'Fingerpost', emoji: '🪧', pages: [lines.join('\n')] });
      return true;
    }
    return false;
  };

  /** Enter near a horse: buy a wild one, or get on and off your own. */
  const tryHorse = (): boolean => {
    if (mount.riding) {
      mount.dismount(player, chunks);
      hud.flash(`You dismount and tie up ${mount.name}.`);
      sound.select();
      persist();
      return true;
    }
    if (mount.near(player.x, player.z)) {
      mount.mount(player);
      hud.flash(`You swing up onto ${mount.name}.`);
      sound.chime();
      return true;
    }
    // horses in the field are half wild; the one you can buy is the stablehand's
    const hand = entities.within(player.x, player.z, GAMEPLAY.TALK_RANGE).find((e) => e.role === 'stablehand');
    if (!hand) return false;
    const price = HORSE.PRICE;
    const village = hand.herd.tag || 'the village';
    if (mount.owned) {
      dialogue.start({ speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾', pages: [`${mount.name} is a good horse. Mind the shoes.`] });
      return true;
    }
    dialogue.start({
      speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾',
      pages: [`I have ${mount.offer()} out back, saddle and all. ${price} gold and the halter is yours.`],
      choices: [
        { label: `Buy the horse (${price}g)`, next: () => {
          if (state.inventory.gold < price) {
            return { speaker: `${hand.name}, the Stablehand`, emoji: '🧑‍🌾', pages: [`Come back with ${price} gold.`] };
          }
          state.inventory.gold -= price;
          state.version++;
          const horse = mount.buy(hand.x + 1.5, hand.z, chunks, entityRenderer);
          sound.jingle();
          hud.flash(`${horse} is yours, stabled in ${village}. Press Enter beside them to ride.`);
          persist();
          return null;
        } },
        { label: 'Not today', next: () => null },
      ],
    });
    return true;
  };

  /**
   * Enter on bare earth near a village: sow a seed you are carrying, or lift a ripe crop.
   * Ground must be plain grass or sand within reach of a settlement, so fields stay near homes.
   */
  const tryFarm = (): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const standing = plots.at(tx, tz);
    if (standing) {
      if (!isRipe(standing, state.day)) {
        const crop = CROPS[standing.crop];
        const left = Math.max(1, Math.ceil(crop.days - (state.day - standing.planted)));
        hud.flash(`${crop.name} coming along: about ${left} day${left === 1 ? '' : 's'} to go (${Math.round(ripeness(standing, state.day) * 100)}%).`);
        return true;
      }
      const lifted = plots.harvest(tx, tz, state.day)!;
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
            plots.plant(tx, tz, crop.id, state.day);
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

  /** Enter at a pier or beside your own boat: buy one, cast off, or step ashore. */
  const tryBoat = (): boolean => {
    if (sailing.sailing) {
      const spot = sailing.land(chunks);
      if (!spot) { hud.flash('No shore within reach. Steer closer to land.'); return true; }
      player.teleport(spot[0], spot[1]);
      hud.flash('You step ashore and haul the boat up.');
      sound.select();
      persist();
      return true;
    }
    if (sailing.near(player.x, player.z)) {
      sailing.board();
      hud.flash('You cast off. W and S to row, A and D to steer, Enter to land.');
      sound.chime();
      return true;
    }
    // a pier is where boats are sold
    const pier = structures.piers.find((p) => Math.hypot(p.dockX + 0.5 - player.x, p.dockZ + 0.5 - player.z) < 4);
    if (!pier || sailing.bought) return false;
    dialogue.start({
      speaker: 'Boatwright', emoji: '🛶',
      pages: [`A little sailing boat, sound enough for these waters. ${BOAT.PRICE} gold and she is yours to take anywhere.`],
      choices: [
        { label: `Buy the boat (${BOAT.PRICE}g)`, next: () => {
          if (state.inventory.gold < BOAT.PRICE) {
            return { speaker: 'Boatwright', emoji: '🛶', pages: [`Come back with ${BOAT.PRICE} gold.`] };
          }
          state.inventory.gold -= BOAT.PRICE;
          state.version++;
          sailing.buy(pier.dockX + 0.5 + pier.dx, pier.dockZ + 0.5 + pier.dz, Math.atan2(-pier.dz, pier.dx));
          sound.jingle();
          hud.flash('The boat is yours, moored at the end of the pier.');
          persist();
          return null;
        } },
        { label: 'Another time', next: () => null },
      ],
    });
    return true;
  };

  const talkNearest = () => {
    if (places.indoors) {
      const inside = places.interactIndoors();
      if (inside === 'keeper') startTalk(places.indoors.keeper!);
      else if (inside === null) hud.flash('Stand at the door to leave, or at the counter to talk.');
      return;
    }
    if (places.underground) {
      const below = places.interactUnderground();
      if (below === 'locked') hud.flash('The door is locked. A key must be down here somewhere.');
      else if (below === 'descent') {
        dialogue.start({ speaker: 'Stairs Down', emoji: '🕳️', pages: ['The steps go further down, into colder air. Follow them?'], choices: [
          { label: 'Go deeper', next: () => { places.descend(); return null; } },
          { label: 'Not yet', next: () => null },
        ] });
      }
      else if (below === 'stairs') {
        dialogue.start({ speaker: 'Stairs', emoji: '🪜', pages: ['Climb back up to the daylight?'], choices: [
          { label: 'Climb out', next: () => { places.exitDungeon(); return null; } },
          { label: 'Stay', next: () => null },
        ] });
      } else if (below === null) hud.flash('Nothing here');
      return;
    }
    if (tryBoat()) return;
    if (tryHorse()) return;
    if (tryFarm()) return;
    if (tryStall()) return;
    if (tryBoard()) return;
    if (tryDoor()) return;
    if (tryShrine()) return;
    if (tryWreck()) return;
    if (tryCampfire()) return;
    if (trySignpost()) return;
    if (tryFerry()) return;
    if (tryFish()) return;
    const e = entities.nearest(player.x, player.z, GAMEPLAY.TALK_RANGE);
    if (e) startTalk(e); else hud.flash('No one close enough to talk to');
  };

  // --- keys ---
  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  const serverInput = el('serverInput') as HTMLInputElement;
  const nameInput = el('nameInput') as HTMLInputElement;
  const onlineStatus = el('onlineStatus');
  nameInput.value = localStorage.getItem('ai.world/name') ?? '';
  el('connectButton').addEventListener('click', () => {
    if (online.connected) { online.disconnect(); others.clear(); chat.hide(); return; }
    localStorage.setItem('ai.world/name', nameInput.value);
    online.connect(serverInput.value.trim(), seed, nameInput.value || 'Traveller', { day: state.day, time: state.time });
    chat.show();
  });

  input.onKey('t', () => { if (online.connected && !dialogue.isOpen && !chat.isTyping) chat.open(); });
  input.onKey('g', () => { if (!dialogue.isOpen && !chat.isTyping) offerTrade(); });

  input.onKey('p', () => {
    const on = photo.toggle();
    player.mode = on ? 'free' : 'follow';
    if (!on) hud.flash('Photo mode off');
  });
  input.onKey('m', () => {
    worldMap.dungeon = places.underground?.map ?? null;
    worldMap.toggle(mapInput());
  });
  input.onKey('c', () => { if (worldMap.isOpen) worldMap.centre(player.x, player.z); });
  input.onKey('+', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('=', () => { if (worldMap.isOpen) worldMap.zoomBy(1.25); });
  input.onKey('-', () => { if (worldMap.isOpen) worldMap.zoomBy(0.8); });
  let swingCooldown = 0;
  const attack = () => {
    if (dialogue.isOpen || swingCooldown > 0) return;
    swingCooldown = COMBAT.COOLDOWN;
    player.entity.attackCooldown = 0.45;
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    const res = swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, !coop.mirroring);
    for (const { index, damage } of res.reported) coop.reportHit(index, damage);
    if (res.hit.length === 0) { sound.select(); return; }
    sound.thud();
    if (res.killed.length > 0) {
      sound.chime();
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const spoils = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      hud.flash(spoils.length ? `Defeated ${names} (+${spoils.join(', ')})` : `Defeated ${names}`);
      persist();
    }
  };
  input.onKey('x', attack);
  input.onKey('n', toTitle);
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); journal.close(); rucksack.close(); worldMap.close(); });
  const journalInput = () => ({
    state, quests: questList, villages: structures.villages, pois: structures.pois,
    ferries: ferries.map((f) => f.line), seconds: worldSeconds(state.day, state.time),
    sites: [...structures.caves, ...structures.wrecks],
    playerX: player.x, playerZ: player.z,
  });
  input.onKey('j', () => { if (!dialogue.isOpen) journal.toggle(journalInput); });
  input.onKey('i', () => { if (!dialogue.isOpen) rucksack.toggle(); });
  for (const key of ['enter', ' ']) input.onKey(key, () => {
    if (chat.isTyping) return;
    if (photo.active) {
      // draw one more frame so the buffer holds exactly what is on screen, then read it back
      rig.renderer.render(rig.scene, iso.camera);
      const name = photo.save(rig.renderer.domElement, seed);
      sound.chime();
      window.setTimeout(() => hud.flash(`Saved ${name}`), 50);
      return;
    }
    if (dialogue.isOpen) dialogue.advance(); else talkNearest();
  });
  for (const key of ['arrowup', 'w']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(-1); });
  for (const key of ['arrowdown', 's']) input.onKey(key, () => { if (dialogue.isOpen) dialogue.move(1); });
  window.addEventListener('resize', () => { rig.resize(); iso.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  const onAttack = (attacker: Entity, dmg: number) => {
    if (dialogue.isOpen) return;
    hud.hurt();
    sound.thud();
    if (!state.damage(dmg)) return;
    if (places.underground) {
      // knocked out underground: dragged back to the surface, minus some gold
      const lostBelow = Math.min(GAMEPLAY.KO_GOLD_LOSS, state.inventory.gold);
      state.inventory.gold -= lostBelow;
      state.hp = state.maxHpTotal;
      state.version++;
      const name = places.underground.poi.name;
      places.exitDungeon();
      hud.flash(`${attacker.kind.label} got you. You crawl out of the ${name}${lostBelow ? `, ${lostBelow} gold lighter` : ''}.`);
      persist();
      return;
    }
    // knocked out: wake in the nearest town, lighter in the purse
    let home = structures.villages[0];
    for (const v of structures.villages) {
      if (Math.hypot(v.x - player.x, v.z - player.z) < Math.hypot(home.x - player.x, home.z - player.z)) home = v;
    }
    const lost = Math.min(GAMEPLAY.KO_GOLD_LOSS, state.inventory.gold);
    state.inventory.gold -= lost;
    state.hp = state.maxHpTotal;
    state.version++;
    player.teleport(home.x + 2, home.z + 2);
    hud.flash(`${attacker.kind.label} got you. You wake in ${home.name}${lost ? `, ${lost} gold lighter` : ''}.`);
    persist();
  };

  const markers = (): MapMarker[] => {
    const out: MapMarker[] = [
      ...structures.villages.map((v) => ({ x: v.x, z: v.z, color: '#ffffff', label: v.name })),
      ...structures.pois.filter((p) => discovered.has(p.name)).map((p) => ({ x: p.x, z: p.z, color: '#f1c40f', label: p.name })),
      ...structures.caves.filter((c) => discovered.has(c.name)).map((c) => ({ x: c.x, z: c.z, color: '#b07fd6', label: c.name })),
      ...structures.wrecks.filter((w) => discovered.has(w.name)).map((w) => ({ x: w.x, z: w.z, color: '#d68f5a', label: w.name })),
      ...ferries.map(({ line }) => {
        const st = ferryStateAt(line, worldSeconds(state.day, state.time));
        return { x: st.x, z: st.z, color: '#6fd3ff', label: st.docked ? 'ferry (docked)' : 'ferry' };
      }),
    ];
    // active quest targets stand out in green, ringed on the big map
    for (const q of questList) {
      if (state.quests.get(q.id) !== 'active') continue;
      const village = structures.villages.find((v) => v.name === q.village);
      if (village) out.push({ x: village.x, z: village.z, color: '#2ecc71', label: `${q.village} (errand)`, emphasis: true });
      if (q.kind === 'visit') {
        const poi = structures.pois.find((p) => p.name === q.target);
        if (poi) out.push({ x: poi.x, z: poi.z, color: '#2ecc71', label: `${q.target} (errand)`, emphasis: true });
      }
    }
    return out;
  };

  const mapInput = () => ({
    markers: markers(),
    playerX: player.x,
    playerZ: player.z,
    fog: !state.can('map'),
    title: places.underground
      ? `${places.underground.poi.name} Depths`
      : `${areaLabel} · ${state.clock()} · ${SEASON_NAMES[seasonOf(state.day)]}`,
  });

  let areaLabel = 'The Crossroads';

  /** POI > village > biome; discovering a POI flashes a toast. */
  const areaName = (): string => {
    for (const poi of structures.pois) {
      if (Math.hypot(poi.x - player.x, poi.z - player.z) >= GAMEPLAY.POI_DISCOVER_RADIUS) continue;
      discover(poi.name);
      return poi.name;
    }
    const v = villageAt(structures.villages, player.x, player.z);
    if (v) return v.name;
    const p = sampler.probe(iso.target.x, iso.target.z);
    return p.hub ? HUB_NAME : p.land ? BIOMES[p.biome].name : SEA_NAME;
  };

  /** What the compass points at: the errand first, then the nearest town. */
  const compassTargets = (): CompassTarget[] => {
    const targets: CompassTarget[] = [];
    for (const q of questList) {
      if (state.quests.get(q.id) !== 'active') continue;
      const done = q.kind === 'visit' ? state.discovered.has(q.target) : state.count(q.target) >= q.count;
      const village = structures.villages.find((v) => v.name === q.village);
      if (done) {
        if (village) targets.push({ label: `${q.village} (reward)`, x: village.x, z: village.z, primary: true });
      } else if (q.kind === 'visit') {
        const poi = structures.pois.find((p) => p.name === q.target);
        if (poi) targets.push({ label: q.target, x: poi.x, z: poi.z, primary: true });
      } else if (village) {
        targets.push({ label: `${q.village} (errand)`, x: village.x, z: village.z, primary: true });
      }
      if (targets.length >= 2) break;
    }
    let nearest = structures.villages[0];
    for (const v of structures.villages) {
      if (Math.hypot(v.x - player.x, v.z - player.z) < Math.hypot(nearest.x - player.x, nearest.z - player.z)) nearest = v;
    }
    if (nearest && !targets.some((t) => t.label.startsWith(nearest.name))) {
      targets.push({ label: nearest.name, x: nearest.x, z: nearest.z });
    }
    return targets;
  };

  /** The panels that follow the hero everywhere: hearts, clock, errands, area and toasts. */
  const updateHud = (dt: number, area: string, weatherGlyph = ''): void => {
    hud.syncState(state);
    clock.update(state);
    clock.setWeather(weatherGlyph);
    hud.setQuests(questList, state);
    hud.setArea(area);
    hud.tick(dt);
    rucksack.refresh();
    if (places.outdoors) compass.update(player.x, player.z, compassTargets());
    else compass.update(0, 0, []);
  };

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let frames = 0, fpsAccum = 0, fps = 0, saveTimer = 0, weatherStrength = 0, raining = false;

  // debug handle so headless screenshots can jump the calendar
  // headless screenshot hooks; stripped from production builds
  if (import.meta.env.DEV) {
    const debug = window as unknown as {
      __state?: unknown; __doors?: unknown; __player?: unknown;
      __teleport?: (x: number, z: number) => void; __standAtCounter?: () => void;
    };
    debug.__state = state;
    debug.__doors = structures.doors;
    (debug as { __villages?: unknown }).__villages = structures.villages;
    (debug as { __piers?: unknown }).__piers = structures.piers;
    (debug as { __descent?: () => unknown }).__descent = () => places.underground?.world.map.descent ?? null;
    (debug as { __boss?: () => unknown }).__boss = () => places.underground?.world.map.boss ?? null;
    (debug as { __descend?: () => void }).__descend = () => places.descend();
    (debug as { __plots?: () => unknown }).__plots = () => plots.count;
    (debug as { __place?: () => string }).__place = () => placeName();
    (debug as { __coop?: () => unknown }).__coop = () => ({
      hosting: coop.hosting, mirroring: coop.mirroring, id: online.id,
      others: [...online.players.values()].map((p) => `${p.id}@${p.place}`),
    });
    (debug as { __stalls?: () => unknown }).__stalls = () => {
      const village = structures.villages
        .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
        .sort((a, b) => a.d - b.d)[0]?.v;
      return village ? { village: village.name, pitches: market.pitchesOf(village) } : null;
    };
    (debug as { __enterShrine?: () => void }).__enterShrine = () => {
      const shrine = structures.pois.find((p) => p.kind === StructureKind.Shrine);
      if (shrine) places.enterDungeon(shrine);
    };
    (debug as { __monsters?: () => unknown }).__monsters = () =>
      (places.underground?.monsters.roster ?? []).map((m) => ({
        i: m.rosterIndex, kind: m.kind.id,
        x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100, hp: m.hp,
      }));
    (debug as { __sow?: (x: number, z: number) => void }).__sow = (x, z) => {
      plots.plant(x, z, 'wheat', state.day);
      online.report({ kind: 'sow', tile: `${x},${z}`, crop: 'wheat', day: state.day });
      state.version++;
    };
    (debug as { __discover?: (n: string) => void }).__discover = (n) => discover(n);
    (debug as { __reportChest?: (id: string) => void }).__reportChest = (id) => { state.opened.add(id); online.report({ kind: 'chest', id }); state.version++; };
    (debug as { __shrines?: unknown }).__shrines = structures.pois.filter((p) => p.kind === StructureKind.Shrine).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
      entities.within(player.x, player.z, 90).map((e) => ({ kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z }));
    (debug as { __entities?: () => unknown }).__entities = () =>
      entities.within(player.x, player.z, 60).map((e) => ({ kind: e.kind.id, name: e.name, x: e.x, z: e.z }));
    debug.__player = player;
    debug.__teleport = (x, z) => { player.teleport(x, z); iso.target.set(x, 0.5, z); };
    (debug as { __zoom?: () => void }).__zoom = () => { iso.zoom = 14; iso.resize(); };
    debug.__standAtCounter = () => {
      const spot = places.indoors?.world.map.keeper;
      if (spot) player.teleport(spot[0] + 0.5, spot[1] + 1.6);
    };
  }

  const loop = new GameLoop((dt, time) => {
    // the full-screen map pauses the world the way a conversation does
    if (worldMap.isOpen) {
      const panX = (input.isDown('d', 'arrowright') ? 1 : 0) - (input.isDown('a', 'arrowleft') ? 1 : 0);
      const panZ = (input.isDown('s', 'arrowdown') ? 1 : 0) - (input.isDown('w', 'arrowup') ? 1 : 0);
      worldMap.pan(panX, panZ, dt);
      worldMap.draw(mapInput());
    }
    const talking = dialogue.isOpen || worldMap.isOpen;
    iso.update(input, dt, player.mode === 'free' && !talking && !places.indoors);
    player.climb = state.climb;
    player.speedScale = mount.riding ? HORSE.SPEED : 1;
    if (sailing.sailing && !talking) {
      sailing.update(dt, {
        forward: (input.isDown('w', 'arrowup') ? 1 : 0) - (input.isDown('s', 'arrowdown') ? 1 : 0),
        turn: (input.isDown('a', 'arrowleft') ? 1 : 0) - (input.isDown('d', 'arrowright') ? 1 : 0),
      }, chunks, player);
      iso.target.x += (sailing.x - iso.target.x) * Math.min(1, dt * 6);
      iso.target.z += (sailing.z - iso.target.z) * Math.min(1, dt * 6);
    }
    player.update(input, iso, dt, talking || sailing.sailing, places.indoors !== null);
    dialogue.update(dt);
    rig.water.update(time);
    if (!talking) state.tick(dt);

    // hold the place for this frame: a bite can end it half way through
    const indoors = places.indoors;
    if (indoors) {
      frames++; fpsAccum += dt;
      if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
      // indoors: a fixed view of the room, the hero and whoever keeps the place
      indoors.renderer.update();
      heroGear.update(state, player.entity);
      syncOnline(dt, () => 0.5);
      updateHud(dt, indoors.title);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () => `${fps.toFixed(0)} fps  ${indoors.title}\ndraws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k\nEnter at the door to step outside`);
      rig.renderer.render(indoors.scene.scene, iso.camera);
      input.endFrame();
      saveTimer += dt;
      if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
      return;
    }

    const below = places.underground;
    if (below) {
      frames++; fpsAccum += dt;
      if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
      // underground: the hero, the monsters, the lights and the HUD tick
      below.scene.heroLight.position.set(player.x, player.y + 1.5, player.z);
      below.scene.heroLight.intensity = state.can('light') ? 9 : 3;
      // one player runs the monsters on a shared floor; everyone else mirrors what they are told
      coop.survey(online.id, placeName(), online.players.values());
      coop.age(dt);
      if (!coop.mirroring) below.monsters.update(dt, player.x, player.z, false, onAttack);
      coop.publish(dt, below.monsters);
      if (places.underground !== below) { input.endFrame(); return; }
      below.renderer.update();
      heroGear.update(state, player.entity);
      syncOnline(dt, (x, z) => below.world.heightAt(x, z));
      below.map.reveal(player.x, player.z);
      below.map.draw(player.x, player.z, state.opened, (i) => below.world.chestId(i), below.world.unlocked);
      updateHud(dt, below.floor > 1 ? `${below.poi.name} Depths · floor ${below.floor}` : `${below.poi.name} Depths`);
      sound.update(dt, player.entity.walk > 0.3 && !talking, true);
      hud.setDebug(dt, () =>
        `${fps.toFixed(0)} fps  ${below.poi.name} depths, floor ${below.floor}\n` +
        `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  monsters ${Math.max(0, below.monsters.count - 1)}\n` +
        `rooms ${below.world.map.rooms.length}  doors ${below.world.map.doors.length}  ${below.world.unlocked ? 'unlocked' : 'locked'}  pos ${player.x.toFixed(0)},${player.z.toFixed(0)}`);
      rig.renderer.render(below.scene.scene, iso.camera);
      input.endFrame();
      saveTimer += dt;
      if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
      return;
    }

    // ferries follow the clock; the hero rides along and steps off when the boat ties up
    const now = worldSeconds(state.day, state.time);
    for (const { line, mesh } of ferries) {
      const st = ferryStateAt(line, now);
      mesh.position.x = st.x; mesh.position.z = st.z;
      mesh.position.y = WORLD.WATER_Y - 0.12 + Math.sin(time * 1.3 + st.x) * 0.03;
      mesh.rotation.y = st.yaw;
      if (riding && riding.line === line) {
        player.entity.x = st.x + 0.2; player.entity.z = st.z; player.entity.y = WORLD.WATER_Y + FERRY.DECK_HEIGHT;
        player.entity.yaw = st.yaw;
        if (st.docked === riding.dest) {
          const [dx, dz] = dockTile(line, riding.dest);
          riding = null;
          player.riding = false;
          player.teleport(dx, dz);
          hud.flash(`Arrived at ${st.docked === 'to' ? line.toName : line.fromName}`);
          sound.jingle();
          persist();
        }
      }
    }
    const { x, z } = iso.target;
    chunks.update(x, z);
    rig.follow(x, z, iso.zoom);
    // season and weather: both derived from the day counter and the biome underfoot
    const here = sampler.probe(player.x, player.z);
    const season = seasonOf(state.day);
    const tint = seasonTint(season);
    const wetHere = isWet(seed, state.day, here.biome) ? 1 : 0;
    weatherStrength += (wetHere - weatherStrength) * Math.min(1, dt * 0.4);
    raining = weatherStrength > 0.5;
    if (seasonAffects(here.biome)) seasonTintMaterials.set(tint.ground, tint.frost);
    else seasonTintMaterials.set([1, 1, 1], 0);
    weather.set(weatherStrength, season);
    weather.update(dt, x, z, iso.camera.position.y * 0.35);
    daycycle.apply({ time: state.time, focusX: x, focusZ: z, heroX: player.x, heroY: player.y, heroZ: player.z, lanternOn: state.can('light'), season: tint, wet: weatherStrength });
    entities.update(dt, player.x, player.z, state.armed, onAttack, state.time);
    mount.update(player, chunks);

    syncOnline(dt, (x, z) => chunks.heightAt(x, z));
    noticeStall();
    ownBoat.visible = sailing.bought && places.outdoors;
    if (ownBoat.visible) {
      ownBoat.position.set(sailing.x, WORLD.WATER_Y - BOAT.DRAFT + Math.sin(time * 1.6 + sailing.x) * 0.03, sailing.z);
      ownBoat.rotation.y = sailing.yaw;
    }
    cropField.update(plots, state.day, player.x, player.z, (x, z) => chunks.heightAt(x, z));
    entityRenderer.update();
    heroGear.update(state, player.entity);

    if (state.markExplored(Math.floor(player.x / WORLD.CHUNK_SIZE), Math.floor(player.z / WORLD.CHUNK_SIZE))) fog.reveal(state.explored);
    areaLabel = areaName();
    updateHud(dt, areaLabel, weatherStrength > 0.4 ? (season === Season.Winter ? '❄' : '🌧') : '');
    if (fishing.active) {
      const ev = fishing.update(dt);
      if (ev === 'bite') sound.chime();
      if (ev === 'missed') hud.flash('It got away.');
      castbar.className = fishing.phase === 'bite' ? 'show bite' : fishing.phase === 'waiting' ? 'show' : '';
      castbar.textContent = fishing.phase === 'bite' ? 'A bite! Press Enter!' : raining ? 'Fishing in the rain… they are rising' : 'Fishing… wait for the bite';
    } else if (castbar.className !== '') {
      castbar.className = '';
    }
    journal.refresh(journalInput);
    hud.tick(dt);
    sound.setScene(here.biome, state.night);
    sound.update(dt, player.entity.walk > 0.3 && !talking, chunks.isRoad(player.x, player.z));

    swingCooldown = Math.max(0, swingCooldown - dt);
    if (input.clicked && !talking) {
      mouse.set((input.clickX / window.innerWidth) * 2 - 1, -(input.clickY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(mouse, iso.camera);
      const e = entities.pick(raycaster);
      if (e) {
        if (Math.hypot(e.x - player.x, e.z - player.z) < GAMEPLAY.CLICK_TALK_RANGE) startTalk(e);
        else hud.flash(`${e.name} the ${e.kind.label} is too far away`);
      }
    }

    frames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
    hud.setDebug(dt, () =>
      `${fps.toFixed(0)} fps  chunks ${chunks.stats.drawn}/${chunks.stats.loaded}  queue ${chunks.stats.pending}\n` +
      `draws ${rig.renderer.info.render.calls}  tris ${(rig.renderer.info.render.triangles / 1000).toFixed(0)}k  creatures ${entities.count}\n` +
      `roads ${graph.edges.length}  radius ${GRAPH.RADIUS}  pos ${x.toFixed(0)},${z.toFixed(0)}`);

    minimap.draw(x, z, iso.zoom, window.innerWidth / window.innerHeight, iso.rotation, markers(), player.x, player.z, !state.can('map'));
    rig.renderer.render(rig.scene, iso.camera);
    input.endFrame();

    saveTimer += dt;
    if (saveTimer > GAMEPLAY.AUTOSAVE_SECONDS) { saveTimer = 0; persist(); }
  });
  loop.start();
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.style.display = 'block';
  el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});

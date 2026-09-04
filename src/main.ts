import * as THREE from 'three';
import { GAMEPLAY, GRAPH, WORLD } from './core/config';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { mulberry32 } from './core/rng';
import { QUALITY, createSceneRig } from './render/scene';
import { WhaleSchool } from './render/whales';
import { PackField } from './render/remains';
import { Remains } from './game/remains';
import { WHALE, displayAt, planPods, podsWithin, whaleAt, type Pod } from './game/whales';
import { SeaHunt } from './game/seahunt';
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
import { COMBAT, struck, swing } from './game/combat';
import { createInteractions } from './game/interact';
import { createMultiplayer } from './game/multiplayer';
import { createReadouts } from './ui/readouts';
import { PING_LIFE } from '../server/protocol';
import { Places, REACH } from './game/places';
import { SEASON_NAMES, Season, isWet, seasonAffects, seasonOf, seasonTint } from './game/seasons';
import { Weather } from './render/weather';
import { SeasonTintMaterials } from './render/seasontint';
import { FISHING, Fishing } from './game/fishing';
import { Journal } from './ui/journal';
import { Clock } from './ui/clock';
import { Compass, type CompassTarget } from './ui/compass';
import { PhotoMode } from './ui/photo';
import { HORSE, Mount } from './game/mount';
import { Online, tradableItems, type TradeOffer, type WorldDelta } from './game/online';
import { Chat } from './ui/chat';
import { CROPS, Plots, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from './game/farming';
import { CropField } from './render/crops';
import { BOAT, Sailing } from './game/sailing';
import { HeroGear } from './render/herogear';
import { Rucksack } from './ui/rucksack';
import { TouchControls } from './ui/touch';
import { $ } from './ui/dom';
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
import { DOCTOR, dialogueFor, type TalkCtx } from './game/talk';
import { generateQuests } from './game/quests';
import { pubTalk } from './game/pub';
import { Sound } from './game/audio';
import { damageEntity, yawFor, type Entity } from './entities/entity';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { SALT, derive } from './core/salts';
import { Register } from './world/register';
import { Standing } from './game/standing';
import { Jail, clockAt, toldOnWaking, windOn } from './game/jail';
import { Gifts, type Kindness } from './game/gifts';
import { Rescues } from './game/rescue';
import { Nemesis, type Realm } from './game/nemesis';
import { HIRE, Hires } from './game/hire';
import { Magic, type SpellId } from './game/magic';
import { BOW, bowInHand, canShoot, quiver, shoot } from './game/archery';
import { goingOf, paceOf, stableAt, type Going } from './game/stables';
import { haulPace } from './game/woodcraft';
import { canBeCut } from './entities/monsters';
import { CampField } from './render/wildcamps';
import type { WildCamp } from './game/wildcamps';
import { remember } from './world/people';
import { gone, hauntsOf, toRaise, warningFor, type Haunt } from './game/haunts';
import { hashString } from './core/rng';


/** The world server's own port, which `chore world` also uses. */
const WORLD_PORT = 8787;

/**
 * Where to look for a world server, in the order somebody would expect: the address in the link,
 * then the one they used last, then the machine that served the page. Nobody should have to type
 * an address to play with the person sitting next to them.
 */
function defaultServer(url: URL): string {
  const given = url.searchParams.get('server');
  if (given) return given;
  const remembered = localStorage.getItem('ai.world/server');
  if (remembered) return remembered;

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || 'localhost';
  const servedPort = window.location.port;
  // A world server can hand out the game itself, and when it does, it is on the port the page
  // came from — the whole point of running one box at home. In development the page comes from
  // vite on another port, and the server is wherever it always is.
  const sameOrigin = !import.meta.env.DEV && servedPort !== '';
  return sameOrigin ? `${scheme}://${host}:${servedPort}` : `${scheme}://${host}:${WORLD_PORT}`;
}

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
  rig.setQuality(rig.quality);
  const iso = new IsoCamera();
  const input = new Input(rig.renderer.domElement);
  // the on-screen controls speak to the game only through `input`, so a thumb and a key are the
  // same press by the time anything below reads them
  const touch = new TouchControls(input);
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
  hud.onQualityChange = (level) => { rig.setQuality(level); hud.flash(`Graphics: ${QUALITY[level].label}`); };
  const mapBase = renderMapBase(graph);
  const fog = new Fog(mapBase);
  const minimap = new Minimap($('minimapCanvas') as HTMLCanvasElement, mapBase, fog);
  const worldMap = new WorldMap(mapBase, fog);
  const entityRenderer = new EntityRenderer(rig.scene);
  // who lives in the villages: founded from the seed, then born and buried as the days pass
  const register = new Register(seed);       // caught up to the saved day once the state is loaded
  const entities = new EntityManager(
    entityRenderer, chunks, chunks, seed, structures.villages,
    (id) => ITEMS[id]?.price ?? 4,
    (who) => fallen(who),
    register,
    (village) => structures.villages.some((v) => v.name === village && stableAt(v, seed) !== null),
    () => standing.guilt,
    (by) => arrested(by),
  );
  const dialogue = new DialogueBox();
  /**
   * The hero's own face, on the right of every conversation. It is seeded by the name they gave
   * themselves, so it is theirs and stays theirs, and their helmet decides what is on its head.
   */
  const heroFace = (): void => dialogue.setHero({
    id: `hero:${localStorage.getItem('ai.world/name') ?? 'Traveller'}`,
    trade: state.equipped.head ? 'soldier' : '',
    stage: 'adult',
  });
  const sound = new Sound();
  const weather = new Weather(rig.scene);
  const seasonTintMaterials = new SeasonTintMaterials();
  const fishing = new Fishing();
  const journal = new Journal();
  const clock = new Clock();
  const compass = new Compass();
  const photo = new PhotoMode();
  const heroGear = new HeroGear(rig.scene);
  const castbar = $('castbar');
  chunks.useSeasonTint(seasonTintMaterials);
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));
  const mount = Mount.from(saved?.state?.horse ?? null, lineRng);

  // --- other people ---
  const chat = new Chat();



  /** The world the hero is standing in: the surface, a dungeon floor, or a building. */
  const placeName = (): string => places.underground
    ? `${places.underground.poi.name}:${places.underground.floor}`
    : places.indoors ? places.indoors.title : 'surface';

  chat.onSend = (text) => {
    // a line beginning with a slash is a gesture, if it names one anybody knows
    const gesture = text.startsWith('/') ? text.slice(1).trim().toLowerCase() : '';
    if (gesture && online.emote(gesture)) return;
    online.say(text);
  };


  const plots = new Plots(saved?.state?.plots);
  const sailing = Sailing.from(saved?.state?.boat ?? null);
  const ownBoat = buildBoat();
  ownBoat.visible = false;
  rig.scene.add(ownBoat);
  const cropField = new CropField(rig.scene, props, daycycle.glowMaterial);

  // --- state ---
  const state = GameState.from(saved?.state ?? (saved ? { discovered: saved.discovered, inventory: saved.inventory } : undefined));
  register.advance(state.day);                // a world reopened after a week finds a village changed
  heroFace();                                 // the face on the right of every conversation
  /**
   * Where the hero stands between good and evil. The number lives on the save; this reads it,
   * and writes it back whenever a deed moves it, so there is one place that decides what a
   * killing is worth and one place that remembers.
   */
  const standing = new Standing(state.standing);
  /**
   * Breath, and whatever a spell is currently turning aside. Not saved: it refills in ten seconds,
   * so a save that remembered it would be remembering nothing.
   */
  const magic = new Magic();
  /**
   * The cells in the country's police stations: who is in them, and which of them are heaps of
   * timber. Not saved yet, so a reopened world finds every cell cold and every station standing.
   */
  const jail = Jail.from(saved?.state?.jail ?? null);
  /** Who the hero has been good to, and what each of them has decided about it. */
  const gifts = new Gifts(saved?.state?.gifts);
  /** Which villages somebody agreed to save, and what each of them owes them for it. */
  const rescues = new Rescues(saved?.state?.rescues);
  /** Where Old Nettle is up to: what he is doing, whether he is held, and when he is next abroad. */
  const nemesis = Nemesis.from(seed, saved?.nemesis);
  /** Everything his cycle needs to reach into, gathered when it is asked for rather than held. */
  const realm = (): Realm => ({ register, jail, villages: structures.villages, hero: online.name });
  /** The soldiers walking with somebody, and what was agreed with each. */
  const hires = new Hires();
  const discovered = state.discovered;
  const urlTime = url.searchParams.get('t');
  if (urlTime !== null) state.time = Math.max(0, Math.min(0.999, Number(urlTime) || 0));
  fog.reveal(state.explored);
  const elderErrands = generateQuests(structures, seed);
  // the elder's errand and the pub's, in one list: the journal, the map and the compass all read
  // it, so anything not in here is a job the player has taken on and cannot then find again
  const questList = [
    ...elderErrands,
    ...structures.villages.flatMap((v) => pubTalk(v, structures, seed)?.errand ?? []),
  ];
  /** One line describing what an errand asks for. */
  const questLine = (q: { kind: string; target: string; count: number }): string =>
    q.kind === 'visit' ? `find the ${q.target}` : `bring ${q.count}× ${ITEMS[q.target]?.name ?? q.target}`;
  // the elder has one errand to give, and it is theirs: the pub keeps its own
  const quests = new Map(elderErrands.map((q) => [q.village, q]));

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
    takeShare: (gold) => splitTakings(gold),
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
      state: { ...state.toJSON(), horse: mount.toJSON(), plots: plots.toJSON(), boat: sailing.toJSON(), gifts: gifts.save(), jail: jail.toJSON(), rescues: rescues.save() },
      manifest: manifest.toJSON(),
      nemesis: nemesis.toJSON(),
    });
  };

  // the multiplayer half of the game, and the dialogue that answers an offer of goods, which the
  // interaction layer below owns and hands back once it exists
  /** Late-bound the way the offer is: places is built before the interactions that split coin. */
  let splitTakings: (gold: number) => void = () => {};
  /** What a village you saved does for you, filled in once the interactions exist. */
  let villageWelcome: (village: string) => Kindness | null = () => null;
  let putOfferToPlayer: (offer: TradeOffer, fromName: string) => void = () => {};
  const multiplayer = createMultiplayer({
    register,
    player, state, places, plots, mount, sailing, entityRenderer, camera: iso.camera,
    dialogue, hud, chat, sound, questList, discovered, seed,
    placeName, persist, discover, showOffer: (offer, fromName) => putOfferToPlayer(offer, fromName),
  });
  const { online, market, party, duel, coop, others, handover, rally, playerList } = multiplayer;
  /**
   * Put the world away. The simulation is expensive — chunk workers, a webgl context, an audio
   * graph, a socket — and none of it should outlive the moment you leave for the title screen.
   */
  const shutDown = (): void => {
    loop.stop();
    input.dispose();
    touch.dispose();
    online.disconnect();
    others.clear();
    sound.dispose();
    places.dispose();
    chunks.dispose();
    entityRenderer.dispose();
    heroGear.dispose();
    weather.dispose();
    school.dispose();
    packField.dispose();
    cropField.dispose();
    props.dispose();
    rig.water.dispose();
    rig.renderer.dispose();
    rig.renderer.domElement.remove();
  };

  const toTitle = () => {
    persist();
    shutDown();
    // the page comes back to a clean title screen: nothing of this world is left running
    window.setTimeout(() => { window.location.href = window.location.pathname; }, 150);
  };

  /**
   * A hidden tab should cost nothing. The frame loop already stops when the browser stops asking
   * for frames, but the chunk workers and the audio graph do not, so they are stood down too.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { loop.stop(); chunks.pause(); sound.quiet(true); }
    else { chunks.resume(); sound.quiet(false); loop.start(); }
  });

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
  const talkCtx: TalkCtx = {
    state, rng: lineRng, quests, time: state.time, register, day: state.day,
    wordOfHim: (person) => interactions.wordOfHim(person),
    onInventoryChange: () => { sound.chime(); persist(); },
    onQuestChange: (q: { village: string; id?: string }, status: 'active' | 'done') => {
      if (status === 'done') {
        sound.fanfare();
        hud.flash(`Quest complete for ${q.village}!`);
        if (q.id) online.shareDeed(q.id);
      } else sound.select();
      persist();
    },
  };
  const startTalk = (e: Entity) => {
    talkCtx.time = state.time;
    talkCtx.day = state.day;
    heroFace();                                 // in case they have put a helmet on since last time
    // an innkeeper you have been good to stops charging you, and does not go back to charging:
    // that is the difference between a favour and a discount, and it is why generosity is worth
    // more than the gold it costs
    const host = e.person !== '' ? register.find(e.person) : undefined;
    const welcome = (host ? gifts.favourFrom(host) : null) ?? villageWelcome(e.herd.tag);
    const bed = welcome?.kind === 'lodging' ? 0 : ITEMS.room.price;
    // a doctor will see to you either way: coin buys the quick way, and everybody else waits.
    // Somebody who has been good to them is not charged at all, and is told so.
    const hurt = state.maxHpTotal - state.hp;
    talkCtx.mending = hurt <= 0 ? undefined : {
      price: welcome?.kind === 'mend' ? 0 : Math.max(4, Math.round(hurt * DOCTOR.A_HEART)),
      hearts: hurt,
      hours: DOCTOR.WAITING,
      take: (paid: boolean) => {
        if (paid) state.inventory.gold -= talkCtx.mending!.price;
        state.hp = state.maxHpTotal;
        state.version++;
        if (!paid) {
          // the hours are real: the world moves on while you sit in the corridor
          state.time += DOCTOR.WAITING / 24;
          while (state.time >= 1) { state.time -= 1; state.day++; }
          register.advance(state.day);
        }
        persist();
        sound.chime();
        return paid
          ? 'Stitched, bound and sent on your way inside the hour.'
          : `You sit in the corner until somebody has time for you. It is ${state.clock().split('·')[1].trim()} by the time you are out, and you are whole again.`;
      },
    };
    // a bed for the night, and in a shared world the night that cannot be skipped
    talkCtx.room = {
      price: bed,
      shared: online.connected,
      take: () => {
        state.inventory.gold -= bed;
        if (online.connected) {
          // the clock belongs to the world here, so the night passes for everybody or nobody
          state.hp = state.maxHpTotal;
          state.version++;
          persist();
          sound.chime();
          return 'You sleep a few hours behind a locked door and wake with your strength back. Outside, the night is still going.';
        }
        state.rest();
        persist();
        sound.chime();
        return 'You sleep soundly and wake at dawn, fully rested.';
      },
    };
    // the post shelf only exists in a shared world, and only knows the names that world has seen
    talkCtx.post = online.connected ? {
      folk: online.folk,
      collect: () => online.fetchMail(),
      send: (to: string, itemId: string, gold: number) => {
        handover.offer(state, itemId, gold);
        online.postMail(to, gold, [[itemId, 1]]);
        persist();
      },
    } : undefined;
    e.yaw = yawFor(player.x - e.x, player.z - e.z);
    e.state = 'idle';
    e.timer = 1e9;
    dialogue.start(dialogueFor(e, talkCtx), () => { e.timer = 1; });
  };





  // --- keys ---
  // packs left where people fell, and the bundles that show them
  const remains = new Remains();
  const packField = new PackField(rig.scene);

  /**
   * A constable has caught up with you.
   *
   * The sentence is served rather than skipped: the clock is wound forward, which means the world
   * moves on without you, villagers age and the market changes while you are inside. That is the
   * cost of being wanted, and it is more of a punishment than any number would be.
   */
  /**
   * What is underfoot, for deciding how fast a mount travels over it.
   *
   * Sampled when the hero crosses into a new tile rather than every frame: the going cannot change
   * without the tile changing, and terrain sampling is not free.
   */
  let goingTile = '';
  let going: Going = 'open';
  const goingUnderfoot = (): Going => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    const key = `${tx},${tz}`;
    if (key === goingTile) return going;
    goingTile = key;
    const tile = sampler.newSample();
    sampler.sampleTile(tx, tz, tile);
    going = goingOf(tile);
    return going;
  };

  /**
   * A constable has caught up with you, and now there is somewhere to put you.
   *
   * The sentence is served rather than skipped: the clock is wound forward, so the world moves on
   * without you, villagers age and the market changes while you are inside. That is more of a
   * punishment than any number would be. Where no station will take you the old arrangement
   * stands and you lose the hours in the square.
   */
  const arrested = (by: Entity): void => {
    const hours = standing.sentence();
    standing.served();
    state.standing = standing.value;
    const held = jail.take(structures.villages, by.x, by.z, 'you', hours, clockAt(state), state.day, state.inventory.gold);
    windOn(state, hours);
    register.advance(state.day);            // the village grew older while you were not watching
    // your own hours are served the moment the clock jumps, so the cell is empty behind you
    if (held) { state.inventory.gold -= held.fine; jail.release(held.village); }
    const cell = held ? [held.x, held.z] : (by.posts.square ?? [by.x, by.z]);
    player.teleport(cell[0], cell[1]);
    iso.target.set(cell[0], 0.5, cell[1]);
    state.version++;
    hud.flash(held
      ? `${by.name} takes you in. ${toldOnWaking(held)}`
      : `${by.name} takes you in. You come round in the square ${Math.round(hours)} hours later.`);
    sound.thud();
    persist();
  };

  /**
   * Somebody has been killed by something. They leave what they had where they fell, and if it
   * happened within sight you are told, because a scream in the middle distance is the point.
   */
  const fallen = (who: Entity): void => {
    // a hired man dies like any other villager: all that ends here is what he was owed
    const bargain = who.person !== '' ? hireFallen(who.person) : null;
    // a villager killed by something is off the register for good, and the people who knew them
    // are the only record of it left
    if (who.person !== '') {
      const death = register.bury(who.person, state.day);
      if (death) online.report({ kind: 'died', who: death.id, village: death.village, day: death.day });
    }
    // what he leaves is a soldier's pack: being in your pay was an arrangement, not a trade
    const trade = who.trade === HIRE.TREE ? HIRE.TRADE : who.trade;
    remains.leave(who.name, trade, who.x, who.z, who.purse, who.carrying?.id ?? null, seed ^ Math.floor(who.x * 131 + who.z * 977));
    if (Math.hypot(who.x - player.x, who.z - player.z) < GAMEPLAY.POI_DISCOVER_RADIUS * 6) {
      hud.flash(`${who.name} was killed. Their pack is where they fell.`);
      sound.thud();
    }
    if (bargain) hud.flash(`${bargain.name}, who you hired, is dead.`);
  };

  const interactions = createInteractions({
    player, state, discovered,
    structures, sampler, chunks, manifest, entities, entityRenderer, places, seed,
    market, party, duel, mount, sailing, plots, fishing, online, handover, remains, ferries, quests, register, jail,
    gifts, hires, standing, rescues, nemesis,
    dialogue, hud, chat, sound,
    raining: () => raining, discover, persist, startTalk, questLine,
  });
  const { atHand: talkNearest, offerTrade, partyMenu, noticeStall, takeShare, musterHires, hireFallen, hireMenu, tryGive } = interactions;
  splitTakings = takeShare;
  villageWelcome = interactions.villageWelcome;
  // something that comes to a camp in the night has to be put in the world by somebody who can
  interactions.onVisitor((kind, x, z) => {
    entities.spawnOne(kind, x, z, seed ^ Math.floor(x * 131 + z * 977));
  });
  // a camp its owner was coming back to has been gone through, and the nearest village hears of it
  interactions.onTheft((camp) => {
    const near = structures.villages.reduce((best, v) =>
      Math.hypot(v.x - camp.x, v.z - camp.z) < Math.hypot(best.x - camp.x, best.z - camp.z) ? v : best);
    const folk = register.living(near.name);
    if (folk.length === 0) return;
    remember(folk[Math.floor(lineRng() * folk.length)], { what: 'robbed', who: camp.who, day: state.day });
  });
  putOfferToPlayer = interactions.showOffer;

  input.onKey('k', () => { if (!dialogue.isOpen && !chat.isTyping) partyMenu(); });
  input.onKey('l', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to see who else is about.'); return; }
    playerList.toggle(multiplayer.playerListInput);
  });
  input.onKey('r', () => {
    if (dialogue.isOpen || chat.isTyping) return;
    if (!online.connected) { hud.flash('Join a world online to rally anybody.'); return; }
    online.ping(player.x, player.z);
    rally.push({ x: player.x, z: player.z, name: 'your', left: PING_LIFE });
    hud.flash(party.size ? 'Rally point marked for your party' : 'Rally point marked for everyone here');
  });
  input.onKey('o', () => hud.toggleOptions());
  input.onKey('f', () => { player.mode = player.mode === 'follow' ? 'free' : 'follow'; });
  const serverInput = $('serverInput') as HTMLInputElement;
  const nameInput = $('nameInput') as HTMLInputElement;
  const onlineStatus = $('onlineStatus');
  nameInput.value = localStorage.getItem('ai.world/name') ?? '';
  serverInput.value = defaultServer(url);
  $('connectButton').addEventListener('click', () => {
    if (online.connected) { online.disconnect(); others.clear(); chat.hide(); return; }
    const address = serverInput.value.trim();
    localStorage.setItem('ai.world/name', nameInput.value);
    localStorage.setItem('ai.world/server', address);
    online.connect(address, seed, nameInput.value || 'Traveller', { day: state.day, time: state.time });
    chat.show();
  });

  /**
   * An invite is this world and this server in one link, because "come and play in mine" should
   * not mean reading a seed and an address down the phone. The page already reads both back out
   * of the query string on arrival, so whoever opens it lands in the same world on the same
   * server without touching the options at all.
   */
  $('inviteButton').addEventListener('click', () => {
    const invite = new URL(window.location.href);
    invite.search = '';                       // drop wherever the sender happens to be standing
    invite.hash = '';
    invite.searchParams.set('seed', String(seed));
    const address = serverInput.value.trim();
    if (address) invite.searchParams.set('server', address);
    // a page served over https cannot open a plain ws:// socket, so an invite carrying one is a
    // dead link for everybody who follows it from the published site
    const blocked = window.location.protocol === 'https:' && address.startsWith('ws://');
    void navigator.clipboard.writeText(invite.href)
      .then(() => hud.flash(blocked ? 'Link copied, but a ws:// address will not open from an https page — use wss://' : 'Invite link copied'))
      .catch(() => window.prompt('Copy this invite link', invite.href));
  });

  input.onKey('t', () => { if (online.connected && !dialogue.isOpen && !chat.isTyping) chat.open(); });
  // the same gesture either way: hand something over. A villager takes precedence because they
  // are the one standing in front of you; a player offer is what it falls back to.
  input.onKey('g', () => { if (!dialogue.isOpen && !chat.isTyping && !tryGive()) offerTrade(); });
  input.onKey('y', () => { if (!dialogue.isOpen && !chat.isTyping) hireMenu(); });

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
  /** A hired man is re-marked now and then, because the world streams him out and back. */
  let musterIn = 0;
  const attack = () => {
    if (dialogue.isOpen || swingCooldown > 0) return;
    swingCooldown = COMBAT.COOLDOWN;
    player.entity.attackCooldown = 0.45;
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    if (duel.active) {
      const them = online.players.get(duel.opponent);
      if (them && duel.inReach(them, player.x, player.z, player.entity.yaw, COMBAT.ARC)) {
        duel.landed(state.attack);
        online.duelHit(state.attack);
        sound.thud();
        return;
      }
    }
    // Old Nettle is beaten rather than killed: the blow that would finish him raises the choice
    // instead, which is the whole design. He must never reach nought.
    const cornered = entities.within(player.x, player.z, COMBAT.RANGE)
      .some((e) => e.kind.id === 'nettle' && !e.dead && e.hp <= state.attack);
    if (cornered && interactions.heWentDown()) { sound.thud(); return; }

    const res = swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, !coop.mirroring, standing);
    // the ledger moves on every deed, not only on the ones that change what people call you
    state.standing = standing.value;
    for (const { index, damage } of res.reported) coop.reportHit(index, damage);
    if (res.hit.length === 0) {
      sound.select();
      // a blade that finds nothing where something plainly stands has to say why, or the rule
      // that a sword is no answer to a wight reads as a broken game rather than as the point
      const ghost = entities.within(player.x, player.z, COMBAT.RANGE).some((e) => !canBeCut(e.kind));
      if (ghost) hud.flash('Your blade passes through it.');
      return;
    }
    sound.thud();
    if (res.killed.length > 0) {
      sound.chime();
      for (const e of res.killed) { interactions.fell(e.kind.id, e.x, e.z); interactions.troubleKilled(e.kind.id, e.x, e.z); }
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const won = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      hud.flash(won.length ? `Defeated ${names} (+${won.join(', ')})` : `Defeated ${names}`);
      persist();
    }
    // said last so it is the line left on the screen: crossing into a worse standing is the more
    // important of the two things that just happened
    if (res.regard) { hud.flash(`You are ${res.regard}.`); persist(); }
  };
  let drawCooldown = 0;
  /**
   * Loose an arrow. A shot reaches things a swing cannot, because it measures its range as a
   * slant rather than along the ground: an eagle nine tiles up is nine tiles away to a bow and
   * out of the world to a sword.
   */
  const loose = (): void => {
    if (dialogue.isOpen || drawCooldown > 0) return;
    if (!canShoot(state)) {
      hud.flash(bowInHand(state) ? 'Your quiver is empty.' : 'You need a bow in your hand for that.');
      return;
    }
    drawCooldown = BOW.COOLDOWN;
    player.entity.attackCooldown = BOW.COOLDOWN;
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    const res = shoot(state, manager, world, player.x, player.z, player.entity.yaw, seed, !coop.mirroring, standing);
    state.standing = standing.value;
    for (const { index, damage } of res.reported) coop.reportHit(index, damage);
    if (res.hit.length === 0) { sound.select(); hud.flash(`Missed. ${quiver(state)} arrows left.`); return; }
    sound.thud();
    if (res.killed.length > 0) {
      sound.chime();
      for (const e of res.killed) { interactions.fell(e.kind.id, e.x, e.z); interactions.troubleKilled(e.kind.id, e.x, e.z); }
      const names = res.killed.map((e: Entity) => e.kind.label).join(', ');
      const won = [res.gold > 0 ? `${res.gold} gold` : '', ...res.loot.map((id) => ITEMS[id]?.name ?? id)].filter(Boolean);
      hud.flash(won.length ? `Shot ${names} (+${won.join(', ')})` : `Shot ${names}`);
      persist();
    }
    if (res.regard) { hud.flash(`You are ${res.regard}.`); persist(); }
  };

  /** Say a spell, and put whatever came of it on the screen. */
  const conjure = (id: SpellId): void => {
    if (dialogue.isOpen || chat.isTyping) return;
    const cast = magic.cast(id, state);
    hud.flash(cast.words);
    if (!cast.spell) { sound.select(); return; }
    sound.chime();
    if (!cast.blow) return;
    // a spell that strikes is a swing with a longer arm: same arc, same loot, same ledger, so
    // nothing about killing a thing depends on what killed it
    const world = places.underground?.world ?? chunks;
    const manager = places.underground?.monsters ?? entities;
    const res = swing(state, manager, world, player.x, player.z, player.entity.yaw, seed, !coop.mirroring, standing, cast.blow);
    state.standing = standing.value;
    for (const { index, damage } of res.reported) coop.reportHit(index, damage);
    if (res.killed.length > 0) {
      for (const e of res.killed) { interactions.fell(e.kind.id, e.x, e.z); interactions.troubleKilled(e.kind.id, e.x, e.z); }
      hud.flash(`Withered ${res.killed.map((e: Entity) => e.kind.label).join(', ')}`);
      persist();
    }
    if (res.gold > 0) takeShare(res.gold);
    if (res.regard) { hud.flash(`You are ${res.regard}.`); persist(); }
  };

  input.onKey('x', attack);
  // q and e are held down to turn the camera, so no spell may live on them
  input.onKey('z', loose);
  input.onKey('b', () => conjure('ward'));
  input.onKey('h', () => conjure('blight'));
  input.onKey('u', () => conjure('light'));
  input.onKey('v', () => conjure('draught'));
  input.onKey('n', toTitle);
  input.onKey('escape', () => { hud.closeOptions(); dialogue.close(); journal.close(); rucksack.close(); worldMap.close(); playerList.close(); });
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
    if (sailing.sailing && !sailing.overboard && attacker.kind.behaviour === 'circle') {
      // it came up under the hull: over the side, and now you are in the water with it
      sailing.throwOverboard();
      sound.splash();
      hud.flash(`${attacker.kind.label} hits the boat. You are in the water.`);
    }
    if (!struck(state, dmg, magic.ward)) return;
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
    if (sailing.sailing) sailing.abandon();   // whatever happened at sea, you are not at sea now
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



  let areaLabel = 'The Crossroads';




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
    (debug as { __scene?: unknown }).__scene = rig.scene;
    (debug as { __rig?: unknown }).__rig = rig;
    (debug as { __iso?: unknown }).__iso = iso;
    (debug as { __sampler?: unknown }).__sampler = sampler;
    (debug as { __pods?: () => unknown }).__pods = () => pods;
    (debug as { __sailing?: unknown }).__sailing = sailing;
    (debug as { __whaleY?: () => number[] }).__whaleY = () => {
      const now = worldSeconds(state.day, state.time);
      return pods.flatMap((pod) => Array.from({ length: pod.size }, (_, i) => Math.round(whaleAt(pod, i, now).y * 100) / 100));
    };
    (debug as { __three?: unknown }).__three = THREE;
    (debug as { __online?: unknown }).__online = online;
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
    (debug as { __drop?: () => void }).__drop = () => {
      remains.leave('Rolf the Hunter', 'hunter', player.x + 1.2, player.z, 23, 'pelt', 4242);
    };
    (debug as { __packs?: () => unknown }).__packs = () => remains.all;
    (debug as { __sow?: (x: number, z: number) => void }).__sow = (x, z) => {
      plots.plant(x, z, 'wheat', state.day + state.time);
      online.report({ kind: 'sow', tile: `${x},${z}`, crop: 'wheat', day: state.day });
      state.version++;
    };
    (debug as { __discover?: (n: string) => void }).__discover = (n) => discover(n);
    (debug as { __reportChest?: (id: string) => void }).__reportChest = (id) => { state.opened.add(id); online.report({ kind: 'chest', id }); state.version++; };
    (debug as { __shrines?: unknown }).__shrines = structures.pois.filter((p) => p.kind === StructureKind.Shrine).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    (debug as { __entitiesFull?: () => unknown }).__entitiesFull = () =>
      entities.within(player.x, player.z, 90).map((e) => ({ kind: e.kind.id, name: e.name, role: e.role, x: e.x, z: e.z }));
    (debug as { __entities?: () => unknown }).__entities = () =>
      entities.within(player.x, player.z, 60).map((e) => ({
        kind: e.kind.id, name: e.name, trade: e.trade, purse: e.purse, carrying: e.carrying?.id ?? '',
        x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 100) / 100, z: Math.round(e.z * 10) / 10,
        slot: e.slot, state: e.state, charging: Math.round(e.charging * 10) / 10, person: e.person, role: e.role,
      }));
    (debug as { __thin?: (village: string, n: number) => unknown }).__thin = (village, n) => {
      const doomed = [...register.living(village)].slice(0, n);
      for (const person of doomed) register.bury(person.id, state.day);
      return { village, buried: doomed.length, left: register.living(village).length, fortune: register.fortune(village) };
    };
    (debug as { __nettle?: () => unknown }).__nettle = () => ({
      where: nemesis.whereabouts,
      scheme: nemesis.scheme,
      standing: nettleAbout ? { x: Math.round(nettleAbout.x), z: Math.round(nettleAbout.z), hp: nettleAbout.hp } : null,
    });
    (debug as { __fortunes?: () => unknown }).__fortunes = () =>
      structures.villages.map((v) => ({ village: v.name, living: register.living(v.name).length, fortune: register.fortune(v.name) }));
    (debug as { __stables?: () => unknown }).__stables = () =>
      structures.villages.map((v) => {
        const stable = stableAt(v, seed);
        return { village: v.name, houses: v.houses.length, stock: stable?.stock.map((b) => b.id) ?? null };
      });
    (debug as { __pass?: (days: number) => unknown }).__pass = (days) => {
      state.day += Math.max(1, Math.floor(days));
      const changes = register.advance(state.day);
      return changes.map((c) => `day ${c.day}: ${c.name} ${c.kind}${c.cause ? ` (${c.cause})` : ''} in ${c.village}`);
    };
    (debug as { __talkTo?: (name: string) => unknown }).__talkTo = (name) => {
      const who = entities.within(player.x, player.z, 120).find((e) => e.name === name);
      if (!who) return null;
      talkCtx.day = state.day;
      const node = dialogueFor(who, talkCtx);
      return { speaker: node.speaker, pages: node.pages, choices: (node.choices ?? []).map((c) => c.label) };
    };
    (debug as { __register?: (village?: string) => unknown }).__register = (village) => {
      const here = village ?? structures.villages
        .map((v) => ({ v, d: Math.hypot(v.x - player.x, v.z - player.z) }))
        .sort((a, b) => a.d - b.d)[0]?.v.name ?? '';
      return {
        village: here, day: register.today,
        people: register.living(here).map((p) => ({
          name: p.name, trade: p.trade, born: p.born, lives: p.lives,
          mother: p.mother, father: p.father, knows: p.knows.length, memories: p.memories,
        })),
      };
    };
    debug.__player = player;
    debug.__teleport = (x, z) => { player.teleport(x, z); iso.target.set(x, 0.5, z); };
    (debug as { __zoom?: () => void }).__zoom = () => { iso.zoom = 14; iso.resize(); };
    (debug as { __quests?: () => unknown }).__quests = () => questList;
    (debug as { __markers?: () => unknown }).__markers = () => markers();
    (debug as { __finishQuest?: (id: string) => void }).__finishQuest = (id) => {
      const errand = questList.find((q) => q.id === id);
      if (!errand) return;
      state.quests.set(id, 'done');
      state.inventory.gold += errand.reward;
      state.version++;
      talkCtx.onQuestChange(errand, 'done');
    };
    (debug as { __enterInn?: () => string | null }).__enterInn = () => {
      for (const village of structures.villages) {
        const inn = village.shops.find((shop) => shop.type === 'inn');
        if (!inn) continue;
        const door = structures.doors.find((d) => d.bx === inn.house.tx && d.bz === inn.house.tz);
        if (!door) continue;
        places.enterBuilding(door);
        return village.name;
      }
      return null;
    };
    debug.__standAtCounter = () => {
      const spot = places.indoors?.world.map.keeper;
      if (spot) player.teleport(spot[0] + 0.5, spot[1] + 1.6);
    };
  }

  // --- whales ---
  const pods = planPods(sampler, seed);
  const seaHunt = new SeaHunt(seed);
  const school = new WhaleSchool(rig.scene);
  /** The hour we last announced each family in, so one word is one display. */
  const announced = new Map<Pod, number>();

  /**
   * Whales, every frame we are above ground: the near pods drawn where the clock says they are,
   * a word when a display begins within sight, and a soaking for anybody whose boat is under one
   * when it comes down.
   */
  // --- camps somebody else pitched ---
  const campField = new CampField(rig.scene);
  /** Camps in the country round the hero, worked out when they cross into a new chunk. */
  let campChunk = '';
  let campsNear: WildCamp[] = [];
  const watchCamps = (): void => {
    const key = `${Math.floor(player.x / WORLD.CHUNK_SIZE)},${Math.floor(player.z / WORLD.CHUNK_SIZE)}`;
    if (key !== campChunk) {
      campChunk = key;
      const span = WORLD.CHUNK_SIZE * 2;   // a chunk either side of the one they are standing in
      campsNear = interactions.campsAround(player.x - span, player.z - span, player.x + span, player.z + span);
    }
    campField.update(campsNear, interactions.campEmptied, (x, z) => chunks.heightAt(x, z));
  };

  // --- what keeps the old places ---
  /** How near the hero has to be for Old Nettle to be worth putting in the world at all. */
  const NETTLE_WITHIN = 70;
  const haunts = hauntsOf(seed, structures);
  /** The one keeper standing in the world, and the place it came out of. You are only ever in one. */
  let keeper: { haunt: Haunt; entity: Entity } | null = null;
  /** Places already spoken of, so one visit is one warning rather than a warning a second. */
  const warned = new Set<string>();

  /** The one of him standing in the world, and nothing while he is in a cell or between schemes. */
  let nettleAbout: Entity | null = null;
  const watchNettle = (): void => {
    const abroad = nemesis.whereabouts === 'abroad' || nemesis.whereabouts === 'choosing';
    const where = nemesis.scheme;
    if (!abroad || !where) {
      if (nettleAbout) { entities.despawnEntity(nettleAbout); nettleAbout = null; }
      return;
    }
    if (nettleAbout && !nettleAbout.dead) return;
    const village = structures.villages.find((v) => v.name === where.village);
    if (!village) return;
    // only once the hero is near enough to see it happen: he is rare, and being rare is the point
    if (Math.hypot(village.x - player.x, village.z - player.z) > NETTLE_WITHIN) return;
    nettleAbout = entities.spawnOne('nettle', village.x + 3, village.z + 3, seed ^ hashString(where.village));
  };

  const watchHaunts = (): void => {
    if (keeper) {
      const { haunt, entity } = keeper;
      if (entity.dead || gone(haunt, player.x, player.z, state.time)) {
        if (!entity.dead) entities.despawnEntity(entity);
        keeper = null;
        warned.delete(haunt.id);
      }
      return;
    }
    const rising = toRaise(haunts, player.x, player.z, state.time);
    if (!rising) return;
    const entity = entities.spawnOne(rising.kind, rising.x, rising.z, seed ^ hashString(rising.id));
    if (!entity) return;
    keeper = { haunt: rising, entity };
    if (warned.has(rising.id)) return;
    warned.add(rising.id);
    sound.thud();
    hud.flash(warningFor(rising));
  };

  const watchWhales = (now: number, dt: number): void => {
    const near = podsWithin(pods, player.x, player.z, WHALE.WATCH);
    const splashes = school.update(near, now, dt);

    for (const pod of near) {
      const { showing, hour } = displayAt(pod, now);
      if (!showing || announced.get(pod) === hour) continue;
      announced.set(pod, hour);
      sound.whalesong();
      hud.flash(`Whales are breaching — ${compassDir(pod.x - player.x, pod.z - player.z)}, ${Math.round(Math.hypot(pod.x - player.x, pod.z - player.z))} tiles`);
    }

    if (!sailing.sailing || sailing.overboard) return;
    for (const splash of splashes) {
      if (Math.hypot(splash.x - sailing.x, splash.z - sailing.z) > WHALE.SPLASH) continue;
      // thirty tonnes of whale onto a rowing boat: over the side you go
      sailing.throwOverboard();
      sound.splash();
      hud.hurt();
      state.damage(1);
      hud.flash('A whale comes down across the bow. You are in the water.');
      persist();
      break;
    }
  };

  const { markers, mapInput, areaName, compassTargets, updateHud, journalInput } = createReadouts({
    player, state, structures, sampler, discovered, questList, ferries, sailing, places, rucksack,
    hud, clock, compass,
    companyMarkers: multiplayer.markers,
    fogged: () => !state.can('map'),
    cameraTarget: () => iso.target,
    discover,
  });

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
    player.speedScale = haulPace(
      mount.riding ? paceOf(mount.breed, goingUnderfoot()) : 1,
      mount.riding,
      state.count('cart') > 0,
    );
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
    if (!talking) { state.tick(dt); magic.tick(dt); }
    // a day turning over is a day in the villages too: lives run out, and children are born
    for (const word of nemesis.advance(clockAt(state), realm())) chat.line(word.said, 'sys');
    for (const change of [...register.advance(state.day), ...interactions.villageNights()]) {
      if (change.kind === 'died' && discovered.has(change.village)) {
        chat.line(`Word from ${change.village}: ${change.name} has died.`, 'sys');
      }
    }

    // hold the place for this frame: a bite can end it half way through
    const indoors = places.indoors;
    if (indoors) {
      frames++; fpsAccum += dt;
      if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
      // indoors: a fixed view of the room, the hero and whoever keeps the place
      indoors.renderer.update();
      heroGear.update(state, player.entity);
      multiplayer.sync(dt, () => 0.5);
      updateHud(dt, indoors.title);
      hud.setBreath(magic.wind, magic.warded);
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
      below.scene.heroLight.intensity = state.can('light') || magic.lit ? 9 : 3;
      // one player runs the monsters on a shared floor; everyone else mirrors what they are told
      coop.survey(online.id, placeName(), online.players.values());
      coop.age(dt);
      if (!coop.mirroring) below.monsters.update(dt, player.x, player.z, false, onAttack);
      coop.publish(dt, below.monsters);
      if (places.underground !== below) { input.endFrame(); return; }
      below.renderer.update();
      heroGear.update(state, player.entity);
      multiplayer.sync(dt, (x, z) => below.world.heightAt(x, z));
      below.map.reveal(player.x, player.z);
      below.map.draw(player.x, player.z, state.opened, (i) => below.world.chestId(i), below.world.unlocked);
      updateHud(dt, below.floor > 1 ? `${below.poi.name} Depths · floor ${below.floor}` : `${below.poi.name} Depths`);
      hud.setBreath(magic.wind, magic.warded);
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
    const clockNow = worldSeconds(state.day, state.time);
    interactions.sailFerries(clockNow, time);
    watchWhales(clockNow, dt);
    watchHaunts();
    watchNettle();
    watchCamps();
    remains.age(dt);
    interactions.ageCamps(dt);
    interactions.runClock(dt);
    packField.update([...remains.all, ...interactions.carcasses()], (x, z) => chunks.heightAt(x, z));
    // something takes an interest in a boat that has been in deep water a while
    const arrived = seaHunt.update(dt, sailing.sailing, player.x, player.z, sampler, entities);
    if (arrived) {
      sound.thud();
      hud.flash(`${arrived} in the water. They are circling.`);
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
    daycycle.apply({ time: state.time, focusX: x, focusZ: z, heroX: player.x, heroY: player.y, heroZ: player.z, lanternOn: state.can('light') || magic.lit, season: tint, wet: weatherStrength });
    entities.update(dt, player.x, player.z, state.armed, onAttack, state.time, sailing.sailing);
    mount.update(player, chunks);

    multiplayer.sync(dt, (x, z) => chunks.heightAt(x, z));
    noticeStall();
    ownBoat.visible = sailing.bought && places.outdoors;
    if (ownBoat.visible) {
      ownBoat.position.set(sailing.x, WORLD.WATER_Y - BOAT.DRAFT + Math.sin(time * 1.6 + sailing.x) * 0.03, sailing.z);
      ownBoat.rotation.y = sailing.yaw;
    }
    cropField.update(plots, state.day + state.time, player.x, player.z, (x, z) => chunks.heightAt(x, z));
    entityRenderer.update();
    heroGear.update(state, player.entity);

    if (state.markExplored(Math.floor(player.x / WORLD.CHUNK_SIZE), Math.floor(player.z / WORLD.CHUNK_SIZE))) fog.reveal(state.explored);
    areaLabel = areaName();
    updateHud(dt, areaLabel, weatherStrength > 0.4 ? (season === Season.Winter ? '❄' : '🌧') : '');
    hud.setBreath(magic.wind, magic.warded);
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
    musterIn -= dt;
    if (musterIn <= 0) { musterIn = HIRE.MUSTER_EVERY; musterHires(); }
    drawCooldown = Math.max(0, drawCooldown - dt);
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

import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { mulberry32 } from './core/rng';
import { AutoQuality, everChoseQuality, rememberTheirChoice } from './render/autoquality';
import { QUALITY, createSceneRig } from './render/scene';
import { PackField } from './render/remains';
import { Remains } from './game/remains';
import { IsoCamera } from './render/camera';
import { PropLibrary } from './render/props';
import { mountainAt } from './world/ranges';
import { Wildlife } from './game/wildlife';
import { Skies } from './game/skies';
import { makeFerryLines } from './game/ferry';
import { buildBoat } from './render/boat';
import { ITEMS, sellPrice } from './game/shops';
import { Breath } from './game/breath';
import { createInteractions } from './game/interact';
import { createMultiplayer } from './game/multiplayer';
import { createReadouts } from './ui/readouts';
import { Places } from './game/places';
import { Weather } from './render/weather';
import { SeasonTintMaterials } from './render/seasontint';
import { Fishing } from './game/fishing';
import { Journal } from './ui/journal';
import { Clock } from './ui/clock';
import { Compass } from './ui/compass';
import { PhotoMode } from './ui/photo';
import { type TradeOffer } from './game/online';
import { Chat } from './ui/chat';
import { CropField } from './render/crops';
import { BuildingSite } from './render/site';
import { Beam } from './render/beam';
import { HeroGear } from './render/herogear';
import { Rucksack } from './ui/rucksack';
import { TouchControls } from './ui/touch';
import { $ } from './ui/dom';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { Fog, renderMapBase } from './ui/mapbase';
import { WorldMap } from './ui/worldmap';
import { DialogueBox } from './ui/dialogue';
import { keepSideways, thisBrowser, whenTurned } from './ui/sideways';
import { LEGACY_KEY, showTitle } from './ui/title';
import { IndexedDbStore, type SaveStore, type SessionSave, type WorldKind } from './save/store';
import { generateQuests } from './game/quests';
import { pubTalk } from './game/pub';
import { Sound } from './game/audio';
import { EntityRenderer } from './entities/pool';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { SALT, derive } from './core/salts';
import { Register } from './world/register';
import { type Kindness } from './game/gifts';
import { type Realm } from './game/nemesis';
import { Director } from './game/director';
import { claimedMines, mineIdOf } from './game/mines';
import { type Luxury } from './world/prosperity';
import { Hires } from './game/hire';
import { stableAt } from './game/stables';
import { remember } from './world/people';
import { installProbes } from './game/probes';
import { openConsole } from './game/console';
import { createDoorsteps } from './game/doorways';
import { createBlows } from './game/blows';
import { createWatch } from './game/watch';
import { createTidings } from './game/tidings';
import { createFrame } from './game/frame';
import { createMeeting } from './game/meeting';
import { createConsequences } from './game/consequences';
import { joinAWorld } from './game/joining';
import { growCountry } from './game/country';
import { streamTheCountry } from './game/streaming';
import { openTheSave } from './game/keeping';
import { bindKeys } from './game/keys';
import type { Screen } from './game/screen';
import { createAuthority } from './game/authority';

export function startGame(
  store: SaveStore, slotKey: string, saved: SessionSave | undefined, seed: number, url: URL,
  /**
   * Which world to grow. It comes from the save whenever there is one, because the same seed grows
   * two completely different countries and reopening a world as the other kind would put the ground
   * somewhere else under a house, a planted field and every anchor the manifest holds.
   */
  world: WorldKind,
): void {
  /**
   * Whether the player has ever picked a quality themselves — asked before anything else, because
   * the rig writes the level down every time it is set and the very next line sets it. Ask any
   * later and the game's own start-up looks exactly like somebody making a choice, so nothing
   * would ever be adjusted for anybody.
   */
  const qualityWasChosen = everChoseQuality();
  const rig = createSceneRig($('gameContainer'));
  rig.setQuality(rig.quality);
  const iso = new IsoCamera();
  const input = new Input(rig.renderer.domElement);
  // the on-screen controls speak to the game only through `input`, so a thumb and a key are the
  // same press by the time anything below reads them
  const touch = new TouchControls(input);
  const props = new PropLibrary();
  const seasonTintMaterials = new SeasonTintMaterials();
  // the ground this game is played on, and everything standing on it that was settled before
  // anybody arrived: the roads, the terrain, the mountains, the crags and the clouds
  const {
    graph, manifest, sampler, structures, highPlaces, daycycle, chunks, rock, skyline,
    eyries, skyIsles, skyRenderer,
  } = growCountry({ seed, world, rig, props, seasonTintMaterials, savedManifest: saved?.manifest });
  // the page's half of getting the country: what it kept first, and the world for the rest
  const { streamCountry, onParcel, tally: streamTally } = streamTheCountry({
    chunks, sampler, seed, world, want: (wanted) => online.wantChunks(wanted),
  });
  const hud = new Hud(rig, seed);
  hud.onLightChange = (sun, hemi) => daycycle.setDayIntensities(sun, hemi);
  hud.onQualityChange = (level) => {
    // their choice, and it stands: nothing measured afterwards may argue with it
    autoQuality.leaveItAlone();
    rememberTheirChoice();
    rig.setQuality(level);
    hud.flash(`Graphics: ${QUALITY[level].label}`);
  };
  // the map is drawn from the same terrain the ground is, plus the mountains, which stand on that
  // terrain rather than in it and would otherwise be missing from every map of a polygon world
  const mapBase = renderMapBase(graph, {
    probe: (x, z) => sampler.probe(x, z),
    rock: sampler.ranges ? (x, z) => mountainAt(sampler.ranges!, x, z) ?? 0 : undefined,
  });
  const fog = new Fog(mapBase);
  const minimap = new Minimap($('minimapCanvas') as HTMLCanvasElement, mapBase, fog);
  const worldMap = new WorldMap(mapBase, fog);
  const entityRenderer = new EntityRenderer(rig.scene);
  // who lives in the villages: founded from the seed, then born and buried as the days pass
  const register = new Register(seed);       // caught up to the saved day once the state is loaded
  const entities = new EntityManager(
    entityRenderer, chunks, chunks, seed, structures.villages,
    // What a villager is paid for what they sell — the same share of the shop price the player
    // gets, and for the same reason. They were being handed the full sticker price while the hero
    // got half of it for the identical pelt, which makes the world's economy a different economy
    // from the player's rather than the one they are both standing in.
    (id) => (ITEMS[id] ? sellPrice(ITEMS[id]) : 2),
    (who) => fallen(who),
    register,
    (village) => structures.villages.some((v) => v.name === village && stableAt(v) !== null),
    () => standing.guilt,
    (by) => arrested(by),
    // high country: on a mountain or against its flank, where the goats and the things that climb
    // are. Whichever kind of mountain this world grew — a massif, or a polygon range.
    (x, z) => highPlaces.some((m) => Math.hypot(x - m.x, z - m.z) < m.radius),
  );
  /**
   * The creatures the world says are there.
   *
   * When the simulation owns the wildlife — which it does the moment this client is connected to
   * one, whether that is a server or the thread next door — the game stops inventing its own and
   * draws what it is told. Two players in one field then see the same deer, which is the whole of
   * what phase three of docs/server-authority.md is for.
   */
  const wildlife = new Wildlife(entityRenderer, entities);
  /**
   * And the world's creatures on whatever floor the hero is standing on, when he is standing on one.
   *
   * A floor is a world of its own with its own monsters and its own numbering, so it gets its own
   * telling rather than sharing the country's. Null above ground, which is most of the time.
   */
  let floorLife: Wildlife | null = null;
  const dialogue = new DialogueBox();
  const sound = new Sound();
  const weather = new Weather(rig.scene);
  const fishing = new Fishing();
  const journal = new Journal();
  const clock = new Clock();
  const compass = new Compass();
  const photo = new PhotoMode();
  const heroGear = new HeroGear(rig.scene);
  // what a teleport looks like: the scene the light stands in, the pool the hero's rig comes apart
  // in, and what he is carrying, which goes with him rather than hangs there through the beam
  const beam = new Beam(rig.scene, entityRenderer, heroGear.group);
  const castbar = $('castbar');
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));

  const chat = new Chat();

  /** The world the hero is standing in: the surface, a dungeon floor, or a building. */
  const placeName = (): string => places.underground
    ? `${places.underground.poi.name}:${places.underground.floor}`
    : places.indoors ? places.indoors.title : 'surface';

  /**
   * What the hero has left to swing and guard with. The whole of the defensive game hangs off it:
   * swinging spends it, holding a guard drains it, and it only comes back when you are doing
   * neither — so there is now a reason to stop pressing the button.
   *
   * Not saved: it refills in seconds, so a save that remembered it would be remembering nothing.
   */
  const breath = new Breath();
  const ownBoat = buildBoat();
  ownBoat.visible = false;
  rig.scene.add(ownBoat);
  const cropField = new CropField(rig.scene, props, daycycle.glowMaterial);
  const buildingSite = new BuildingSite(rig.scene, props, daycycle.glowMaterial);

  // --- the save, opened out: everything the seed could not have worked out for itself ---
  const {
    state, standing, magic, jail, gifts, rescues, grudges, nemesis, roaming, mines,
    plots, houses, sailing, mount, persist,
  } = openTheSave({
    store, slotKey, seed, world, saved, structures, manifest,
    rng: lineRng,
    cam: () => ({ x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom }),
    at: () => ({ x: player.x, z: player.z }),
    sky: () => skies.save(),
  });
  register.advance(state.day);                // a world reopened after a week finds a village changed
  /** Everything Old Nettle's cycle needs to reach into, gathered when it is asked for rather than held. */
  const realm = (): Realm => ({ register, jail, villages: structures.villages, hero: online.name });
  /**
   * Which cave each village calls its mine. A pure function of the structures, so it is worked
   * out once: the ground does not move and neither do the villages standing on it.
   */
  const claimed = claimedMines(structures.villages, structures.caves);
  // said before anybody settles, because a village is founded once and its trades are fixed then:
  // tell the register after the fact and the mining village has already been raised without miners
  register.minesAt(claimed.keys());
  /**
   * What a village believes about its mine, for anybody who has to put it into words.
   *
   * Belief rather than fact on purpose. A mine the player emptied on Tuesday goes on being spoken
   * of as a death trap until somebody has walked back in to say otherwise, and that gap is the
   * point: it is what makes going back and telling them a thing worth doing.
   */
  const saidOfMine = (village: string): string => {
    const cave = claimed.get(village);
    return cave ? mines.saidOf(mineIdOf(cave)) : '';
  };
  /**
   * The mine the hero is currently swinging inside, or nothing.
   *
   * Only a cave counts. A vault and a thicket are places to go rather than places anybody works,
   * and counting a kill in one of those would quietly make safe a mine nobody has been near.
   */
  const fightingInAMine = (): string | null =>
    places.underground?.style === 'cave' ? places.underground.anchorId : null;
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

  // the boats that run between the islands, each with a hull in the scene to sail it
  const ferries = makeFerryLines(structures, structures.villages, graph.islands).map((line) => {
    const mesh = buildBoat();
    rig.scene.add(mesh);
    return { line, mesh };
  });
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

  // where the hero stands when the world opens: where he was left, or where a link says
  let startX = 0, startZ = 0;
  if (saved) {
    iso.rotation = saved.cam.rot;
    iso.restoreZoom(saved.cam.zoom);
    if (saved.player) { startX = saved.player.x; startZ = saved.player.z; }
  }
  const px = url.searchParams.get('x'), pz = url.searchParams.get('z');
  if (px !== null && pz !== null) { startX = Number(px) || 0; startZ = Number(pz) || 0; }
  const player = new Player(chunks, entityRenderer, startX, startZ);
  // whoever else is standing about, so the hero cannot walk through a cow or a shopkeeper. Set
  // after the fact because the crowd and the hero each need the other to exist first.
  player.crowd = entities;
  iso.target.set(startX, 0, startZ);
  if (url.searchParams.get('cam') === 'free') player.mode = 'free';
  const places = new Places({
    seed, manifest, state, props, rig, iso, player,
    overworld: chunks, overworldRenderer: entityRenderer, heroGear,
    minimapCanvas: $('minimapCanvas') as HTMLCanvasElement,
    rng: lineRng,
    takeShare: (gold) => splitTakings(gold),
    // who is down a hole today: `minesWorked` is declared below this, and the closure is only
    // called on the way into the ground, so there is nothing to hoist
    crewIn: (anchorId) => mines.whoIsDown(anchorId, minesWorked(), (v) => register.living(v)),
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    setCaveAmbience: (on) => { sound.cave = on; },
    persist: () => persist(),
    report: (delta) => online.report(delta),
    // A floor is the world's if there is a world listening. It grows the same rooms from the same
    // anchor name and owns what walks about in them; this side draws what it is told and spawns
    // nothing of its own.
    wentBelow: (below) => {
      if (!online.connected) return false;
      online.floor(below.place, below.anchorId, below.kind, below.floor);
      // built from what is handed over rather than from `places.underground`, which is not the
      // floor being entered yet: this is called on the way in, before the visit is the visit
      floorLife = new Wildlife(below.renderer, below.monsters);
      return true;
    },
    cameUp: () => { floorLife = null; },
  });

  /**
   * The world a blow is thrown in, when the world owns it, and null when it does not.
   *
   * The country and every dungeon floor are the world's; the inside of a building is nobody's but
   * this client's, because nothing has ever grown one anywhere else.
   */
  const battlefield = (): string | null => (places.indoors === null ? placeName() : null);

  chunks.onFirstChunk = () => {
    hud.hideLoading();
    mount.restore(chunks, entityRenderer);
  };

  // which half of the game is the authority, and what this half does when the other one speaks.
  // Built before the multiplayer half because the world's answers arrive through it.
  const { walked, walking, outdoors, heeding, bites } = createAuthority({
    seed, state, player, chunks, entities, places, sailing, sound, wildlife, placeName,
    floorLife: () => floorLife,
    aloft: () => skies.aloft !== null,
    steer: (seq, dx, dz, pace, dt) => online.steer(seq, dx, dz, pace, dt),
    bitten: (attacker, damage) => onAttack(attacker, damage),
  });

  // the multiplayer half of the game, and the dialogue that answers an offer of goods, which the
  // interaction layer below owns and hands back once it exists
  /** Late-bound the way the offer is: places is built before the interactions that split coin. */
  let splitTakings: (gold: number) => void = () => {};
  /** What a village you saved does for you, filled in once the interactions exist. */
  let villageWelcome: (village: string) => Kindness | null = () => null;
  let putOfferToPlayer: (offer: TradeOffer, fromName: string) => void = () => {};
  const multiplayer = createMultiplayer({
    register, hires,
    player, state, breath, mines, places, plots, houses, mount, sailing, entityRenderer, camera: iso.camera,
    dialogue, hud, chat, sound, questList, discovered, seed,
    // a command from whoever operates this world goes to the same bus a console does
    runCommand: (line, issuer) => { commands.run(line, issuer); },
    ...heeding,
    /*
     * A piece of the world, arriving as bytes.
     *
     * Unpacked only far enough to know where it belongs; the drawing of it is a worker's business
     * and the keeping of it is the store's. A chunk for country the player has already walked away
     * from is dropped by the chunk manager, which is the only thing here that knows where they are.
     */
    onParcel,
    placeName, persist, discover, showOffer: (offer, fromName) => putOfferToPlayer(offer, fromName),
  });
  const { online, market, party, duel, warband, others, handover, rally, playerList } = multiplayer;
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
    beam.dispose();
    weather.dispose();
    watch.dispose();
    skyRenderer.dispose();
    packField.dispose();
    cropField.dispose();
    buildingSite.dispose();
    props.dispose();
    rig.water.dispose();
    rig.coast.dispose();
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

  // the panels, and the noises they make
  hud.setVolume(sound.volume);
  hud.onVolumeChange = (v) => sound.setVolume(v);
  hud.onReturnToTitle = toTitle;
  const rucksack = new Rucksack(state);
  rucksack.onChange = (message) => { hud.flash(message); sound.select(); persist(); };
  hud.onOpenRucksack = () => rucksack.toggle();
  dialogue.onType = () => sound.blip();
  dialogue.onMove = () => sound.select();

  // stopping in front of somebody: everything a person offers you, worked out at the moment you
  // speak to them
  const { heroFace, startTalk, talkCtx } = createMeeting({
    state, player, register, grudges, jail, standing, gifts, online, handover, sound, dialogue, quests, persist,
    rng: lineRng,
    villageWelcome: (village) => villageWelcome(village),
    wordOfHim: (person) => interactions.wordOfHim(person),
    saidOfMine,
    indoors: () => places.indoors?.door ?? null,
    flash: (message) => hud.flash(message),
  });
  heroFace();                                 // the face on the right of every conversation

  // packs left where people fell, and the bundles that show them
  const remains = new Remains();
  const packField = new PackField(rig.scene);

  // and what the country does about what the hero just did: a village that has heard about its
  // cow, a cell with your name on it, a pack on the ground where somebody fell
  const { rustled, arrested, fallen } = createConsequences({
    seed, state, player, iso, structures, register, grudges, standing, jail, online, remains,
    sound, persist,
    flash: (message) => hud.flash(message),
    oneFell: (who) => watch.oneFell(who),
    hireFallen: (person) => hireFallen(person),
  });
  const skies = new Skies({
    player, iso, ground: chunks,
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    discover, persist: () => persist(),
  }, skyIsles);
  // a world put away while the hero was up in the clouds opens with them still up there. Without
  // it they come back at the same coordinates with the island no longer under their feet, which
  // is a spawn over open sea and a save that cannot be walked out of.
  if (saved?.sky) skies.restore(saved.sky);

  const interactions = createInteractions({
    player, state, discovered, eyries, skies,
    luxuryOf: (v) => villageLuxury.get(v) ?? 'none',
    saidOfMine,
    structures, sampler, chunks, manifest, entities, entityRenderer, places, seed,
    market, party, duel, mount, sailing, plots, houses, grudges, fishing, online, handover, remains, ferries, quests, register, jail,
    gifts, hires, standing, rescues, nemesis,
    callOut: (to) => multiplayer.callOut(to),
    dialogue, hud, chat, sound,
    raining: () => frames.raining(), discover, persist, startTalk, questLine,
    told: (delta) => online.report(delta),
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

  // whose world this is: the one in the next thread until somebody asks for another
  joinAWorld({
    seed, world, state, online, url,
    forgetOthers: () => others.clear(),
    showChat: () => chat.show(),
    hideChat: () => chat.hide(),
    flash: (message) => hud.flash(message),
  });
  /**
   * How hard the world is currently looking for the player. A fight, a band on the road and a
   * scheme in a village all report to it, and everything that stands something up in the world
   * asks it how far to look — so it is built before any of them.
   */
  const director = new Director();

  const blows = createBlows({
    seed, state, player, places, chunks, entities, structures, standing, breath, magic, mines,
    online, duel, warband, hires, sailing, skies, sound, director,
    talking: () => dialogue.isOpen,
    typing: () => chat.isTyping,
    flash: (message) => hud.flash(message),
    hurt: () => hud.hurt(),
    converse: (node) => dialogue.start(node),
    fightingInAMine, battlefield, rustled, persist,
    fell: (kind, x, z) => interactions.fell(kind, x, z),
    troubleKilled: (kind, x, z) => interactions.troubleKilled(kind, x, z),
    heWentDown: () => interactions.heWentDown(),
    takeShare: (gold) => takeShare(gold),
  });
  const { attack, loose, conjure, onAttack, announceWindUps, knockOut } = blows;

  // the console, and everything the game can be told to do through it
  // walking into a door goes in; the key is what you use when you are already standing on the step
  const doorsteps = createDoorsteps(places, () => structures.doors);

  const { commands, commandWorld, bound, arriving } = openConsole({
    seed, state, player, iso, places, structures, sampler, entities, register, online, chat,
    plots, remains, hires, eyries, skyIsles, beam, placeName, discover,
    areaLabel: () => frames.areaLabel(),
    flash: (message) => hud.flash(message),
  });

  // what the world stands up round the hero: the bands, Old Nettle, the keepers, the whales and
  // the camps somebody else pitched
  const watch = createWatch({
    seed, player, state, structures, sampler, chunks, entities, roaming, nemesis, director,
    sailing, sound, persist,
    scene: rig.scene,
    flash: (message) => hud.flash(message),
    hurt: () => hud.hurt(),
    knockOut,
    campsAround: (x0, z0, x1, z1) => interactions.campsAround(x0, z0, x1, z1),
    campEmptied: (camp) => interactions.campEmptied(camp),
  });

  /** What each village has built for itself, by name. Empty until somewhere gets rich. */
  const villageLuxury = new Map<string, Luxury>();
  // and everything the country did overnight, which is most of what makes it a country
  const tidings = createTidings({
    seed, state, player, places, structures, sampler, register, roaming, nemesis, mines, online,
    remains, sound, director, claimed, villageLuxury, discovered, realm, persist,
    builderDay: () => interactions.builderDay(),
    villageNights: () => interactions.villageNights(),
    say: (line) => chat.line(line, 'sys'),
    flash: (message) => hud.flash(message),
  });
  const { minesWorked } = tidings;

  const { markers, mapInput, areaName, compassTargets, updateHud, journalInput } = createReadouts({
    player, state, structures, sampler, discovered, questList, ferries, sailing, places, rucksack,
    hud, clock, compass,
    bound,
    companyMarkers: multiplayer.markers,
    fogged: () => !state.can('map'),
    cameraTarget: () => iso.target,
    discover,
  });

  /*
   * The screen, as the game asks for it.
   *
   * This is the one place that knows both halves — that "leave whatever I am in" means closing six
   * particular panels, and that a conversation is a `DialogueBox`. The keyboard is told none of it:
   * it asks for a journal, and something here knows where the journal is kept.
   */
  const screen: Screen = {
    busy: () => (chat.isTyping ? 'typing'
      : dialogue.isOpen ? 'talking'
      : photo.active ? 'framing'
      : worldMap.isOpen ? 'reading'
      : null),
    say: (line) => hud.flash(line),
    toggleJournal: () => journal.toggle(journalInput),
    toggleRucksack: () => rucksack.toggle(),
    toggleOptions: () => hud.toggleOptions(),
    toggleMap: () => {
      worldMap.dungeon = places.underground?.map ?? null;
      worldMap.toggle(mapInput());
    },
    toggleCompany: () => playerList.toggle(multiplayer.playerListInput),
    togglePhoto: () => photo.toggle(),
    toggleConsole: () => chat.toggleConsole(),
    openChat: () => chat.open(),
    closeEverything: () => {
      hud.closeOptions(); dialogue.close(); journal.close();
      rucksack.close(); worldMap.close(); playerList.close();
    },
    advanceTalk: () => dialogue.advance(),
    moveTalk: (by) => dialogue.move(by),
    nudgeTalk: (by) => dialogue.nudge(by),
    centreMap: (x, z) => worldMap.centre(x, z),
    zoomMap: (by) => worldMap.zoomBy(by),
    takePhoto: () => photo.save(rig.renderer.domElement, seed),
  };

  // what every key does, in one place
  bindKeys({
    seed, input, rig, iso, player, places, online, sound, screen,
    attack, loose, conjure, talkNearest, partyMenu, hireMenu, offerTrade, tryGive, toTitle,
    persist, rally,
    partySize: () => party.size,
  });

  // the handles a headless browser drives this by; stripped from production builds. Hung on at the
  // end because they reach into everything, and everything now exists.
  if (import.meta.env.DEV) {
    installProbes({
      seed, world, state, player, rig, iso, sampler, structures, chunks, entities, register, places,
      online, market, warband, remains, plots, houses, sailing, skies, skyIsles, eyries, mines, jail,
      roaming, nemesis, director, claimed, minesWorked, fightingInAMine, questList, talkCtx, commands,
      commandWorld, placeName, walking, bites, doorsteps, streamTally,
      drift: () => wildlife.drift(),
      pods: watch.pods,
      nettleAbout: watch.nettleAbout,
      sentOut: watch.sentOut,
      callOut: (to) => multiplayer.callOut(to),
      carcasses: () => interactions.carcasses(),
      markers: () => markers(),
      heard: () => frames.heard(),
    });
  }

  /**
   * Watches the frame times and turns the picture down if the machine cannot hold sixty.
   *
   * Only for somebody who has never chosen a level: the rig defaults to `high` — pixel ratio two
   * and a 2048-square shadow map every frame — picked sight unseen on a machine nobody measured,
   * and a player whose computer cannot hold that gets a slideshow with no clue why.
   */
  const autoQuality = new AutoQuality(qualityWasChosen);

  const frames = createFrame({
    seed, state, player, iso, rig, input, graph, chunks, sampler, entities, entityRenderer, places,
    skyline, rock, daycycle, weather, beam, seasonTintMaterials, skyRenderer, skies, wildlife,
    mount, sailing, breath, magic, plots, houses, fishing, heroGear, packField, cropField,
    buildingSite, ownBoat, minimap, worldMap, hud, sound, online, remains,
    autoQuality, director, walked, castbar, blows, tidings, watch, announceWindUps, onAttack,
    noticeStall, musterHires, startTalk, updateHud, mapInput, markers, doorsteps, streamCountry, areaName,
    arriving, outdoors, persist,
    talking: () => dialogue.isOpen,
    tickDialogue: (dt) => dialogue.update(dt),
    reveal: () => fog.reveal(state.explored),
    refreshJournal: () => journal.refresh(journalInput),
    floorLife: () => floorLife,
    sync: (dt, heightAt) => multiplayer.sync(dt, heightAt),
    sailFerries: (clockNow, time) => interactions.sailFerries(clockNow, time),
    ageCamps: (dt) => interactions.ageCamps(dt),
    runClock: (dt) => interactions.runClock(dt),
    carcasses: () => interactions.carcasses(),
  });
  const loop = new GameLoop((dt, time) => frames.frame(dt, time));
  loop.start();
}

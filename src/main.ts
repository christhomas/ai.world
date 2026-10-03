import { daysToLive } from './world/awaytime';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { mulberry32 } from './core/rng';
import { AutoQuality, everChoseQuality, rememberTheirChoice } from './render/autoquality';
import { QUALITY, createSceneRig } from './render/scene';
import { surfaceRenderers } from './render/surface';
import { isOn } from './ui/switches';
import { Remains } from './game/remains';
import { IsoCamera } from './render/camera';
import { PropLibrary } from './render/props';
import { mountainAt } from './world/ranges';
import { Wildlife } from './game/wildlife';
import { bookOf, tellingTheWorld, wordOfARobbery } from './game/folk';
import { Skies } from './game/skies';
import { ITEMS, sellPrice } from './game/shops';
import { Breath } from './game/breath';
import { createInteractions } from './game/interact';
import { createMultiplayer } from './game/multiplayer';
import { createReadouts } from './ui/readouts';
import { Places } from './game/places';
import { SeasonTintMaterials } from './render/seasontint';
import { Fishing } from './game/fishing';
import { Journal } from './ui/journal';
import { Clock } from './ui/clock';
import { Compass } from './ui/compass';
import { PhotoMode } from './ui/photo';
import { type TradeOffer } from './game/online';
import { Chat } from './ui/chat';
import { whatTheVillagesRaised } from './game/villageroofs';
import { Rucksack } from './ui/rucksack';
import { TouchControls } from './ui/touch';
import { $ } from './ui/dom';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { Fog, renderMapBase } from './ui/mapbase';
import { KinPanel } from './ui/kin';
import { Roster } from './ui/roster';
import { screenOf } from './ui/panels';
import { WorldMap } from './ui/worldmap';
import { DialogueBox } from './ui/dialogue';
import { keepSideways, thisBrowser, whenTurned } from './ui/sideways';
import { LEGACY_KEY, showTitle } from './ui/title';
import { IndexedDbStore } from './save/indexeddb';
import type { SaveStore, SessionSave, WorldKind } from './save/store';
import { generateQuests, questLine } from './game/quests';
import { pubTalk } from './game/pub';
import { Sound } from './game/audio';
import { EntityManager } from './entities/manager';
import { Player } from './entities/player';
import { SALT, derive } from './core/salts';
import { Register } from './world/register';
import { whereAWorldOpens } from './world/opening';
import { walksIn } from './game/arriving';
import { type Kindness } from './game/gifts';
import { type Realm } from './game/nemesis';
import { Director } from './game/director';
import { minesOfAVillage } from './game/minesofavillage';
import { type Luxury } from './world/prosperity';
import { Hires } from './game/hire';
import { stableAt } from './game/stables';
import { lineageDrawing } from './game/lineage';
import { whereLineageIsDrawn } from './game/enquiry';
import { installProbes } from './game/probes';
import { openConsole } from './game/console';
import { createDoorsteps, gatesOf } from './game/doorways';
import { createBlows } from './game/blows';
import { createWaysIn } from './game/waysin';
import { openCountry } from './game/shafts';
import { makeFerryLines } from './game/ferry';
import { RecordingPipeline } from './render/recording';
import { createWatch } from './game/watch';
import { createTidings } from './game/tidings';
import { createFrame } from './game/frame';
import { captureTidings } from './game/capture';
import { createMeeting } from './game/meeting';
import { aftermath, createConsequences } from './game/consequences';
import { joinAWorld } from './game/joining';
import { Cutaway, rememberCutaway, wantsCutaway } from './render/cutaway';
import { familyOfDoor } from './world/homes';
import { growCountry, type GrownPatch } from './game/country';
import { whyCountriesDiffer } from './world/growworld';
import { streamTheCountry } from './game/streaming';
import { openTheSave } from './game/keeping';
import { GameState } from './game/state';
import { Manifest } from './world/manifest';
import { answerDueHighlands, prayersAnsweredHere } from './game/prayers';
import { bindKeys } from './game/keys';
import type { Screen } from './game/screen';
import { createAuthority } from './game/authority';
import { SessionLifetime, shutDownGame } from './game/lifecycle';
import { observeVisibility, returnToTitle } from './platform/browser-lifecycle';
export function startGame(
  store: SaveStore, slotKey: string, saved: SessionSave | undefined, seed: number,
  worldName: string | undefined, url: URL, world: WorldKind, home?: GrownPatch,
): void {
  // A due prayer changes the land itself, so resolve it before the generator sees the manifest —
  // in a solo endless world only, under the same rule `boot.ts` answers by.
  // Advance the same saved clock the normal boot path will use, and persist the updated cursor with
  // the anchor so a reload cannot apply offline days twice.
  let prayersResolvedAtBoot = false;
  if (saved && prayersAnsweredHere(url.searchParams.has('server'), world)) {
    const bootState = GameState.from(saved.state);
    bootState.day += daysToLive(bootState.awayFor, false);
    const bootManifest = new Manifest(seed, saved.manifest);
    if (answerDueHighlands(bootManifest, bootState.prayers, bootState.day) > 0) {
      saved = { ...saved, state: bootState.toJSON(), manifest: bootManifest.toJSON() };
      prayersResolvedAtBoot = true;
    }
  }
  // Read the preference before setQuality writes one, so automatic setup cannot look like a choice.
  const qualityWasChosen = everChoseQuality();
  const sceneFlags = new URLSearchParams(location.search);
  const recording = sceneFlags.has('record-scene') || sceneFlags.has('record-only') ? new RecordingPipeline() : undefined;
  if (recording) (window as Window & { __recording?: RecordingPipeline }).__recording = recording;
  const rig = createSceneRig($('gameContainer'), isOn('composer'), recording);
  rig.setQuality(rig.quality);
  const iso = new IsoCamera();
  const input = new Input(rig.canvas);
  // the on-screen controls speak to the game only through `input`, so a thumb and a key are the
  // same press by the time anything below reads them
  const touch = new TouchControls(input);
  const props = new PropLibrary();
  const seasonTintMaterials = new SeasonTintMaterials();
  // the season is said on the scene graph, and the tinted materials take it from each frame drawn
  rig.followFrames((frame) => seasonTintMaterials.show(frame.season));
  // the ground this game is played on, and everything standing on it that was settled before
  // anybody arrived: the roads, the terrain, the mountains, the crags and the clouds
  const {
    graph, manifest, sampler, structures, around, highPlaces, daycycle, chunks, rock, skyline, high,
    eyries, skyIsles, skyRenderer, endless, grower, mountains, stamp: mine,
  } = growCountry({ seed, world, home, rig, props, seasonTintMaterials, savedManifest: saved?.manifest });
  const prayedHighlands = manifest.layers().filter((a) => a.id.startsWith('highland:prayer:'));
  // the page's half of getting the country: what it kept first, and the world for the rest
  const { streamCountry, onParcel, growItHere, tally: streamTally } = streamTheCountry({
    chunks, sampler, seed, want: (wanted) => online.wantChunks(wanted),
  });
  // Attach cutaway before shader compilation; its uniform toggles without recompiling materials.
  const cutaway = new Cutaway();
  chunks.seeThrough(cutaway);
  cutaway.show(wantsCutaway());

  const hud = new Hud(rig, seed, worldName);
  hud.onLightChange = (sun, hemi) => daycycle.setDayIntensities(sun, hemi);
  hud.setSeeThrough(cutaway.on);
  hud.onSeeThroughChange = (on) => {
    cutaway.show(on);
    rememberCutaway(on);
  };
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
  // where a clerk lays a village's descent out. `enquiry.ts` sells the book and knows nothing about
  // screens, so this is the one place the two are introduced
  const kinPanel = new KinPanel();
  const roster = new Roster();          // everybody in the world, read live off the register
  const surface = surfaceRenderers(rig.graph, props, daycycle, seed);
  const entityRenderer = surface.entities();
  // who lives in the villages, and where they stand: a resettler has to walk there. `movingon.ts`
  const register = new Register(seed, 1, () => {}, 'journaled');
  register.theyStandAt(structures.villages);
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
    (x, z) => prayedHighlands.some((a) => Math.hypot(x - a.x, z - a.z) < a.layer!.reach),
  );
  // and whoever is standing about, so the roster can say what each of them is presently doing
  roster.reads(() => register, () => structures.villages.length, entities, () => player);
  // Shared-world wildlife comes from the authoritative simulation.
  const wildlife = new Wildlife(entityRenderer, entities, bookOf(register, structures.villages));
  // Dungeon floors own separate creature rosters; null on the surface.
  let floorLife: Wildlife | null = null;
  const dialogue = new DialogueBox();
  const sound = new Sound();
  const weather = surface.weather();
  const fishing = new Fishing();
  const journal = new Journal();
  const clock = new Clock();
  const compass = new Compass();
  const photo = new PhotoMode();
  const heroGear = surface.gear();
  // what a teleport looks like: the scene the light stands in, the pool the hero's rig comes apart
  // in, and what he is carrying, which goes with him rather than hangs there through the beam
  const updraughts = surface.updraughts();   // the warm air, drawn where a glider finds it
  const seaEyes = surface.swallows();        // and the water that goes down, drawn where it turns
  const holes = surface.shafts();            // and the shafts, drawn so they can be walked to
  const beam = surface.beam(entityRenderer, heroGear);
  const castbar = $('castbar');
  const lineRng = mulberry32(derive(seed, SALT.DIALOGUE));
  const chat = new Chat();
  /** The world the hero is standing in: the surface, a dungeon floor, or a building. */
  const placeName = (): string => places.underground
    ? `${places.underground.poi.name}:${places.underground.floor}`
    : places.indoors ? places.indoors.title : 'surface';

  // Combat breath refills quickly, so it is not saved.
  const breath = new Breath();
  const ownBoat = surface.boat();
  const cropField = surface.crops();
  const buildingSite = surface.buildingSite();
  // and on the same sites, the houses the villages built themselves — and, out of the same book and
  // on the same day, the acres they cleared to fields: `game/villageroofs.ts` owns both, because
  // this file is assembly and a feature that needs six lines of it is wired in the wrong place
  const villageRoofs = whatTheVillagesRaised(register, () => structures.villages, sampler, chunks);
  // --- the save, opened out: everything the seed could not have worked out for itself ---
  const {
    state, standing, magic, jail, gifts, rescues, grudges, nemesis, roaming, mines, ore, forge,
    plots, houses, sailing, mount, persist, persistStrict,
  } = openTheSave({
    store, slotKey, seed, world, worldName, saved, structures, manifest,
    rng: lineRng,
    cam: () => ({ x: iso.target.x, z: iso.target.z, rot: iso.rotation, zoom: iso.zoom }),
    at: () => ({ x: player.x, z: player.z }),
    sky: () => skies.save(),
  });
  if (prayersResolvedAtBoot) {
    void persistStrict().catch(() => hud.flash('The answered prayer will be saved when storage is available.'));
  }
  register.rememberStablePurchases(houses.stablePurchases());
  // the days that passed while the game was shut, which only a world of one has to invent. Asked of
  // the link rather than of `online.connected`, and `daysToLive` says why both of those are so
  const catchUp = daysToLive(state.awayFor, url.searchParams.has('server'));
  if (catchUp > 0) state.day += catchUp;
  register.advance(state.day);                // a world reopened after a week finds a village changed
  /** Everything Old Nettle's cycle needs to reach into, gathered when it is asked for rather than held. */
  const realm = (): Realm => ({ register, jail, villages: structures.villages, hero: online.name, recall });
  // which hole each village works, what it believes about it, and whether the hero is down one
  const { claimed, saidOfMine, fightingInAMine } = minesOfAVillage({ structures, register, mines, places: () => places });
  /** The soldiers walking with somebody, and what was agreed with each. */
  const hires = new Hires();
  const discovered = state.discovered;
  const urlTime = url.searchParams.get('t');
  if (urlTime !== null) state.time = Math.max(0, Math.min(0.999, Number(urlTime) || 0));
  fog.reveal(state.explored, state.charted);
  const elderErrands = generateQuests(structures, seed);
  // the elder's errand and the pub's, in one list: the journal, the map and the compass all read
  // it, so anything not in here is a job the player has taken on and cannot then find again
  const questList = [
    ...elderErrands,
    ...structures.villages.flatMap((v) => pubTalk(v, structures, seed)?.errand ?? []),
  ];
  // the elder has one errand to give, and it is theirs: the pub keeps its own
  const quests = new Map(elderErrands.map((q) => [q.village, q]));

  const ferries = surface.ferries(makeFerryLines(structures, structures.villages, graph.islands));
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

  // where the hero stands when the world opens: where he was left, where a link says, or — in a
  // world nobody has ever stood in — the village `world/opening.ts` picks out of it. #394
  const opening = saved?.player ? null : whereAWorldOpens(structures.villages);
  let startX = opening?.x ?? 0, startZ = opening?.z ?? 0;
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
    // and what happens when one of them does not come back up. The same two things the country's
    // own crowd was given: one record of who is alive, and one thing that happens when somebody
    // stops being on it. A floor had neither, so a man killed at his face was back at it the next
    // time you walked in.
    fallen: (who) => fallen(who),
    register,
    // the anchor a floor hangs off is the mine's own id, which is what `crewIn` above is keyed on
    aDeathBelow: (anchorId) => mines.aDeathBelow(anchorId),
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    setCaveAmbience: (on) => { sound.cave = on; }, persist: () => persist(),
    open: (ask) => online.open(ask),
    // A floor is the world's if there is a world listening: it grows the same rooms from the same
    // anchor name and owns what walks about in them, and this side draws what it is told.
    wentBelow: (below) => {
      if (!online.connected) return false;
      online.floor(below.place, below.anchorId, below.kind, below.floor, below.style);
      // from what is handed over rather than from `places.underground`: this is called on the way
      // in, before the visit is the visit
      floorLife = new Wildlife(below.renderer, below.monsters);
      return true;
    },
    familyOf: (door) => familyOfDoor(structures.villages, register, door),
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
    // and the rest of what a kill means, which lives with the rule itself
    ...aftermath(() => ({ interactions, online, rustled, hud }), mines, fightingInAMine),
    floorLife: () => floorLife,
    aloft: () => skies.aloft !== null,
    steer: (seq, dx, dz, pace, dt) => online.steer(seq, dx, dz, pace, dt),
    bitten: (attacker, damage) => onAttack(attacker, damage),
    arrested: (by) => arrested(by),
    fallen: (who) => fallen(who),
  });

  // the multiplayer half of the game, and the dialogue that answers an offer of goods, which the
  // interaction layer below owns and hands back once it exists
  /** Late-bound the way the offer is: places is built before the interactions that split coin. */
  let splitTakings: (gold: number) => void = () => {};
  /** What a village you saved does for you, filled in once the interactions exist. */
  let villageWelcome: (village: string) => Kindness | null = () => null;
  let putOfferToPlayer: (offer: TradeOffer, fromName: string) => void = () => {};
  let preparingRemoteCountry = false;
  const multiplayer = createMultiplayer({
    register, hires,
    player, state, breath, mines, places, plots, houses, mount, sailing, entityRenderer, camera: iso,
    dialogue, hud, chat, sound, questList, discovered, high, seed,
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
    /*
     * Hold local chunk generation while the world grows. Its final stamp checks what chunks
     * cannot: villages, doors, eyries and creatures derived independently on both sides.
     * A mismatch once shipped people into another country's houses, so report it explicitly.
     */
    onCountryComing: () => chunks.aWorldIsGrowingIt(),
    onCountryProgress: (done, total) => {
      preparingRemoteCountry = true;
      chunks.aWorldIsGrowingIt();
      hud.setLoading(`Preparing world — ${done} of ${total} pieces ready`);
    },
    onCountryGrown: (stamp, theirKind) => {
      if (preparingRemoteCountry) { hud.hideLoading(); preparingRemoteCountry = false; }
      chunks.theCountryIsGrown();
      // the sentence lives beside the thing that stamps a country: see `whyCountriesDiffer`, and
      // `growCountry` for why the country takes its own rather than this taking one of it
      const said = whyCountriesDiffer(mine, stamp, world, theirKind);
      if (!said) return;
      // and saying it is not enough: the page draws its own ground instead. See `streaming.ts`.
      growItHere();
      console.error(said);
      hud.flash('This world does not match the one you joined.');
      chat.line(said, 'sys');
    },
    placeName, persist, discover, showOffer: (offer, fromName) => putOfferToPlayer(offer, fromName),
    guiltOf: () => standing.guilt,
  });
  const { online, market, party, duel, warband, others, handover, rally, playerList } = multiplayer;
  const session = new SessionLifetime({
    frame: (dt, time) => frames.frame(dt, time),
    pause: () => { loop.stop(); chunks.pause(); sound.quiet(true); online.quiet(true); },
    resume: () => { chunks.resume(); sound.quiet(false); loop.start(); online.quiet(false); },
    release: () => shutDownGame({
      stop: () => loop.stop(), controls: [input, touch],
      disconnect: () => online.disconnect(), clear: () => others.clear(),
      resources: [sound, places, chunks, entityRenderer, heroGear, beam, weather, watch,
        skyRenderer, packField, cropField, buildingSite, props, rig],
    }),
  });

  const toTitle = () => returnToTitle(persist, () => session.dispose());

  // the panels, and the noises they make
  hud.setVolume(sound.volume);
  hud.onVolumeChange = (v) => sound.setVolume(v);
  hud.onReturnToTitle = toTitle;
  const rucksack = new Rucksack(state);
  rucksack.onChange = (message) => { hud.flash(message); sound.select(); persist(); };
  hud.onOpenRucksack = () => rucksack.toggle();
  dialogue.onType = () => sound.blip();
  dialogue.onMove = () => sound.select();

  // stopping in front of somebody: everything a person offers, worked out as you speak to them
  const { heroFace, startTalk, talkCtx } = createMeeting({
    state, player, register, grudges, jail, standing, gifts, online, handover, sound, dialogue, quests, persist,
    toTitle, forge,
    rng: lineRng,
    countryAt: (x, z) => sampler.biomeOf(x, z),
    villageWelcome: (village) => villageWelcome(village),
    wordOfHim: (person) => interactions.wordOfHim(person),
    saidOfMine, landWood: houses.yard.brought.bind(houses.yard),
    indoors: () => places.indoors?.door ?? null,
    flash: (message) => hud.flash(message),
  });
  heroFace();                                 // the face on the right of every conversation

  // packs left where people fell, and the bundles that show them
  const remains = new Remains();
  const packField = surface.drops();

  // every memory made on this page goes through one door, and the world is on the far side of it
  const recall = tellingTheWorld((who, what, about) => online.recall(who, what, about));
  gifts.remembers = mines.remembers = recall;

  // and what the country does about what the hero just did: a village that has heard about its
  // cow, a cell with your name on it, a pack on the ground where somebody fell
  const { rustled, arrested, fallen } = createConsequences({
    seed, state, player, iso, structures, register, grudges, standing, jail, online, remains,
    sound, persist, recall,
    flash: (message) => hud.flash(message),
    oneFell: (who) => watch.oneFell(who),
    hireFallen: (person) => hireFallen(person),
  });
  const skies = new Skies({
    player, iso, ground: chunks,
    flash: (message) => hud.flash(message),
    chime: () => sound.chime(),
    discover, persist: () => persist(),
  }, skyIsles, manifest);
  // a world put away while the hero was up in the clouds opens with them still up there. Without
  // it they come back at the same coordinates with the island no longer under their feet, which
  // is a spawn over open sea and a save that cannot be walked out of.
  if (saved?.sky) skies.restore(saved.sky);

  const interactions = createInteractions({
    player, state, discovered, eyries, high, skies, ore, forge,
    luxuryOf: (v) => villageLuxury.get(v) ?? 'none',
    saidOfMine,
    structures, around, sampler, chunks, manifest, entities, entityRenderer, places, seed,
    market, party, duel, mount, sailing, plots, houses, grudges, fishing, online, handover, remains, ferries, quests, register, jail,
    gifts, hires, standing, rescues, nemesis,
    callOut: (to) => multiplayer.callOut(to),
    dialogue, hud, chat, sound,
    raining: () => frames.raining(), discover, persist, persistStrict, startTalk, questLine,
    told: (delta) => online.report(delta),
    // built further down this file, and only ever asked for on a key press: see `waysin.ts`
    craft: () => craft,
  });
  const { atHand: talkNearest, offerTrade, partyMenu, noticeStall, takeShare, musterHires, hireFallen, hireMenu, tryGive } = interactions;
  splitTakings = takeShare;
  villageWelcome = interactions.villageWelcome;
  // something that comes to a camp in the night has to be put in the world by somebody who can
  interactions.onVisitor((kind, x, z) => {
    entities.spawnOne(kind, x, z, seed ^ Math.floor(x * 131 + z * 977));
  });
  interactions.onTheft((camp) =>
    wordOfARobbery(structures.villages, register, recall, camp, state.day, lineRng));
  putOfferToPlayer = interactions.showOffer;

  // whose world this is: the one in the next thread until somebody asks for another
  // Give old saves their stable multiplayer identity before they can receive replayable player facts.
  if (saved?.state?.playerId !== state.playerId) persist();
  joinAWorld({
    seed, kind: world, terrain: manifest.terrain, highlands: manifest.layers(), worldName, where: () => ({ x: player.x, z: player.z }), state, online, url,
    forgetOthers: () => others.clear(),
    showChat: () => chat.show(),
    hideChat: () => chat.hide(),
    flash: (message) => hud.flash(message),
  });
  // how hard the world is looking for the player: fights, bands and schemes all report to it, and
  // everything that stands something up asks it how far to look, so it is built before any of them
  const director = new Director();

  const blows = createBlows({
    seed, state, player, places, chunks, entities, structures, standing, breath, magic, mines,
    online, duel, warband, hires, sailing, skies, sound, director,
    talking: () => dialogue.isOpen,
    typing: () => chat.isTyping,
    flash: (message) => hud.flash(message),
    hurt: () => hud.hurt(),
    converse: (node) => dialogue.start(node),
    fightingInAMine, battlefield, rustled, persist, craft: () => craft,
    fell: (kind, x, z) => interactions.fell(kind, x, z),
    troubleKilled: (kind, x, z) => interactions.troubleKilled(kind, x, z),
    heWentDown: () => interactions.heWentDown(),
    takeShare: (gold) => takeShare(gold),
  });
  const { attack, loose, conjure, onAttack, announceWindUps, knockOut } = blows;

  // walking into a door goes in, and a castle's gate is a door like any other
  const doorsteps = createDoorsteps(places, () => structures.doors, () => gatesOf(structures.castles), discover);

  const { commands, commandWorld, bound, arriving } = openConsole({
    seed, state, player, iso, places, structures, sampler, entities, register, online, chat,
    plots, remains, hires, eyries, skyIsles, beam, placeName, discover,
    areaLabel: () => frames.areaLabel(),
    flash: (message) => hud.flash(message),
  });

  const watch = createWatch({
    seed, player, state, structures, sampler, chunks, entities, roaming, nemesis, director,
    sailing, sound, persist,
    school: surface.whales(), campField: surface.camps(),
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
    seed, state, player, places, structures, around, sampler, register, roaming, nemesis, mines, ore, online,
    remains, sound, director, claimed, villageLuxury, discovered, realm, persist,
    builderDay: (day, already) => interactions.builderDay(day, already),
    villageNights: () => interactions.villageNights(),
    say: (line) => chat.line(line, 'sys'),
    flash: (message) => hud.flash(message),
  });
  const { minesWorked } = tidings;

  const { markers, mapInput, areaName, compassTargets, updateHud, journalInput } = createReadouts({
    player, state, structures, around, sampler, discovered, questList, ferries, sailing, places,
    rucksack, hud, clock, compass,
    bound,
    companyMarkers: multiplayer.markers,
    fogged: () => !state.can('map'),
    action: { at: () => interactions.action(), take: talkNearest },
    rankOf: (village) => register.rankOf(village),
    cameraTarget: () => iso.target,
    discover,
    walkedInto: walksIn(register, online),
  });

  // The screen coordinates panels and dialogue for input bindings.
  const screen = screenOf({
    hud, chat, dialogue, journal, rucksack, worldMap, kinPanel, roster, playerList, photo, places,
    cutaway,
    canvas: rig.canvas, seed,
    journalInput, mapInput,
    companyInput: () => multiplayer.playerListInput,
  });

  hud.onMapTap = () => screen.toggleMap();

  // the air, the ground and the sea: a wing, a shaft and a whirlpool. See `game/waysin.ts`.
  const { air, craft, shafts, swallows } = createWaysIn({
    seed, state, places, player, sailing, chunks, discover,
    say: (line) => hud.flash(line), knockOut: (why) => blows.knockOut(why) });
  // and what every key does, in one place
  bindKeys({
    seed, input, rig, iso, player, places, online, sound, screen,
    attack, loose, conjure, talkNearest, partyMenu, hireMenu, offerTrade, tryGive, toTitle,
    persist, rally, takeToTheAir: () => air.open(),
    partySize: () => party.size,
  });

  // the handles a headless browser drives this by; stripped from production builds. Hung on at the
  // end because they reach into everything, and everything now exists.
  if (import.meta.env.DEV) {
    // where a clerk's family tree appears: `enquiry.ts` sells the book and knows nothing about
    // screens, so it holds a hook and this is the one place that fills it in
    const drawLineage = (village: string): void => kinPanel.show(...lineageDrawing(register, village, state.day));
    whereLineageIsDrawn(drawLineage);
    installProbes({ endless, grower,
      seed, manifest, state, player, rig, iso, sampler, structures, chunks, entities, register, places,
      online, market, warband, remains, plots, houses, sailing, skies, skyIsles, eyries, mines, jail,
      roaming, nemesis, director, claimed, minesWorked, fightingInAMine, questList, talkCtx, commands,
      commandWorld, placeName, walking, wildlife, bites, doorsteps, streamTally, mount, drawLineage, wing: air,
      leaveOne: (kind, x, z) => interactions.fell(kind, x, z),
      overworldRenderer: entityRenderer,
      pods: watch.pods,
      nettleAbout: watch.nettleAbout,
      sentOut: watch.sentOut,
      callOut: (to) => multiplayer.callOut(to),
      carcasses: () => interactions.carcasses(),
      markers: () => markers(),
      heard: () => frames.heard(),
    });
  }

  const autoQuality = new AutoQuality(qualityWasChosen);

  const frames = createFrame({
    seed, state, player, iso, rig, input, graph, chunks, sampler, entities, entityRenderer, places, endless, grower, mountains, cutaway,
    skyline, high, rock, daycycle, weather, updraughts, swallows, seaEyes, shafts, holes, beam,
    couldBeAShaft: (x, z) => openCountry(chunks, x, z), skyRenderer, skies, wildlife,
    mount, sailing, breath, magic, plots, houses, fishing, heroGear, packField, cropField,
    buildingSite, villageRoofs, ownBoat, minimap, worldMap, hud, sound, online, remains,
    autoQuality, director, walked, castbar, blows, tidings: captureTidings(tidings), watch, announceWindUps, onAttack,
    noticeStall, musterHires, startTalk, updateHud, mapInput, markers, doorsteps, streamCountry, areaName,
    arriving, outdoors, persist,
    talking: () => dialogue.isOpen,
    tickDialogue: (dt) => dialogue.update(dt),
    reveal: () => fog.reveal(state.explored, state.charted),
    refreshJournal: () => journal.refresh(journalInput),
    floorLife: () => floorLife,
    sync: (dt, heightAt) => multiplayer.sync(dt, heightAt),
    sailFerries: (clockNow, time) => interactions.sailFerries(clockNow, time),
    ageCamps: (dt) => interactions.ageCamps(dt),
    runClock: (dt) => interactions.runClock(dt),
    carcasses: () => interactions.carcasses(),
  });
  const loop = new GameLoop((dt, time) => session.frame(dt, time));
  // Every callback target now exists. A hidden page must not start ticking, and a disposed
  // world's visibility listener must never restart its workers, audio or frame loop.
  session.own(observeVisibility((active) => session.setActive(active)));
}

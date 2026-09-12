import { CommandBus, describeResult } from '../core/commandbus';
import type { EntityManager } from '../entities/manager';
import type { Player } from '../entities/player';
import type { Beam } from '../render/beam';
import type { IsoCamera } from '../render/camera';
import type { Chat } from '../ui/chat';
import { noSuchTopic, topicFor, topicIndex } from '../ui/topics';
import { BIOMES, biomeAnswersTo } from '../world/biomes';
import type { Register } from '../world/register';
import type { SkyIsland } from '../world/skyisland';
import { compassDir } from '../world/landmarks';
import { StructureKind, placeKindName, type Structures } from '../world/structures';
import type { TerrainSampler } from '../world/terrain';
import { registerCommands, type CommandWorld } from './commands';
import type { Eyrie } from './eyries';
import type { Plots } from './farming';
import type { Hires, Order } from './hire';
import type { Online } from './online';
import type { Places } from './places';
import type { Remains } from './remains';
import type { GameState } from './state';

/**
 * The console, and everything the game can be told to do through it.
 *
 * One vocabulary that the server shares, so a console, a tool, a test and — once the simulation
 * moves across — the server itself all say the same words. `docs/server-authority.md` is where
 * that is going. The debug handles in `probes.ts` are the same acts under older names and go
 * through here.
 */
export interface Consoled {
  seed: number;
  state: GameState;
  player: Player;
  iso: IsoCamera;
  places: Places;
  /**
   * Everything this world holds, and deliberately not what is near the hero.
   *
   * Every other reader of the structures in this game has moved to `world/around.ts`, which asks
   * "what is within so many tiles of here" because that is the only form of the question a country
   * grown a square at a time can answer. This file is the exception and should stay one. `/towns`
   * lists the towns; `/teleport silverholm` goes to Silverholm wherever it is; `/teleport dock`
   * finds a jetty and names it after whoever it belongs to. None of those means "near me" — they
   * mean "in this world", which is exactly what a console is for, and bounding them would make the
   * debug tools able to see less than the player can.
   *
   * In a country with no edge this is the country that has been grown, which is the honest answer
   * to "list everything" in a world where everything is not a finite thing.
   */
  structures: Structures;
  sampler: TerrainSampler;
  entities: EntityManager;
  register: Register;
  online: Online;
  chat: Chat;
  plots: Plots;
  remains: Remains;
  hires: Hires;
  eyries: readonly Eyrie[];
  skyIsles: readonly SkyIsland[];
  /**
   * What a teleport looks like: the hero coming apart into his own blocks and a column of light
   * standing where he was.
   *
   * Here rather than anywhere else because this is where the two teleports in the game are, and
   * they are the only moves that get it. The others that put a hero somewhere without walking him
   * there were each looked at and refused: a staircase and a doorway change the whole scene, so
   * there is nothing to dissolve out of and nothing to dissolve into; stepping off a ferry, off a
   * boat or off a horse is a stride rather than a jump; being carried to a village after a
   * knockout or into a cell after an arrest is somebody dragging your body, and a beam there would
   * claim a power where the game has just told you that you had none. The eagle over the range is
   * the near miss — it is a real jump, and it does look like one — but it already has a bird and a
   * line of text explaining itself, and a column of light would say sorcery where the story says
   * feathers. `docs/worklist.md` has the argument.
   */
  beam: Beam;
  /** Where the hero is standing: the surface, a dungeon floor, or a building. */
  placeName: () => string;
  /** And what the country round him is called, which `where` answers with. */
  areaLabel: () => string;
  discover: (name: string) => void;
  flash: (message: string) => void;
}

/** How far outside a castle's gate a teleport puts you, in tiles. See the note where it is used. */
const CASTLE_APPROACH = 4;

/** Somewhere the player asked to be pointed at, and how far off it was when they asked. */
export interface Bound { name: string; x: number; z: number }

/** How near counts as arrived, in tiles: inside a village square rather than at its sign. */
const ARRIVED = 6;

export function openConsole(ctx: Consoled) {
  const {
    seed, state, player, iso, places, structures, sampler, entities, register, online, chat,
    plots, remains, hires, eyries, skyIsles, beam, placeName, areaLabel, discover, flash,
  } = ctx;

  /**
   * The docks, named after the villages they serve.
   *
   * `isle:226,-130 dock` is an id with a word after it, not a name. The nearest village is what a
   * person would say, and where two docks share one, they are told apart by a number rather than
   * by their coordinates.
   */
  const dockNames = (): Array<{ name: string; kind: string; x: number; z: number }> => {
    const used = new Map<string, number>();
    return structures.piers.map((pier) => {
      const x = pier.tiles[0]?.[0] ?? pier.dockX;
      const z = pier.tiles[0]?.[1] ?? pier.dockZ;
      const near = structures.villages
        .map((v) => ({ v, away: Math.hypot(v.x - x, v.z - z) }))
        .sort((a, b) => a.away - b.away)[0];
      const base = near ? `${near.v.name} dock` : 'dock';
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      return { name: seen > 1 ? `${base} ${seen}` : base, kind: 'dock', x, z };
    });
  };

  /**
   * Everywhere in this world with a name on it: the villages, and whatever the map has a word for.
   *
   * Sorted so the answer is stable between two runs of the same seed, which matters because it is
   * read by people and by scripts alike, and a list that shuffles is a list nobody can diff.
   */
  const namedPlaces = (like?: string): Array<{ name: string; kind: string; country: string; x: number; z: number }> => {
    const described = ([
      ...structures.villages.map((v) => ({ name: v.name, kind: 'village', x: v.x, z: v.z })),
      ...structures.pois.map((p) => ({ name: p.name, kind: placeKindName(p.kind), x: p.x, z: p.z })),
      ...structures.caves.map((c) => ({ name: c.name, kind: 'cave', x: c.x, z: c.z })),
      ...structures.wrecks.map((wk) => ({ name: wk.name, kind: 'wreck', x: wk.x, z: wk.z })),
      // A castle is named at its gate rather than at its middle, and it is the only place here
      // that is. Everywhere else on this list is a spot you can stand on; the middle of a castle
      // is the yard, and the keep stands two tiles behind it with four and a half tiles of stone
      // to its name — so `teleport blackgard` aimed at the middle would land the hero inside the
      // keep wall. The gate tile is where anybody arriving at a castle arrives anyway.
      /*
       * A castle is aimed at the ground *in front of* its gate rather than at the gate itself.
       *
       * The gate tile is a doorstep now — walking onto it takes you inside — so a teleport that
       * lands on it is answered by a loading screen before the player has seen the castle at all.
       * Four tiles further out along the way the gate faces is close enough to be arriving at the
       * place and far enough to be standing outside it.
       */
      ...structures.castles.map((c) => {
        const outX = c.gateX - c.x, outZ = c.gateZ - c.z;
        const away = Math.hypot(outX, outZ) || 1;
        return {
          name: c.name, kind: 'castle',
          x: c.gateX + (outX / away) * CASTLE_APPROACH,
          z: c.gateZ + (outZ / away) * CASTLE_APPROACH,
        };
      }),
      // A pier has no name of its own — it is the dock of whatever it reaches, and what it reaches
      // is an island known by its coordinates. So it is named for the village nearest it, which is
      // how anybody standing on one would describe it, and numbered when a village has two.
      ...dockNames(),
      ...eyries.map((e) => ({ name: e.name, kind: 'eyrie', x: e.x, z: e.z })),
      ...skyIsles.map((isle) => ({ name: isle.name, kind: 'sky island', x: isle.crag.x, z: isle.crag.z })),
    ] as Array<{ name: string; kind: string; x: number; z: number }>)
      // what country each one stands in, which is the thing a broad search is really asking about:
      // "the places in the mountains" is a question about the ground, not about their names
      .map((place) => ({ ...place, biome: sampler.biomeOf(place.x, place.z) }))
      .map((place) => ({ ...place, country: BIOMES[place.biome].name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!like) return described;
    const wanted = like.trim().toLowerCase();
    /** The places that are of the sea rather than on the land, whatever the ground behind them is. */
    const coastal = (kind: string): boolean => kind === 'dock' || kind === 'wreck' || kind === 'pier';
    const atSea = ['sea', 'ocean', 'coast', 'shore', 'water'].some((word) => word.startsWith(wanted) || wanted.startsWith(word));
    return described.filter((place) =>
      place.name.toLowerCase().includes(wanted)
      || place.kind.includes(wanted)
      || biomeAnswersTo(place.biome, wanted)
      || (atSea && coastal(place.kind)));
  };

  /**
   * The place somebody meant. An exact name wins, then one that starts with what was typed, then
   * one that merely contains it — so `teleport silver` finds Silverholm without `teleport
   * silverholm` ever being ambiguous.
   */
  /**
   * Both teleports, and the one thing they both have to check first.
   *
   * A jump does not change which world the hero is walking in. Asked for a surface coordinate from
   * the third floor of a vault, it used to hand that floor a point it has no ground at and never
   * will — so nothing could place him: no floor under his feet, `settle` refusing him every frame,
   * and the game holding an invisible man in the dark with the console reporting success. Refused
   * with a sentence instead, which also says what to do about it.
   */
  const jumpTo = (x: number, z: number): void => {
    /*
     * Only asked of a world with edges, and that limit is the point rather than an oversight.
     *
     * Out of doors, ground that has not arrived reads exactly like ground that does not exist —
     * `heightAt` is null for a chunk nobody has streamed yet — so asking this question on the
     * surface refuses perfectly good jumps to anywhere the player has not already been. Which is
     * what it did: the playtest teleports across the county before the county is built, and this
     * turned that into an error the moment it landed. The surface settles a hero when the ground
     * turns up, as it always has.
     *
     * A dungeon floor, an interior and a keep are all made before you are in them and never grow,
     * so there the question has an answer and the answer is worth having.
     */
    const here = placeName();
    if (here !== 'surface' && !player.groundNear(x, z)) {
      throw new Error(`you are inside ${here}, and there is no ${Math.round(x)}, ${Math.round(z)} in here — climb out first`);
    }
    beam.leaves(player.entity);
    player.teleport(x, z);
    beam.arrives(player.entity);
    iso.target.set(x, 0.5, z);
  };

  const namedPlace = (like: string): { name: string; kind: string; x: number; z: number } | null => {
    const wanted = like.trim().toLowerCase();
    const all = namedPlaces();
    const nearestOfKind = all
      .filter((p) => p.kind.includes(wanted))
      .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
    // A name beats a kind, and a kind beats nothing: `teleport silverholm` goes to the town, and
    // `teleport dock` goes to the nearest one, which is what somebody asking for "a dock" means.
    return all.find((p) => p.name.toLowerCase() === wanted)
      ?? all.find((p) => p.name.toLowerCase().startsWith(wanted))
      ?? all.find((p) => p.name.toLowerCase().includes(wanted))
      ?? nearestOfKind
      ?? null;
  };

  /**
   * Where the player has asked to be pointed, if anywhere.
   *
   * One place at a time on purpose: a compass with four needles is a map, and there is already a
   * map. Cleared by `nav off`, and by arriving — standing on the thing you were walking to is the
   * moment the arrow stops being useful and starts being clutter.
   */
  let bound: Bound | null = null;

  const commandWorld: CommandWorld = {
    /*
     * A teleport, and the two halves of what it looks like.
     *
     * `leaves` is asked before the move and `arrives` after it, so the light stands where he was
     * standing and he gathers himself where he ends up. Neither of them delays anything: the hero
     * is at his destination on this line, the way he always was, and what takes a third of a
     * second is the picture. See `render/beam.ts`.
     */
    teleport: (x, z) => {
      jumpTo(x, z);
      online.stood(x, z, 'teleport');
    },
    teleportTo: (place) => {
      const found = namedPlace(place);
      if (!found) throw new Error(`nowhere called ${place} — try: places`);
      jumpTo(found.x, found.z);
      // the world moves its own hero to match: a teleport is the one jump nothing else can see
      online.stood(found.x, found.z, 'teleport');
      return { name: found.name, x: Math.round(found.x), z: Math.round(found.z), kind: found.kind };
    },
    places: (like) => namedPlaces(like).map((p) => ({ name: p.name, kind: p.kind, country: p.country, x: Math.round(p.x), z: Math.round(p.z) })),
    // The villages, in the order somebody standing here cares about them. Distance and heading
    // rather than coordinates, because "Silverholm, 240 paces north-west" is an answer and
    // "Silverholm, 280, -110" is a lookup.
    // A word narrows it, and means either the village's own name or the country it stands in:
    // `towns mountains` and `towns silver` are both questions somebody actually asks.
    navTo: (place) => {
      if (place === undefined) {
        if (!bound) return 'pointing nowhere. Try: nav silverholm';
        const away = Math.round(Math.hypot(bound.x - player.x, bound.z - player.z));
        return { name: bound.name, away, heading: compassDir(bound.x - player.x, bound.z - player.z) };
      }
      if (place === null) { bound = null; return 'the compass is your own again'; }
      const found = namedPlace(place);
      if (!found) throw new Error(`nowhere called ${place} — try: places`);
      bound = { name: found.name, x: found.x, z: found.z };
      return { name: found.name, away: Math.round(Math.hypot(found.x - player.x, found.z - player.z)),
        heading: compassDir(found.x - player.x, found.z - player.z) };
    },
    towns: (like) => structures.villages
      .filter((v) => !like
        || v.name.toLowerCase().includes(like.trim().toLowerCase())
        || biomeAnswersTo(v.biome, like))
      .map((v) => ({
        name: v.name,
        away: Math.round(Math.hypot(v.x - player.x, v.z - player.z)),
        heading: compassDir(v.x - player.x, v.z - player.z),
        country: BIOMES[v.biome].name,
        x: Math.round(v.x), z: Math.round(v.z),
      }))
      .sort((a, b) => a.away - b.away),
    descend: () => places.descend(),
    climbOut: () => places.exitDungeon(),
    enterShrine: () => {
      const shrine = structures.pois.find((p) => p.kind === StructureKind.Shrine);
      if (!shrine) return null;
      places.enterDungeon(shrine);
      return shrine.name;
    },
    enterInn: () => {
      for (const village of structures.villages) {
        const inn = village.shops.find((shop) => shop.type === 'inn');
        if (!inn) continue;
        const door = structures.doors.find((d) => d.bx === inn.house.tx && d.bz === inn.house.tz);
        if (!door) continue;
        places.enterBuilding(door);
        return village.name;
      }
      return null;
    },
    standAtCounter: () => {
      const spot = places.indoors?.world.map.keeper;
      if (!spot) return null;
      player.teleport(spot[0] + 0.5, spot[1] + 1.6);
      return { x: spot[0] + 0.5, z: spot[1] + 1.6 };
    },
    spawn: (kind, away) => {
      const e = entities.spawnOne(kind, player.x + away, player.z, seed ^ Date.now());
      return e ? { kind: e.kind.id, x: Math.round(e.x), z: Math.round(e.z), hp: e.hp } : null;
    },
    sow: (x, z) => {
      plots.plant(x, z, 'wheat', state.day + state.time);
      online.report({ kind: 'sow', tile: `${x},${z}`, crop: 'wheat', day: state.day });
      state.version++;
      return { tile: `${x},${z}`, crop: 'wheat', day: state.day };
    },
    drop: () => {
      remains.leave('Rolf the Hunter', 'hunter', player.x + 1.2, player.z, 23, 'pelt', 4242);
      return remains.all.length;
    },
    discover: (place) => { discover(place); return place; },
    thin: (village, many) => {
      const doomed = [...register.living(village)].slice(0, many);
      for (const person of doomed) register.bury(person.id, state.day);
      return { village, buried: doomed.length, left: register.living(village).length, fortune: register.fortune(village) };
    },
    hire: (many) => {
      // stand somebody's own soldiers up without walking a village: for trying a fight out
      const folk = structures.villages.flatMap((v) => [...register.living(v.name)]).filter((p) => p.trade === 'soldier');
      const side = online.id || 'alone';
      const taken = folk.slice(0, many).map((p) => hires.strike(
        { who: p.id, name: p.name, asking: 0, terms: [{ fee: 0, share: 0.2 }] },
        { fee: 0, share: 0.2 }, 999, side, state.day,
      ));
      return { asked: many, hired: taken.filter(Boolean).length, roster: hires.roster(side).length };
    },
    /*
     * Tell everybody in your pay the same thing, for trying an order out without walking to each
     * of them. What it is good for is the question the unit tests cannot answer — whether a man
     * told to wait actually stops following.
     */
    tell: (order) => {
      const side = online.id || 'alone';
      const roster = hires.roster(side);
      for (const b of roster) hires.tell(side, b.who, order as Order, { x: player.x, z: player.z });
      return { told: order, men: roster.map((b) => b.name) };
    },
    // The clock belongs to the world, and the world says what time it is ten times a minute — so
    // setting it here alone lasted until the next thing the world said, which is why `time 0.5`
    // answered with half past noon and left the sun where it was. Asked of the world instead, and
    // the world tells everybody in it, which is one person or it is refused.
    setTime: (fraction) => {
      const time = Math.max(0, Math.min(0.999, fraction));
      state.time = time;
      online.setClock(state.day, time);
      return { day: state.day, time };
    },
    setDay: (day) => {
      const today = Math.max(1, Math.round(day));
      state.day = today;
      online.setClock(today, state.time);
      return { day: today, time: state.time };
    },
    where: () => ({
      x: Math.round(player.x * 10) / 10, z: Math.round(player.z * 10) / 10,
      y: Math.round(player.entity.y * 100) / 100,
      place: placeName(), area: areaLabel(),
    }),
    peaks: () => (sampler.ranges?.peaks ?? []).map((peak) => ({
      x: Math.round(peak.x), z: Math.round(peak.z), height: Math.round(peak.lift), range: peak.range,
    })).sort((a, b) => b.height - a.height),
    // whichever crowd the hero is actually standing in: a mine's crew and a dungeon's monsters are
    // in that floor's own manager, and this used to answer about the fields overhead
    entities: () => (places.crowd ?? entities).within(player.x, player.z, 60).map((e) => ({
      kind: e.kind.id, name: e.name, trade: e.trade, purse: e.purse, carrying: e.carrying?.id ?? '',
      // what a man in somebody's pay has been told, and by whom: the only way from outside to tell
      // a hireling standing about from one that was told to stand about
      told: e.told?.what ?? '', toldBy: e.told?.by ?? '',
      // what the branch of his own tree that claimed this tick says it is
      doing: e.doing,
      x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 100) / 100, z: Math.round(e.z * 10) / 10,
      slot: e.slot, state: e.state, charging: Math.round(e.charging * 10) / 10, person: e.person, role: e.role,
      // the fight's own state, without which none of the wind-up work can be checked from
      // outside: a probe that reads e.winding off this and finds undefined quietly measures
      // nothing at all and reports it as a result
      dead: e.dead, hurt: Math.round(e.hurt * 100) / 100,
      // nought when this client owns it, and the world's own number when the world does
      worldId: e.worldId,
      winding: Math.round(e.winding * 1000) / 1000, warned: e.warned,
    })),
  };
  const commands = new CommandBus();
  registerCommands(commands, commandWorld);

  /**
   * What a line typed into the console means.
   *
   * Four readings, in the order somebody would guess them. A question mark asks the game and the
   * answer is yours alone; a slash is a gesture if it names one everybody knows and a command
   * otherwise; anything else is said out loud. Nothing here needs the world to be online — asking
   * and running work alone, which is most of what they are for.
   */
  chat.onSend = (text) => {
    if (text.startsWith('?')) {
      const asked = text.slice(1).trim();
      if (!asked) { for (const line of topicIndex()) chat.line(line, 'sys'); return; }
      const topic = topicFor(asked);
      for (const line of topic ? [topic.name.toUpperCase(), ...topic.lines] : noSuchTopic(asked)) chat.line(line, 'sys');
      return;
    }
    if (text.startsWith('/')) {
      const said = text.slice(1).trim();
      // a gesture first: everybody knows what a wave is, and /wave is older than the command bus
      if (online.emote(said.toLowerCase())) return;
      const result = commands.run(said, 'console');
      if (!result.ok) chat.line(result.error, 'sys');
      else if (result.value === undefined) chat.line(`${said} — done`, 'sys');
      else for (const line of describeResult(result.value)) chat.line(line, 'sys');
      return;
    }
    online.say(text);
  };

  return {
    commands,
    commandWorld,
    /** Where the compass has been pointed, for whoever draws the needle. */
    bound: (): Bound | null => bound,
    /** Arriving is what ends a walk, so it is what puts the arrow away. */
    arriving: (): void => {
      if (!bound || Math.hypot(bound.x - player.x, bound.z - player.z) >= ARRIVED) return;
      flash(`${bound.name} — you are here`);
      bound = null;
    },
  };
}

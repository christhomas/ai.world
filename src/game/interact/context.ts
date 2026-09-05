import type { ChunkManager } from '../../world/chunkManager';
import type { EntityManager } from '../../entities/manager';
import type { EntityRenderer } from '../../entities/pool';
import type { Entity } from '../../entities/entity';
import type { Player } from '../../entities/player';
import type { Eyrie } from '../eyries';
import type { Skies } from '../skies';
import type { Luxury } from '../../world/prosperity';
import type { Structures } from '../../world/structures';
import type { TerrainSampler } from '../../world/terrain';
import type { Manifest } from '../../world/manifest';
import type { DialogueBox, DialogueChoice, DialogueNode } from '../../ui/dialogue';
import type { Hud } from '../../ui/hud';
import type { Chat } from '../../ui/chat';
import type { Sound } from '../audio';
import type { GameState } from '../state';
import type { Register } from '../../world/register';
import type { Jail } from '../jail';
import type { Gifts } from '../gifts';
import type { Hires } from '../hire';
import type { Rescues } from '../rescue';
import type { Nemesis } from '../nemesis';
import type { Standing } from '../standing';
import type { Places } from '../places';
import type { Market } from '../market';
import type { Party } from '../party';
import type { Duel } from '../duel';
import type { Mount } from '../mount';
import type { Sailing } from '../sailing';
import type { Plots } from '../farming';
import type { Houses } from '../building';
import type { Grudges } from '../grudge';
import type { Fishing } from '../fishing';
import type { Online } from '../online';
import type { Handover } from '../handover';
import type { Remains } from '../remains';
import type { FerryLine } from '../ferry';
import type { Quest } from '../quests';
import type * as THREE from 'three';

/**
 * Everything an interaction can reach. One Enter press has to be able to open a door, buy a
 * horse, cast a line or rent a market pitch, so this is a wide surface by nature — but it is
 * written down in one place, and each file below takes only the handful of it that it uses.
 */
/**
 * The two shapes a conversation is written in, handed on from here.
 *
 * They belong to the ui, and the game writes conversations for the ui to draw — but every
 * interaction file needing them means every interaction file reaching up a layer for them, which
 * the architecture test counts and is right to. So the one file that already has to know about the
 * dialogue box passes the vocabulary along, and the interactions below take it sideways.
 */
export type { DialogueChoice, DialogueNode };

export interface Surroundings {
  // where the hero is, and what they are carrying
  player: Player;
  state: GameState;
  /** Places the hero has named. The set itself, so a discovery is seen everywhere at once. */
  discovered: Set<string>;

  // the world around them
  structures: Structures;
  sampler: TerrainSampler;
  chunks: ChunkManager;
  manifest: Manifest;
  entities: EntityManager;
  /** Who lives in the villages, so somebody you meet in the street has the face they always had. */
  register: Register;
  /** The cells in the country's police stations, and which stations are still standing. */
  jail: Jail;
  /** Who you have been good to, and what they have decided about you for it. */
  gifts: Gifts;
  /** The soldiers walking with somebody, and what was agreed with each. */
  hires: Hires;
  /** Which villages somebody agreed to save, how far they got, and what each owes them for it. */
  rescues: Rescues;
  /** Where Old Nettle is up to, and the one question he ever asks. */
  nemesis: Nemesis;
  /** What the country makes of you, which generosity nudges towards good. */
  standing: Standing;
  entityRenderer: EntityRenderer;
  places: Places;
  seed: number;

  // the systems a conversation can reach into
  market: Market;
  party: Party;
  duel: Duel;
  /** Ask another player for a fight with sides, bringing whoever you have already paid for. */
  callOut: (to: string) => void;
  mount: Mount;
  sailing: Sailing;
  plots: Plots;
  /** The builder you are holding, and every house you have had put up. */
  houses: Houses;
  /**
   * What each village holds against you, which owing a builder for a finished house adds to. Kept
   * apart from the good and evil scale for the same reason a dead cow is: not paying for a house
   * in one village is that village's business and not the whole country's.
   */
  grudges: Grudges;
  fishing: Fishing;
  online: Online;
  /** Goods handed over but not yet answered for, so a refusal can put them back. */
  handover: Handover;
  /** Packs left where people fell, for anybody willing to go through them. */
  remains: Remains;
  ferries: Array<{ line: FerryLine; mesh: THREE.Object3D }>;
  /** The crags with eagles on them, empty in a world with no mountains worth flying over. */
  eyries: readonly Eyrie[];
  /** The villages in the clouds, and whether the hero is standing on one of them. */
  skies: Skies;
  /** What a village has built for itself with what it earned, by name. */
  luxuryOf: (village: string) => Luxury;
  /**
   * What a village believes about the mine it works, or nothing when there is nothing to say.
   *
   * Belief and not fact, which is why it comes through a village name rather than a mine: a mine
   * the player emptied on Tuesday is still a death trap in this room until somebody has been in
   * to say otherwise, and a room that reported the truth would take that away.
   */
  saidOfMine: (village: string) => string;
  quests: Map<string, Quest>;

  // how an interaction answers back
  dialogue: DialogueBox;
  hud: Hud;
  chat: Chat;
  sound: Sound;

  // the few things only main.ts can do
  /** Whether it is raining, which the fish care about. */
  raining: () => boolean;
  discover: (name: string) => void;
  persist: () => void;
  startTalk: (e: Entity) => void;
  questLine: (q: { kind: string; target: string; count: number }) => string;
}

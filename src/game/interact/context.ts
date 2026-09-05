import type { ChunkManager } from '../../world/chunkManager';
import type { EntityManager } from '../../entities/manager';
import type { EntityRenderer } from '../../entities/pool';
import type { Entity } from '../../entities/entity';
import type { Player } from '../../entities/player';
import type { Eyrie } from '../eyries';
import type { Luxury } from '../../world/prosperity';
import type { Structures } from '../../world/structures';
import type { TerrainSampler } from '../../world/terrain';
import type { Manifest } from '../../world/manifest';
import type { DialogueBox } from '../../ui/dialogue';
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
  fishing: Fishing;
  online: Online;
  /** Goods handed over but not yet answered for, so a refusal can put them back. */
  handover: Handover;
  /** Packs left where people fell, for anybody willing to go through them. */
  remains: Remains;
  ferries: Array<{ line: FerryLine; mesh: THREE.Object3D }>;
  /** The crags with eagles on them, empty in a world with no mountains worth flying over. */
  eyries: readonly Eyrie[];
  /** What a village has built for itself with what it earned, by name. */
  luxuryOf: (village: string) => Luxury;
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

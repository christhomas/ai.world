import type { ChunkManager } from '../../world/chunkManager';
import type { EntityManager } from '../../entities/manager';
import type { EntityRenderer } from '../../entities/pool';
import type { Entity } from '../../entities/entity';
import type { Player } from '../../entities/player';
import type { Structures } from '../../world/structures';
import type { TerrainSampler } from '../../world/terrain';
import type { Manifest } from '../../world/manifest';
import type { DialogueBox } from '../../ui/dialogue';
import type { Hud } from '../../ui/hud';
import type { Chat } from '../../ui/chat';
import type { Sound } from '../audio';
import type { GameState } from '../state';
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
  entityRenderer: EntityRenderer;
  places: Places;
  seed: number;

  // the systems a conversation can reach into
  market: Market;
  party: Party;
  duel: Duel;
  mount: Mount;
  sailing: Sailing;
  plots: Plots;
  fishing: Fishing;
  online: Online;
  /** Goods handed over but not yet answered for, so a refusal can put them back. */
  handover: Handover;
  ferries: Array<{ line: FerryLine; mesh: THREE.Object3D }>;
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

import { Player } from '../entities/player';
import type { TileWorld } from '../entities/entity';
import type { EntityRenderer } from '../render/entities';
import type { IsoCamera } from '../render/camera';
import type { SessionSave } from '../save/store';
import { whereAWorldOpens } from '../world/opening';
import type { Village } from '../world/structures';

export interface PlayerOpening {
  world: TileWorld;
  renderer: Pick<EntityRenderer, 'add'>;
  camera: IsoCamera;
  villages: readonly Village[];
  saved?: Pick<SessionSave, 'cam' | 'player'>;
  /** Already parsed by the host: a browser link, or an installed start request. */
  at?: { x: number; z: number };
  freeCamera?: boolean;
}

/** The production hero's first position and camera, before any frame can walk him. */
export function openPlayer(ctx: PlayerOpening): Player {
  const opening = ctx.saved?.player ? null : whereAWorldOpens(ctx.villages);
  const at = ctx.at ?? ctx.saved?.player ?? { x: opening?.x ?? 0, z: opening?.z ?? 0 };
  if (ctx.saved) {
    ctx.camera.rotation = ctx.saved.cam.rot;
    ctx.camera.restoreZoom(ctx.saved.cam.zoom);
  }
  const player = new Player(ctx.world, ctx.renderer, at.x, at.z);
  ctx.camera.target.set(at.x, 0, at.z);
  if (ctx.freeCamera) player.mode = 'free';
  return player;
}

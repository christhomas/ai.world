import type { WorldInvite } from '../../server/protocol';
import { impactOnReturningSave } from '../world/editimpacts';
import { joinedManifest } from '../world/manifest';
import { kindOf, type SessionSave } from './store';

/**
 * A named shared world's save, as an installed app joins it (#565): what the server said the world
 * is when it was asked by name (`GET /world?name=`), laid over whatever this slot kept of it.
 *
 * The page does the same in `boot.ts`, with the check against the edited ground in a worker. The
 * world's own anchors are the ones that count, and a returning hero whose private places that ground
 * would now bury is refused with the reason rather than put back into it.
 */
export function joinNamed(invite: WorldInvite, kept: SessionSave | undefined): SessionSave {
  const saved = kept?.seed === invite.seed ? kept : undefined;
  const joined = joinedManifest(invite.seed, saved?.manifest, invite.layers, invite.terrain, invite.sites, invite.skyEyries);
  if (saved) {
    const conflict = impactOnReturningSave(saved, joined);
    if (conflict) {
      throw new Error(`${conflict} Your saved progress is unchanged. You cannot enter this world until its ground is made safe for your saved places.`);
    }
  }
  return {
    ...(saved ?? { seed: invite.seed, cam: { x: 0, z: 0, rot: 0, zoom: 1 } }),
    seed: invite.seed, world: kindOf(invite.kind), worldName: invite.name, manifest: joined,
  };
}

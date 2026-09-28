import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Simulation } from '../sim';
import type { GroundWorker } from '../groundworker';
import { bodyOf } from '../builder/proxy';
import { terrainPreview } from '../../src/ui/terrainpreview';
import { elevationFor } from '../../src/world/growworld';
import { authoredTerrain, mountainAnchor, mountainDraft, skyEyrieAnchor } from '../../src/world/worldediting';
import { addMountain } from '../../src/world/worldediting';
import { Manifest } from '../../src/world/manifest';
import { assessSkyAccess, assessSkyEyrie } from '../../src/world/skyaccess';
import { assessPlacePins, assessVillageContinuity } from '../../src/world/editimpacts';

const reply = (res: ServerResponse, code: number, value: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

/** Called only after the tools portal has checked the signed-in session. */
export function worldEditor(sim: Simulation, worker: GroundWorker | null) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('name');
        if (!name) {
          reply(res, 200, { worlds: sim.rooms.knownWorlds().filter((w) => w.name && w.kind === 'endless') });
          return;
        }
        const record = sim.rooms.worldRecord(name);
        if (!record || record.kind === 'road') { reply(res, 404, { error: 'Choose an existing endless world.' }); return; }
        const manifest = sim.rooms.manifestOf(record.seed);
        const draftText = url.searchParams.get('draft');
        const mode = url.searchParams.get('mode') ?? 'mountain';
        const draftValue: unknown = draftText ? JSON.parse(draftText) : null;
        const draft = mode === 'terrain' ? authoredTerrain(draftValue)
          : mode === 'eyrie' ? null : mountainDraft(draftValue);
        if (draftText && !draft) { reply(res, 400, { error: 'The layer parameters are invalid.' }); return; }
        const highlands = [...elevationFor(manifest)];
        if (draft && mode === 'mountain' && 'lift' in draft) highlands.push({ x: draft.x, z: draft.z, reach: draft.reach,
          lift: draft.lift, roughness: draft.roughness, seed: draft.seed });
        const terrain = draft && mode === 'terrain' && 'kind' in draft ? [...manifest.terrain, draft] : manifest.terrain;
        const x = Number(url.searchParams.get('x') ?? draft?.x ?? 0);
        const z = Number(url.searchParams.get('z') ?? draft?.z ?? 0);
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z) || Math.abs(x) > 1_000_000 || Math.abs(z) > 1_000_000) {
          reply(res, 400, { error: 'The map centre is invalid.' }); return;
        }
        const pixels = worker
          ? await worker.preview(record.seed, x, z, 64, highlands, terrain)
          : terrainPreview(record.seed, terrain, x, z, 64, highlands);
        reply(res, 200, { record, revision: sim.namedWorldRevision(name), layers: manifest.layers(),
          sites: manifest.byKind('skyisle'), skyEyries: manifest.byKind('eyrie').filter((a) => a.version === 2),
          terrain: manifest.terrain, pixels: Array.from(pixels), centre: { x, z }, span: 512 });
        return;
      }
      if (req.method === 'POST') {
        const body = await bodyOf(req, 2048);
        if (!body) { reply(res, 400, { error: 'The edit is empty or too large.' }); return; }
        const value = JSON.parse(body) as { name?: unknown; revision?: unknown; draft?: unknown; mode?: unknown };
        if (typeof value.name !== 'string' || typeof value.revision !== 'string') {
          reply(res, 400, { error: 'Choose a world and reload its map.' }); return;
        }
        const record = sim.rooms.worldRecord(value.name);
        if (!record || record.kind === 'road') { reply(res, 404, { error: 'Choose an existing endless world.' }); return; }
        const before = sim.rooms.manifestOf(record.seed);
        const after = new Manifest(record.seed, before.toJSON());
        let proposed: unknown;
        let x: number, z: number, reach: number;
        if (value.mode === 'eyrie') {
          const candidate = value.draft as { siteId?: unknown; x?: unknown; z?: unknown } | null;
          if (!candidate || typeof candidate.siteId !== 'string') {
            reply(res, 400, { error: 'Choose a pinned sky village.' }); return;
          }
          const anchor = skyEyrieAnchor(before, candidate.siteId, candidate.x as number, candidate.z as number,
            `eyrie:edit:${randomUUID()}`);
          if (!anchor) { reply(res, 400, { error: 'Choose a mountain near that sky village.' }); return; }
          const check = worker ? await worker.placeEyrie(record.seed, before.toJSON(), anchor)
            : { conflict: assessSkyEyrie(record.seed, before.toJSON(), anchor) };
          if (check.conflict) { reply(res, 409, { error: check.conflict }); return; }
          reply(res, 200, { revision: sim.authorNamedSkyEyrie(value.name, value.revision, anchor) });
          return;
        }
        if (value.mode === 'terrain') {
          const layer = authoredTerrain(value.draft);
          if (!layer) { reply(res, 400, { error: 'The land or sea parameters are invalid.' }); return; }
          after.terrain.push(layer);
          proposed = layer;
          ({ x, z, reach } = layer);
        } else if (value.mode === 'mountain') {
          const draft = mountainDraft(value.draft);
          if (!draft) { reply(res, 400, { error: 'The mountain parameters are invalid.' }); return; }
          const anchor = mountainAnchor(draft, `highland:edit:${randomUUID()}`);
          if (!addMountain(after, anchor)) { reply(res, 400, { error: 'This world already has 32 mountains.' }); return; }
          proposed = anchor;
          ({ x, z, reach } = draft);
        } else { reply(res, 400, { error: 'Choose a land, sea, or mountain edit.' }); return; }
        const reminders = sim.namedWorldReminders(value.name, x, z, reach);
        const assessment = worker
          ? await worker.assess(record.seed, before.toJSON(), after.toJSON(), x, z, reach,
            reminders.pins, reminders.villages, reminders.protectAllVillages)
          : (() => {
            const sky = assessSkyAccess(record.seed, before.toJSON(), after.toJSON(), x, z, reach);
            if (sky.conflict) return sky;
            const changed = [{ x, z, reach }];
            const conflict = assessPlacePins(record.seed, before.toJSON(), after.toJSON(), changed, reminders.pins)
              ?? assessVillageContinuity(record.seed, before.toJSON(), after.toJSON(), changed,
                reminders.villages, reminders.protectAllVillages);
            return conflict ? { sites: [], conflict } : sky;
          })();
        if (assessment.conflict) { reply(res, 409, { error: assessment.conflict }); return; }
        const revision = value.mode === 'terrain'
          ? sim.authorNamedTerrain(value.name, value.revision, proposed, assessment.sites)
          : sim.authorNamedMountain(value.name, value.revision, proposed, assessment.sites);
        reply(res, 200, { revision });
        return;
      }
      reply(res, 405, { error: 'Use GET or POST.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The edit failed.';
      reply(res, message.includes('changed') || message.includes('Leave this world') ? 409 : 400, { error: message });
    }
  };
}

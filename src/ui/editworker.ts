import { assessSavedEdit, type EditReach } from '../world/savededit';
import type { ManifestJson } from '../world/manifest';
import { impactOnReturningSave, type PlacePin } from '../world/editimpacts';
import type { SessionSave } from '../save/store';

self.onmessage = (event: MessageEvent<{
  kind?: 'edit';
  seed: number; before: ManifestJson; after: ManifestJson; changed: EditReach[]; pins: PlacePin[];
  villages: string[]; protectAllVillages: boolean;
} | { kind: 'returning'; save: SessionSave; joined: ManifestJson }>) => {
  try {
    if (event.data.kind === 'returning') {
      self.postMessage({ conflict: impactOnReturningSave(event.data.save, event.data.joined) });
      return;
    }
    self.postMessage(assessSavedEdit(event.data.seed, event.data.before, event.data.after,
      event.data.changed, event.data.pins, event.data.villages, event.data.protectAllVillages));
  } catch (error) {
    self.postMessage({ sites: [], conflict: error instanceof Error ? error.message : String(error) });
  }
};

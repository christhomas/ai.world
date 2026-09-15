import { describe, expect, it } from 'vitest';
import { createActionPreview } from './action-preview';

const key = (x = 4, z = 7, version = 2, place = 'outdoors') => ({ x, z, version, place });

describe('the contextual action preview', () => {
  it('bounds idle scans while still refreshing slow world changes', () => {
    let scans = 0;
    const preview = createActionPreview(() => `action ${++scans}`);

    expect(preview.at(0, key())).toBe('action 1');
    for (let frame = 0; frame < 120; frame++) preview.at(1 / 60, key());

    expect(scans, 'the fixture never exercised its interaction scan').toBeGreaterThan(1);
    expect(scans, 'an idle two seconds still scanned the interaction chain every frame').toBeLessThanOrEqual(9);
  });

  it('refreshes immediately after movement, state, place, or the action itself changes', () => {
    let scans = 0;
    const preview = createActionPreview(() => `action ${++scans}`);
    expect(preview.at(0, key())).toBe('action 1');

    expect(preview.at(0, key(4.01)), 'movement left a stale label').toBe('action 2');
    expect(preview.at(0, key(4.01, 7, 3)), 'state left a stale label').toBe('action 3');
    expect(preview.at(0, key(4.01, 7, 3, 'indoors:pub')), 'entering left a stale label').toBe('action 4');
    preview.invalidate();
    expect(preview.at(0, key(4.01, 7, 3, 'indoors:pub')), 'the performed action left its old label').toBe('action 5');
  });
});

import { describe, expect, it } from 'vitest';
import { headingOnMap } from './mapbase';
import { yawFor } from '../entities/entity';

/**
 * One minus sign, and the sort of thing that is wrong for a fortnight before anybody notices the
 * arrow is pointing the wrong way. A rig's forward is (cos yaw, -sin yaw); a map canvas has z
 * running down its y axis. These check the two agree by walking in each direction and asking
 * where the cone would point.
 */
describe('which way the map arrow points', () => {
  /** Where a cone of this heading reaches, one unit out, in canvas coordinates. */
  const tip = (yaw: number): { x: number; y: number } => {
    const a = headingOnMap(yaw);
    return { x: Math.cos(a), y: Math.sin(a) };
  };

  it('points right on the canvas for somebody walking east', () => {
    const t = tip(yawFor(1, 0));
    expect(t.x).toBeCloseTo(1, 6);
    expect(t.y).toBeCloseTo(0, 6);
  });

  it('points down the canvas for somebody walking south, which is +z', () => {
    const t = tip(yawFor(0, 1));
    expect(t.y).toBeCloseTo(1, 6);
    expect(t.x).toBeCloseTo(0, 6);
  });

  it('points up the canvas for somebody walking north', () => {
    const t = tip(yawFor(0, -1));
    expect(t.y).toBeCloseTo(-1, 6);
  });

  it('points left for somebody walking west', () => {
    const t = tip(yawFor(-1, 0));
    expect(t.x).toBeCloseTo(-1, 6);
  });

  it('turns the same way the hero turns', () => {
    // a quarter turn from east should land on south, not north
    const east = tip(yawFor(1, 0)), south = tip(yawFor(0, 1));
    const cross = east.x * south.y - east.y * south.x;
    expect(cross, 'the cone turns the wrong way round').toBeGreaterThan(0);
  });
});

/**
 * The dark over the country you have not walked yet.
 *
 * What is remembered is a set of chunks, and each used to be punched out of the fog as a hard
 * rectangle — a staircase with sixteen-tile steps, which on a corner map showing a hundred and ten
 * tiles is a third of the width per step. Turned with the camera it arrived as a blocky diamond
 * and read as a rendering fault rather than as fog.
 *
 * The fix is one soft-edged punch through the union of every chunk, and the "one" is the part
 * worth pinning: blur each rectangle on its own and where two chunks meet each takes about half of
 * what is left, so the seam stays half dark and the inside of the known world is criss-crossed
 * with the grid it was revealed in — invisible in a picture of the middle of the map, obvious to
 * anybody actually playing.
 */
describe('the fog over what has not been walked', () => {
  /** A canvas that writes down what was done to it rather than drawing anything. */
  function paper() {
    const calls: string[] = [];
    const ctx = {
      filter: 'none', globalCompositeOperation: 'source-over', fillStyle: '',
      setTransform: () => {},
      clearRect: () => calls.push('clear'),
      fillRect: () => calls.push(`fill:${ctx.fillStyle}`),
      drawImage: () => calls.push(`punch:${ctx.globalCompositeOperation}:${ctx.filter}`),
    };
    return { calls, canvas: { width: 0, height: 0, getContext: () => ctx } };
  }

  /** Stand in a document long enough for a Fog to be built in it, then put it back. */
  async function withPaper<T>(body: (made: ReturnType<typeof paper>[]) => T): Promise<T> {
    const made: ReturnType<typeof paper>[] = [];
    const had = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => { const p = paper(); made.push(p); return p.canvas; },
    };
    try { return body(made); } finally { (globalThis as { document?: unknown }).document = had; }
  }

  it('takes the known world out in one soft-edged stroke, not one per chunk', async () => {
    const { Fog } = await import('./mapbase');
    await withPaper((made) => {
      const fog = new Fog({ canvas: { width: 800 } as HTMLCanvasElement, pad: 100 });
      // made[0] is the fog itself, made[1] the mask of everywhere walked
      const drawn = made[0];
      drawn.calls.length = 0;
      fog.reveal(['0,0', '1,0', '0,1', '1,1']);
      const punches = drawn.calls.filter((c) => c.startsWith('punch'));
      expect(punches, 'four chunks, one punch').toHaveLength(1);
      expect(punches[0]).toContain('destination-out');
      expect(punches[0], 'and the edge is feathered').toMatch(/blur\(\d+px\)/);
    });
  });

  it('does not repaint when a walk turns up nothing new', async () => {
    const { Fog } = await import('./mapbase');
    await withPaper((made) => {
      const fog = new Fog({ canvas: { width: 800 } as HTMLCanvasElement, pad: 100 });
      const drawn = made[0];
      fog.reveal(['0,0', '1,0']);
      const after = drawn.calls.length;
      // the frame loop asks on every chunk boundary crossed, and the answer is usually the same
      fog.reveal(['0,0', '1,0']);
      expect(drawn.calls.length, 'the same two chunks cost nothing').toBe(after);
      fog.reveal(['0,0', '1,0', '2,0']);
      expect(drawn.calls.length, 'a third one does').toBeGreaterThan(after);
    });
  });
});

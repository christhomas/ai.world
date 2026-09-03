import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './graph';
import { GRAPH } from '../core/config';

describe('generateRoadGraph', () => {
  it('is deterministic per seed', () => {
    const a = generateRoadGraph(123), b = generateRoadGraph(123);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.edges).toEqual(b.edges);
    expect(generateRoadGraph(124).nodes.length).not.toBe(a.nodes.length);
  });

  it('grows a sizeable tree inside the radius with sane levels', () => {
    const g = generateRoadGraph(2024);
    expect(g.nodes.length).toBeGreaterThan(200);
    for (const n of g.nodes) {
      expect(Math.hypot(n.x, n.z)).toBeLessThanOrEqual(GRAPH.RADIUS + 1e-6);
      expect(n.level).toBeGreaterThanOrEqual(1);
      if (n.parent >= 0) expect(Math.abs(n.level - g.nodes[n.parent].level)).toBeLessThanOrEqual(1);
    }
    // every node except the hub has a parent edge; hub subtree contains everything
    expect(g.nodes[0].size).toBe(g.nodes.length);
    expect(g.edges.filter((e) => !e.loop).length).toBe(g.nodes.length - 1);
    expect(g.edges.some((e) => e.loop)).toBe(true);
    const maxR = Math.max(...g.nodes.map((n) => Math.hypot(n.x, n.z)));
    expect(maxR).toBeGreaterThan(GRAPH.RADIUS * 0.6);
  });
});

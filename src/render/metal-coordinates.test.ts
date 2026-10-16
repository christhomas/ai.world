import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync('client/flutter/ios/Runner/WorldRendererBridge.swift', 'utf8');

describe('production Metal coordinate boundaries', () => {
  it('normalizes imported cameras once while leaving native light/fallback matrices alone', () => {
    expect(bridge.match(/importedMetalProjection\(projection\)/g)).toHaveLength(1);
    expect(bridge).toContain('sceneProjection = importedMetalProjection(projection)');
    expect(bridge).toContain('mvp: sceneProjection.map { $0 * (sceneWorld?.inverse ?? matrix_identity_float4x4) } ?? projection * view');
    expect(bridge).toContain('lightMvp: light,');
    expect(bridge).toContain('o.position=u.mvp*float4(o.world,1)');
  });

  it('sets the shared winding and keeps material-specific culling in both passes', () => {
    const draw = bridge.slice(bridge.indexOf('private func draw('), bridge.indexOf('private func depthState('));
    expect(draw).toContain('encoder.setFrontFacing(.counterClockwise)');
    expect(draw).toContain('encoder.setCullMode(mesh.style.doubleSided ? .none : mesh.style.backSide ? .front : .back)');
    expect(draw.indexOf('setFrontFacing')).toBeLessThan(draw.indexOf('for mesh in ordered'));
  });

  it('samples the native shadow depth with top-origin texture coordinates', () => {
    expect(bridge).toContain('float3 q=shadowCoordinates(in.shadow)');
    expect(bridge).toContain('return float3(ndc.x*.5+.5,.5-ndc.y*.5,ndc.z)');
    expect(bridge).not.toContain('in.shadow.xyz/in.shadow.w*.5+.5');
  });
});

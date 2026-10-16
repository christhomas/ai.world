import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WaterMaterial } from './water';

const metal = readFileSync('client/flutter/ios/Runner/WorldRendererBridge.swift', 'utf8');

function webFragment(): string {
  const water = new WaterMaterial();
  const shader = {
    uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  } as Parameters<typeof water.material.onBeforeCompile>[0];
  water.material.onBeforeCompile(shader, null as unknown as Parameters<typeof water.material.onBeforeCompile>[1]);
  water.dispose();
  return shader.fragmentShader;
}

function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  expect(open).toBeGreaterThan(start);
  let nesting = 1, end = open + 1;
  for (; end < source.length && nesting > 0; end++) {
    if (source[end] === '{') nesting++;
    if (source[end] === '}') nesting--;
  }
  expect(nesting).toBe(0);
  const body = source.slice(open + 1, end - 1);
  expect(body.trim().length).toBeGreaterThan(20);
  return body;
}

function tokens(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/\bfloat([234])\b/g, 'vec$1').replace(/\bcoastArea\b/g, 'uCoastArea')
    .replace(/\brange\b/g, 'uCoastArea.w').replace(/\bworld\b/g, 'vWPos')
    .replace(/\bflow\b/g, 'vFlow').replace(/\bsea\b/g, 'vSea')
    .replace(/diffuseColor\.rgb/g, 'albedo').replace(/diffuseColor\.a/g, 'opacity')
    .replace(/\bfloat\s+(gShore|opacity)\b/g, '$1').replace(/\bvec3\s+gWave\b/g, 'gWave')
    .replace(/gCrest\s*=\s*h0\s*;/g, '').replace(/float\s+t\s*=\s*uTime\s*;/g, '')
    .replace(/(?:\d+\.\d*|\.\d+|\d+)/g, (number) => String(Number(number)))
    .replace(/\s+/g, '');
}

describe('Metal water formula drift and production linkage', () => {
  it('preserves every web shore, ripple and refracted-wave calculation', () => {
    const web = webFragment();
    for (const helper of ['shoreAt', 'rippleAt', 'waveAt']) {
      let native = block(metal, `float ${helper}(`);
      if (helper === 'shoreAt') {
        native = native.replace('if (coastArea.z <= 0.0) return coastArea.w;', '')
          .replace('constexpr sampler cs(coord::normalized,address::clamp_to_edge,filter::linear);', '')
          .replace('coastMap.sample(cs, clamp(uv, 0.0, 1.0), level(0))', 'texture2D(uCoast, clamp(uv, 0.0, 1.0))');
      }
      expect(tokens(native), helper).toBe(tokens(block(web, `float ${helper}(`)));
    }
  });

  it('preserves the complete web water colour, alpha and slope calculation', () => {
    const native = block(metal, 'WaterSurface waterSurface(');
    const result = native.indexOf('WaterSurface result;');
    expect(result).toBeGreaterThan(0);
    const calculations = native.slice(0, result)
      .replaceAll(', coastArea, coastMap', '').replaceAll(', coastArea.w)', ')');
    expect(tokens(calculations)).toBe(tokens(block(webFragment(), '#include <color_fragment>')));
    expect(native).toContain('result.normal = normalize(mix(gWave, normalize(geometryNormal), flow)) * faceDirection;');
  });

  it('uses the production helper before lighting and uploads optional time and distance range', () => {
    expect(metal).toContain('bool frontFacing [[front_facing]]');
    expect(metal).toContain('WaterSurface water=waterSurface(in.world,in.normal,albedo,in.flow,in.sea,u.lookAndTime.w,frontFacing?1.0:-1.0,u.coastArea,coastMap)');
    expect(metal).toContain('albedo=water.albedo;n=water.normal;opacity=water.opacity;');
    expect(metal).toContain('return float4(c,opacity)');
    expect(metal.indexOf('WaterSurface water=waterSurface')).toBeLessThan(metal.indexOf('float3 lit=u.ambient'));
    expect(metal).toContain('(arguments["renderTimeMs"] as? NSNumber)?.doubleValue');
    expect(metal).toContain('(coast?["range"] as? NSNumber)?.floatValue ?? 64');
    expect(metal).toContain('metalRenderTimeSeconds(renderTimeMs: sceneRenderTimeMs,');
  });
});

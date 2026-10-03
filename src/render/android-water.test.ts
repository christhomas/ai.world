import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WaterMaterial } from './water';

const android = readFileSync('client/flutter/android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt', 'utf8');

function webFragment(): string {
  const water = new WaterMaterial();
  const shader = {
    uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>',
  } as Parameters<typeof water.material.onBeforeCompile>[0];
  water.material.onBeforeCompile(shader, null as unknown as Parameters<typeof water.material.onBeforeCompile>[1]);
  water.dispose();
  return shader.fragmentShader;
}

// Read balanced shader blocks, rather than accepting a few constants inside an unused helper.
function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `missing shader block ${marker}`).toBeGreaterThanOrEqual(0);
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
    .replace(/\btexture2D\b/g, 'texture').replace(/\bvWPos\b/g, 'vWorld')
    .replace(/diffuseColor\.rgb/g, 'albedo').replace(/diffuseColor\.a/g, 'opacity')
    .replace(/\bfloat\s+gShore\b/g, 'gShore').replace(/\bvec3\s+gWave\b/g, 'gWave')
    .replace(/gCrest\s*=\s*h0\s*;/g, '') // The web retains this currently unused global.
    .replace(/(?:\d+\.\d*|\.\d+|\d+)/g, (number) => String(Number(number)))
    .replace(/\s+/g, '');
}

describe('Android executes the production web water formulas', () => {
  it('matches coast bounds, ripple trains, refraction and shoaling from the generated web shader', () => {
    const web = webFragment();
    for (const helper of ['shoreAt', 'rippleAt', 'waveAt']) {
      let native = block(android, `float ${helper}(`);
      if (helper === 'shoreAt') {
        // No native coast texture exists before the first coast packet. This guard supplies open sea.
        expect(native).toContain('if (uCoastArea.z <= 0.0) return uCoastArea.w;');
        native = native.replace('if (uCoastArea.z <= 0.0) return uCoastArea.w;', '');
      }
      expect(tokens(native), helper).toBe(tokens(block(web, `float ${helper}(`)));
    }
  });

  it('matches every sea/flow mask, slope sample, tint, breaker, wash, glint and alpha expression', () => {
    const web = block(webFragment(), '#include <color_fragment>');
    const native = block(android, 'if(vMaterial>1.5&&vMaterial<2.5)');
    const normalStart = native.indexOf('// World-space wave');
    expect(normalStart).toBeGreaterThan(0);
    expect(tokens(native.slice(0, normalStart))).toBe(tokens(web));
    expect(native).toContain('n = normalize(mix(gWave, n, vFlow)) * (gl_FrontFacing ? 1.0 : -1.0);');
    expect(android).toContain('color=vec4(c,opacity)');
    expect(android.indexOf('float white = mix(foam,')).toBeLessThan(android.indexOf('vec3 lit=uAmbient'));
    expect(android).toContain('vec3 c=albedo*(vMaterial>2.5?vec3(1.0):lit*RECIPROCAL_PI)+uEmissive');
  });

  it('uploads the complete coast area and keeps current range/defaults explicit', () => {
    expect(android).toContain('uniform vec4 uCoastArea');
    expect(android).toContain('GLES30.glUniform4fv(GLES30.glGetUniformLocation(program, "uCoastArea"), 1, coastArea, 0)');
    expect(android).toContain('(coast["range"] as? Number)?.toFloat() ?: 64f');
    expect(android).toContain('floatArrayOf(0f, 0f, 0f, 64f)');
    const coast = readFileSync('src/render/coastfield.ts', 'utf8');
    expect(coast).toMatch(/RANGE:\s*64,/);
    expect(android).toContain('const float PI2 = 6.283185307179586;');
  });
});

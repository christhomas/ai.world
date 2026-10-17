import { readFileSync } from 'node:fs';
import { ShaderChunk } from 'three';
import { SRGBToLinear } from 'three/src/math/ColorManagement.js';
import { describe, expect, it } from 'vitest';

const bridges = [
  ['GLES', 'client/flutter/android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt'],
  ['Metal', 'client/flutter/ios/Runner/WorldRendererBridge.swift'],
].map(([name, path]) => ({ name, source: readFileSync(path, 'utf8') }));

function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  expect(open).toBeGreaterThan(start);
  let depth = 1, end = open + 1;
  for (; end < source.length && depth > 0; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  expect(depth).toBe(0);
  return source.slice(open + 1, end - 1);
}

function tokens(source: string): string {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bfloat3\b/g, 'vec3')
    .replace(/(?:\d+\.\d*|\.\d+|\d+)/g, number => String(Number(number)))
    .replace(/\s+/g, '')
    .replace(/vec3\((\d+(?:\.\d+)?)\)/g, '$1');
}

describe('native colour maths follows the installed three.js', () => {
  it('decodes authored hex channels with Color.setHex\'s CPU transfer function', () => {
    const dart = readFileSync('client/flutter/lib/src/colour.dart', 'utf8');
    const decode = block(dart, 'double _decode(')
      .replace('final value = bits / 255;', '')
      .replace(/\bvalue\b/g, 'c').replace('math.pow', 'Math.pow').replace('.toDouble()', '');
    const web = block(SRGBToLinear.toString(), 'SRGBToLinear(');
    expect(tokens(decode)).toBe(tokens(web).replace('(c<0.04045)', 'c<0.04045'));
  });

  for (const { name, source } of bridges) {
    it(`${name} uses three.js's complete distance/decay and cutoff calculation`, () => {
      for (const helper of ['pow2', 'pow4']) {
        expect(tokens(block(source, `float ${helper}(`)))
          .toBe(tokens(block(ShaderChunk.common, `float ${helper}(`)));
      }
      const web = block(ShaderChunk.lights_pars_begin, 'float getDistanceAttenuation(')
        .replace(/\blightDistance\b/g, 'd').replace(/\bcutoffDistance\b/g, 'cutoff')
        .replace(/\bdecayExponent\b/g, 'decay').replace(/\bdistanceFalloff\b/g, 'f');
      expect(tokens(block(source, 'float attenuation('))).toBe(tokens(web));
      expect(source).toContain('*attenuation(length(');
    });

    it(`${name} applies the Lambert BRDF per direct light, then adds indirect and emissive`, () => {
      const pi = ShaderChunk.common.match(/#define RECIPROCAL_PI ([\d.]+)/);
      expect(pi).not.toBeNull();
      expect(source).toContain(`float RECIPROCAL_PI=${pi![1]};`);
      if (name === 'GLES') {
        expect(tokens(source)).toContain(tokens('#define saturate(a) clamp(a,0.0,1.0)'));
      }
      expect(tokens(block(source, ' BRDF_Lambert(')))
        .toBe(tokens(block(ShaderChunk.common, 'vec3 BRDF_Lambert(')));
      const web = block(ShaderChunk.lights_lambert_pars_fragment, 'void RE_Direct_Lambert(')
        .replace(/\bgeometryNormal\b/g, 'normal').replace(/directLight\.direction/g, 'lightDirection')
        .replace(/directLight\.color/g, 'lightColour').replace(/material\.diffuseColor/g, 'diffuseColor')
        .replace('reflectedLight.directDiffuse +=', 'return');
      expect(tokens(block(source, ' lambertDirect('))).toBe(tokens(web));
      const start = source.indexOf(name === 'GLES' ? 'void main(){if(uCutOn' : 'fragment float4 worldFragment(');
      expect(start).toBeGreaterThanOrEqual(0);
      const fragment = source.slice(start);
      // The helpers must be reached by both light loops, after attenuation/shadowing.
      expect(fragment.match(/directDiffuse\+=lambertDirect\(/g)).toHaveLength(2);
      expect(fragment.indexOf('i<16')).toBeLessThan(fragment.indexOf('i<4'));
      expect(fragment).toContain('lightColour=q.rgb*attenuation(length(');
      expect(fragment).toContain('lightColour=s.rgb*(s.w>.5?shade:1.0)');
      expect(fragment).toContain('indirectDiffuse=lit*BRDF_Lambert(albedo)');
      expect(fragment).toContain('albedo:directDiffuse+indirectDiffuse+');
    });

    it(`${name} encodes once with the web's OETF before fog and framebuffer blending`, () => {
      const web = tokens(block(ShaderChunk.colorspace_pars_fragment, 'vec4 sRGBTransferOETF('))
        .replace(/^returnvec4\(/, 'return').replace(/,value\.a\);$/, ';')
        .replaceAll('value.rgb', 'c').replace('vec3(lessThanEqual(c,0.0031308))', 'lessThanEqual(c,0.0031308)');
      const native = tokens(block(source, ' encodeSrgb(')).replace('select(', 'mix(')
        .replace('c<=0.0031308', 'lessThanEqual(c,0.0031308)');
      expect(native).toBe(web);
      expect(source.match(/c=encodeSrgb\(c\);/g)).toHaveLength(1);
      const encode = source.indexOf('c=encodeSrgb(c);');
      expect(source.indexOf('c=mix(c,', encode)).toBeGreaterThan(encode);
      expect(source).not.toContain('bgra8Unorm_srgb');
    });
  }
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Season } from '../game/seasons';
import { Weather } from './weather';

const flakesAt = (seed: number): number[] => {
  const weather = new Weather(new THREE.Scene(), seed);
  weather.set(1, Season.Winter);
  weather.update(1, 10, 20, 30);
  const positions = [...(weather.points.geometry.getAttribute('position') as THREE.BufferAttribute).array];
  weather.dispose();
  return positions;
};

describe('weather particles', () => {
  it('places the same falling field for the same world seed', () => {
    expect(flakesAt(3)).toEqual(flakesAt(3));
    expect(flakesAt(4)).not.toEqual(flakesAt(3));
  });
});

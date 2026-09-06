import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The chart and the game are one version, or the deployment is a lie.
 *
 * `appVersion` is the image tag a cluster pulls and `version` is what a HelmRelease pins. Bumping
 * one without the other gives you either a chart that points at an image nobody built, or a game
 * nobody can install — both of which are found at the worst possible moment, which is a reconcile
 * on somebody's cluster.
 */

const chart = readFileSync('chart/Chart.yaml', 'utf8');
const release = readFileSync('deploy/flux/helmrelease.yaml', 'utf8');
const field = (text: string, name: string): string =>
  text.match(new RegExp(`^\\s*${name}:\\s*'?"?([0-9]+\\.[0-9]+\\.[0-9]+)'?"?\\s*$`, 'm'))?.[1] ?? '';

describe('the chart and the game it installs', () => {
  it('carries one version for both', () => {
    const version = field(chart, 'version');
    const app = field(chart, 'appVersion');
    expect(version, 'the chart says what version it is').toMatch(/^\d+\.\d+\.\d+$/);
    expect(app, 'and the chart and the game agree about it').toBe(version);
  });

  it('is the version the cluster is told to install', () => {
    // the HelmRelease pins a chart version; if it lags, the cluster runs whatever it last saw
    expect(field(release, 'version')).toBe(field(chart, 'version'));
  });
});

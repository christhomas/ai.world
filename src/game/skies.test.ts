import { describe, expect, it } from 'vitest';
import { SkyWorld, Skies } from './skies';
import { buildSkyIsland, planSkyIslands, skyIndex } from '../world/skyisland';
import type { IslandInfo } from '../world/graph';
import type { Player } from '../entities/player';
import type { IsoCamera } from '../render/camera';
import type { TileWorld } from '../entities/entity';

const island: IslandInfo = { id: 'isle:0,0', seed: 1, x: 0, z: 0, radius: 90, biome: 0, hub: 0, firstNode: 0 };
const [site] = planSkyIslands(1, [island], []);
const isle = buildSkyIsland(site, 777);

/** The ground everywhere else: flat, walkable, and nothing like the island. */
const ground: TileWorld = {
  heightAt: () => 0.5,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

/** Just enough of a hero to be moved about and asked where they are. */
function fakePlayer() {
  const entity = { x: 0, z: 0, y: 0 };
  let world: TileWorld = ground;
  return {
    entity,
    get x() { return entity.x; },
    get z() { return entity.z; },
    get y() { return entity.y; },
    get world() { return world; },
    setWorld(w: TileWorld) { world = w; },
    teleport(x: number, z: number) { entity.x = x; entity.z = z; },
  };
}

function harness() {
  const player = fakePlayer();
  const iso = { target: { set: () => {} } };
  const said: string[] = [];
  const skies = new Skies({
    player: player as unknown as Player,
    iso: iso as unknown as IsoCamera,
    ground,
    flash: (m) => { said.push(m); },
    chime: () => {},
    discover: () => {},
    persist: () => {},
  }, [isle]);
  return { player, skies, said };
}

describe('the ground of a sky island', () => {
  const world = new SkyWorld(isle);

  it('holds you up where the island is', () => {
    expect(world.heightAt(isle.perch.x, isle.perch.z)).toBeGreaterThan(site.y - 1);
  });

  it('is nothing at all past the rim, which is what stops anybody walking off', () => {
    expect(world.heightAt(site.x + site.radius * 4, site.z)).toBeNull();
    expect(world.blocked(site.x + site.radius * 4, site.z)).toBe(true);
  });

  it('is water where the spring is, and not somewhere to stand', () => {
    expect(world.heightAt(site.x, site.z)).toBeNull();
    expect(world.waterAt(site.x, site.z)).toBeGreaterThan(0);
  });

  it('has no roads on it, because six houses round a spring do not need one', () => {
    expect(world.isRoad()).toBe(false);
  });
});

/**
 * The one rule this whole feature lives or dies by: a hero who goes up can always come down. Every
 * other refusal in the game costs a walk; this one would cost the save.
 */
describe('going up and coming down', () => {
  it('puts the hero on the crag, on the island, on its own ground', () => {
    const { player, skies } = harness();
    skies.fly(isle, { x: 300, z: 300 });
    expect(skies.aloft).toBe(isle);
    expect(player.world).toBeInstanceOf(SkyWorld);
    const i = skyIndex(isle, player.x, player.z);
    expect(Number.isNaN(isle.top[i])).toBe(false);
    expect(player.y).toBe(isle.top[i]);
  });

  it('brings them back to the crag they left from', () => {
    const { player, skies } = harness();
    skies.fly(isle, { x: 300, z: 300 });
    skies.descend();
    expect(skies.aloft).toBeNull();
    expect(player.world).toBe(ground);
    expect([player.x, player.z]).toEqual([300, 300]);
  });

  it('gets them down even when nobody remembers where they came from', () => {
    // a world reopened while the hero was up here: the visit is restored, the crag is not
    const { player, skies } = harness();
    skies.restore(isle.site.id);
    expect(skies.aloft).toBe(isle);
    skies.descend();
    expect(skies.aloft).toBeNull();
    // the island underneath is land by construction, so this is always somewhere to be put down
    expect([player.x, player.z]).toEqual([site.x, site.z]);
  });

  it('remembers on the save which island the hero was standing on', () => {
    const { skies } = harness();
    expect(skies.save()).toBeNull();
    skies.fly(isle, { x: 0, z: 0 });
    expect(skies.save()).toBe(isle.site.id);
    skies.descend();
    expect(skies.save()).toBeNull();
  });

  it('shrugs off being asked to come down when nobody is up there', () => {
    const { player, skies } = harness();
    skies.descend();
    expect(skies.aloft).toBeNull();
    expect(player.world).toBe(ground);
  });
});

describe('staying on the island', () => {
  it('puts back anybody who has ended up off the edge of it', () => {
    const { player, skies, said } = harness();
    skies.fly(isle, { x: 0, z: 0 });
    // a knock-back, a shove or somebody else's teleport does not ask the island's permission
    player.teleport(site.x + site.radius * 5, site.z);
    skies.update();
    expect(skyIndex(isle, player.x, player.z)).toBeGreaterThanOrEqual(0);
    expect(said.some((s) => s.includes('crag'))).toBe(true);
  });

  it('leaves alone anybody standing where they should be', () => {
    const { player, skies } = harness();
    skies.fly(isle, { x: 0, z: 0 });
    const where = [player.x, player.z];
    skies.update();
    expect([player.x, player.z]).toEqual(where);
  });

  it('has nothing to say about somebody walking about on the ground', () => {
    const { player, skies } = harness();
    player.teleport(9999, 9999);
    skies.update();
    expect([player.x, player.z]).toEqual([9999, 9999]);
  });

  it('knows the crag and the loft apart', () => {
    const { skies } = harness();
    skies.fly(isle, { x: 0, z: 0 });
    expect(skies.atPerch(isle.perch.x, isle.perch.z)).toBe(true);
    expect(skies.atLoft(isle.loft.x, isle.loft.z)).toBe(true);
    expect(skies.atPerch(site.x + site.radius * 3, site.z)).toBe(false);
  });
});

describe('calling a bird down at the falls', () => {
  it('answers from the foot of the fall and nowhere else', () => {
    const { skies } = harness();
    expect(skies.calledFrom(isle.crag.x, isle.crag.z)).toBe(isle);
    expect(skies.calledFrom(isle.crag.x + 200, isle.crag.z)).toBeNull();
  });

  it('says nothing to somebody already standing on the island', () => {
    const { skies } = harness();
    skies.fly(isle, { x: isle.crag.x, z: isle.crag.z });
    expect(skies.calledFrom(isle.crag.x, isle.crag.z)).toBeNull();
  });

  it('names the falls the first time somebody stands under them', () => {
    const player = fakePlayer();
    const found: string[] = [];
    const skies = new Skies({
      player: player as unknown as Player,
      iso: { target: { set: () => {} } } as unknown as IsoCamera,
      ground,
      flash: () => {}, chime: () => {},
      discover: (n) => { found.push(n); },
      persist: () => {},
    }, [isle]);
    player.teleport(isle.crag.x, isle.crag.z);
    skies.update();
    expect(found).toEqual([`${isle.name} Falls`]);
  });
});

import { canStand, spaceNear } from '../entities/entity';
import type { TileWorld } from '../entities/entity';
import type { Player } from '../entities/player';
import type { EntityRenderer } from '../render/entities';
import type { Mount } from './mount';
import { breedOf } from './stables';

/** Development-only mounting controls used by the played collision checks. */
export function installMountProbes(
  debug: object, mount: Mount, player: Player, chunks: TileWorld, overworldRenderer: EntityRenderer,
): void {
  /**
   * Get on a horse, or off one, without going to a stable and having a conversation about it.
   *
   * Mounting is only reachable through a stable's dialogue, which a person does in ten seconds and
   * a script cannot do at all — and a mounted hero is the case that made stepping over things
   * visible in the first place, so the played test has never once ridden. Buys a horse where the
   * hero is standing if he has none, which is the only part a stable was really for.
   *
   * Returns what he is on and how fast it goes, because "am I actually mounted" is the question a
   * test asks next and reading it off the screen is guesswork.
   */
  (debug as { __ride?: (on?: boolean) => unknown }).__ride = (on = true) => {
    if (!on) {
      mount.dismount(player, chunks);
      return { riding: mount.riding };
    }
    if (!mount.owned) mount.buy(player.x, player.z, chunks, overworldRenderer);
    else mount.restore(chunks, overworldRenderer);
    // The playtest can summon an owned horse after teleporting to a hunt site. Place that
    // horse on ground it can use before boarding; ordinary play still requires proximity.
    if (mount.entity && !mount.near(player.x, player.z)) {
      const at = spaceNear(chunks, mount.entity.kind, player.x, player.z);
      if (at) { mount.entity.x = at.x; mount.entity.z = at.z; mount.entity.y = chunks.heightAt(at.x, at.z) ?? 0; }
    }
    mount.mount(player);
    return { riding: mount.riding, breed: mount.breed.id, name: mount.name };
  };
  (debug as { __borrowHorse?: (breed?: string) => unknown }).__borrowHorse = (breed = 'horse') => {
    try {
      mount.borrow(player.x, player.z, chunks, overworldRenderer, breedOf(breed));
      mount.mount(player);
      return { riding: mount.riding, breed: mount.breed.id };
    } catch (error) {
      mount.returnBorrowed(chunks, overworldRenderer);
      throw error;
    }
  };
  (debug as { __returnHorse?: () => void }).__returnHorse = () =>
    mount.returnBorrowed(chunks, overworldRenderer);
  (debug as { __mountClear?: (x: number, z: number, yaw: number, fromY?: number) => boolean }).__mountClear =
    (x, z, yaw, fromY) => !!player.entity.mounted && canStand(chunks, player.entity.mounted, x, z, fromY, yaw);
  /**
   * Where the rider and the body carrying them actually are.
   *
   * A mounted collision check cannot infer the horse from the rider alone: it needs to prove that
   * the longer body stopped with him and did not cross the wall while its rider stayed outside.
   */
  (debug as { __mount?: () => unknown }).__mount = () => {
    const horse = mount.entity;
    return {
      hero: { x: player.x, z: player.z },
      horse: horse ? { x: horse.x, z: horse.z } : null,
      cargo: mount.cargo,
      riding: mount.riding,
      breed: mount.breed.id,
      body: horse?.kind.body ?? null,
      saved: mount.toJSON(),
      under: horse ? Math.hypot(player.x - horse.x, player.z - horse.z) : null,
    };
  };
}

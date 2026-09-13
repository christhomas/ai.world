import { describe, expect, it } from 'vitest';
import { KINDS } from './animals';
import { Player } from './player';
import type { TileWorld } from './entity';

/**
 * A hero who is put down somewhere is not on a horse any more.
 *
 * `whatCarriesHim` decides where somebody may go from `Entity.mounted`, so that a man on a horse
 * goes where a horse goes rather than where he does. `mount.ts` sets it and `dismount` clears it,
 * which is the pair that makes it work — and it is not the only way to stop riding.
 *
 * `Player.teleport` already clears `riding`, and the reason it does is the whole argument for this:
 * being put down somewhere else means you are no longer being carried. The horse is not there. It
 * clears the flag that says he is on something and leaves the *kind* of what he is on, so from that
 * moment he walks with a horse's abilities and his own legs — no swimming, a horse's climb, a
 * horse's body for what he can squeeze past — with no horse anywhere near him.
 *
 * It is not a bad frame. Nothing sets it back, so it is the rest of the session, and the reason is
 * invisible: he is not riding, there is no horse, and the state that says otherwise is not drawn.
 */
describe('being put down somewhere', () => {
  const flat = {
    heightAt: () => 0, waterAt: () => null, blocked: () => false, isRoad: () => true,
  } as unknown as TileWorld;

  const renderer = { add: () => {} } as unknown as ConstructorParameters<typeof Player>[1];

  const mountedHero = (): Player => {
    const player = new Player(flat, renderer, 0, 0);
    player.entity.mounted = KINDS.horse;
    player.riding = true;
    return player;
  };

  it('lets go of the horse, not only of the saddle', () => {
    const player = mountedHero();
    player.teleport(40, 40);
    expect(player.riding, 'this was already right').toBe(false);
    expect(player.entity.mounted, 'he is somewhere else and the horse is not').toBeNull();
  });

  it('leaves somebody on foot exactly as they were', () => {
    const player = new Player(flat, renderer, 0, 0);
    player.teleport(10, 10);
    expect(player.entity.mounted).toBeNull();
  });
});

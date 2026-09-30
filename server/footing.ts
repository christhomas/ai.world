/**
 * Where the world has walked somebody on his own feet, when it has — and nothing else.
 *
 * For anything a player may only do standing somewhere: robbing a cart, escorting one, changing a
 * nest. What it reads is the position the last processed steer walked him to on the surface, and
 * only while nothing has moved the world's hero since. A join, a `move`, a saddle, a boat or a door
 * all leave it empty until the next steer, because each of them is a position the page chose.
 */
export function walkedFoot<T extends {
  standingIn: string;
  presence: { riding: string };
  hero: { x: number; z: number } | null;
  serverFootAt: { x: number; z: number } | null;
}>(me: T, ground: { heightAt(x: number, z: number): number | null } | null | undefined): { x: number; z: number } | null {
  const at = me.serverFootAt, hero = me.hero;
  if (me.standingIn !== 'surface' || me.presence.riding !== 'foot' || !at || !hero
    || !ground || ground.heightAt(at.x, at.z) === null
    || Math.hypot(hero.x - at.x, hero.z - at.z) > 1e-6) return null;
  return at;
}

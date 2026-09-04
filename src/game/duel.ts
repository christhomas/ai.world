import { DUEL_RANGE, type Presence } from '../../server/protocol';

export { DUEL_RANGE };

/**
 * A friendly bout between two players. Nothing real is at stake: each side keeps a separate pool
 * of duel health, so a hero who loses walks away with the same hearts, gear and gold they came
 * with. Blows are reported to the other client, which decides what they do to it, exactly as a
 * dungeon floor's owner decides what a guest's blow does to a monster.
 */
export class Duel {
  /** Who we are fighting, or empty when nobody. */
  opponent = '';
  opponentName = '';
  /** Health in this bout only, never the hero's own. */
  mine = 0;
  theirs = 0;
  private full = 0;

  get active(): boolean { return this.opponent !== ''; }

  /** Step into the ring against somebody, both sides starting on the same footing. */
  begin(id: string, name: string, health: number): void {
    this.opponent = id;
    this.opponentName = name;
    this.full = health;
    this.mine = health;
    this.theirs = health;
  }

  /**
   * Take a blow the other side says it landed.
   * @returns true when that was the blow that finished it
   */
  struck(damage: number): boolean {
    if (!this.active) return false;
    this.mine = Math.max(0, this.mine - damage);
    return this.mine === 0;
  }

  /** Note a blow of our own, so the readout moves before their next word reaches us. */
  landed(damage: number): void {
    if (this.active) this.theirs = Math.max(0, this.theirs - damage);
  }

  /** Whether somebody is close enough and near enough in front to be struck. */
  inReach(them: Presence, x: number, z: number, yaw: number, arc: number): boolean {
    const dx = them.x - x, dz = them.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance > DUEL_RANGE || distance === 0) return false;
    const facing = (dx / distance) * Math.cos(yaw) + (dz / distance) * -Math.sin(yaw);
    return facing >= Math.cos(arc);
  }

  end(): void {
    this.opponent = '';
    this.opponentName = '';
    this.mine = 0;
    this.theirs = 0;
  }

  /** The bout as one line, for the corner of the screen. */
  readout(): string {
    return this.active ? `Duel with ${this.opponentName} — you ${this.mine}/${this.full}, them ${this.theirs}/${this.full}` : '';
  }
}

import type { IsoCamera } from './camera';
import type { EntityRenderer } from './entities';
import type { Presence } from '../game/online';
import { OtherBodies } from './other-bodies';

/**
 * The other players on the page: their bodies (`OtherBodies`, which an installed app draws the
 * same way) and their names as DOM labels over their heads.
 */
export class OtherPlayers {
  private readonly people: OtherBodies;
  private readonly labels = new Map<string, HTMLDivElement>();
  private readonly holder: HTMLDivElement;

  constructor(renderer: EntityRenderer) {
    this.people = new OtherBodies(renderer);
    this.holder = document.createElement('div');
    this.holder.id = 'nameplates';
    document.body.appendChild(this.holder);
  }

  /** Match the drawn people to the people the server says are here, and their name plates with them. */
  sync(players: Iterable<Presence>, myPlace: string): void {
    this.people.sync(players, myPlace);
    const shown = this.people.shown();
    for (const [id, { text, here }] of shown) {
      let el = this.labels.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'nameplate';
        this.holder.appendChild(el);
        this.labels.set(id, el);
      }
      if (el.textContent !== text) el.textContent = text;
      el.style.display = here ? 'block' : 'none';
    }
    for (const [id, el] of this.labels) {
      if (shown.has(id)) continue;
      el.remove();
      this.labels.delete(id);
    }
  }

  /** Show a gesture over somebody's head for a few seconds. */
  emote(id: string, emoji: string): void { this.people.emote(id, emoji); }

  /** Let gestures fade in their own time. */
  age(dt: number): void { this.people.age(dt); }

  /** Ground height under each remote hero, so they stand on the land rather than in it. */
  settle(heightAt: (x: number, z: number) => number | null): void { this.people.settle(heightAt); }

  /** Put the name plates where their owners are on screen. */
  project(camera: IsoCamera, width: number, height: number): void {
    const placed = new Set<string>();
    for (const plate of this.people.plates(camera, width, height)) {
      const el = this.labels.get(plate.id);
      if (!el) continue;
      placed.add(plate.id);
      el.style.display = 'block';
      el.style.left = `${plate.x}px`;
      el.style.top = `${plate.y}px`;
    }
    // somebody behind the camera, or elsewhere, has no plate on the screen
    for (const [id, el] of this.labels) if (!placed.has(id)) el.style.display = 'none';
  }

  clear(): void {
    this.people.clear();
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }
}

import * as THREE from 'three';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import type { EntityRenderer } from '../entities/pool';
import { mulberry32 } from '../core/rng';
import { hashString } from '../core/rng';
import type { Presence } from '../game/online';

/**
 * Other players, drawn as heroes through the same instanced pool as everything else, with a name
 * floating over each one. They are ordinary entities that nothing in the world reacts to: they
 * are not spawned by the manager, so no wolf hunts them and no shopkeeper talks to them.
 */
export class OtherPlayers {
  private readonly bodies = new Map<string, Entity>();
  private readonly labels = new Map<string, HTMLDivElement>();
  private readonly holder: HTMLDivElement;

  constructor(private readonly renderer: EntityRenderer) {
    this.holder = document.createElement('div');
    this.holder.id = 'nameplates';
    document.body.appendChild(this.holder);
  }

  /** Match the drawn people to the people the server says are here. */
  sync(players: Iterable<Presence>, myPlace: string): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let body = this.bodies.get(p.id);
      if (!body) {
        const kind = KINDS.hero;
        const herd = new Herd(kind, p.x, p.z, p.x, p.z, 0);
        body = new Entity(kind, p.x, p.z, herd, 'online', mulberry32(hashString(p.id)));
        this.renderer.add(body);
        this.bodies.set(p.id, body);
      }
      // only draw people standing in the same world as you
      const here = p.place === myPlace;
      body.indoors = !here;
      body.x = p.x;
      body.z = p.z;
      body.yaw = p.yaw;
      body.walk = p.walk;
      body.phase += p.walk * 0.35;
      this.label(p, here);
    }
    for (const [id, body] of this.bodies) {
      if (seen.has(id)) continue;
      this.renderer.remove(body);
      this.bodies.delete(id);
      this.labels.get(id)?.remove();
      this.labels.delete(id);
    }
  }

  /** Ground height under each remote hero, so they stand on the land rather than in it. */
  settle(heightAt: (x: number, z: number) => number | null): void {
    for (const body of this.bodies.values()) {
      const y = heightAt(body.x, body.z);
      if (y !== null) body.y = y;
    }
  }

  private label(p: Presence, visible: boolean): void {
    let el = this.labels.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'nameplate';
      this.holder.appendChild(el);
      this.labels.set(p.id, el);
    }
    if (el.textContent !== p.name) el.textContent = p.name;
    el.style.display = visible ? 'block' : 'none';
  }

  /** Put the name plates where their owners are on screen. */
  project(camera: THREE.Camera, width: number, height: number): void {
    const point = new THREE.Vector3();
    for (const [id, body] of this.bodies) {
      const el = this.labels.get(id);
      if (!el || el.style.display === 'none') continue;
      point.set(body.x, body.y + 2.1, body.z).project(camera);
      if (point.z > 1) { el.style.display = 'none'; continue; }
      el.style.left = `${(point.x * 0.5 + 0.5) * width}px`;
      el.style.top = `${(-point.y * 0.5 + 0.5) * height}px`;
    }
  }

  /** Move every drawn person into a different scene, following the local hero. */
  attachTo(renderer: EntityRenderer): void {
    for (const [id, body] of this.bodies) {
      this.renderer.remove(body);
      renderer.add(body);
      void id;
    }
  }

  clear(): void {
    for (const [, body] of this.bodies) this.renderer.remove(body);
    this.bodies.clear();
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }
}

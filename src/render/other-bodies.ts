import * as THREE from 'three';
import { nativeCamera, type IsoCamera } from './camera';
import { KINDS } from '../entities/animals';
import { Entity, Herd } from '../entities/entity';
import type { EntityRenderer } from './entities';
import { mulberry32 } from '../core/rng';
import { hashString } from '../core/rng';

/** What a player the server says is here must tell the bodies: the game's `Presence` has these. */
interface Present {
  id: string;
  name: string;
  place: string;
  x: number;
  z: number;
  yaw: number;
  walk: number;
}

/** How long a gesture stays over somebody's head, in seconds. */
const EMOTE_LIFE = 4;

/** A name over somebody's head: where on the screen, in the viewport's pixels, and what it says. */
export interface NamePlate {
  id: string;
  text: string;
  x: number;
  y: number;
}

/**
 * The other players in this world, as bodies the entity renderer draws and names that hang over
 * their heads (#576).
 *
 * The page's name plates are DOM labels (`OtherPlayers`); an installed app draws its own. So the
 * bodies, their gestures and where each name belongs on the screen live here, with no page in them,
 * and each host puts the names wherever it puts text.
 */
export class OtherBodies {
  private readonly bodies = new Map<string, Entity>();
  private readonly names = new Map<string, { name: string; here: boolean }>();
  private readonly gestures = new Map<string, { emoji: string; left: number }>();

  constructor(private readonly renderer: EntityRenderer) {}

  /** Match the drawn people to the people the server says are here. */
  sync(players: Iterable<Present>, myPlace: string): void {
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
      this.names.set(p.id, { name: p.name, here });
    }
    for (const [id, body] of this.bodies) {
      if (seen.has(id)) continue;
      this.renderer.remove(body);
      this.bodies.delete(id);
      this.names.delete(id);
    }
  }

  /** Who is drawn now, by id: what their plate says, and whether they are in this place at all. */
  shown(): Map<string, { text: string; here: boolean }> {
    const out = new Map<string, { text: string; here: boolean }>();
    for (const [id, { name, here }] of this.names) {
      const gesture = this.gestures.get(id);
      out.set(id, { text: gesture ? `${name} ${gesture.emoji}` : name, here });
    }
    return out;
  }

  /** Show a gesture over somebody's head for a few seconds. */
  emote(id: string, emoji: string): void {
    this.gestures.set(id, { emoji, left: EMOTE_LIFE });
  }

  /** Let gestures fade in their own time. */
  age(dt: number): void {
    for (const [id, gesture] of this.gestures) {
      gesture.left -= dt;
      if (gesture.left <= 0) this.gestures.delete(id);
    }
  }

  /** Ground height under each remote hero, so they stand on the land rather than in it. */
  settle(heightAt: (x: number, z: number) => number | null): void {
    for (const body of this.bodies.values()) {
      const y = heightAt(body.x, body.z);
      if (y !== null) body.y = y;
    }
  }

  /** Where each name belongs on the screen: over the head of everybody here and in front of the camera. */
  plates(camera: IsoCamera, width: number, height: number): NamePlate[] {
    const point = new THREE.Vector3();
    const shown = this.shown();
    const out: NamePlate[] = [];
    for (const [id, body] of this.bodies) {
      const plate = shown.get(id);
      if (!plate?.here) continue;
      point.set(body.x, body.y + 2.1, body.z).project(nativeCamera(camera));
      if (point.z > 1) continue;
      out.push({ id, text: plate.text, x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height });
    }
    return out;
  }

  /** Everybody gone: the world was left. */
  clear(): void {
    for (const body of this.bodies.values()) this.renderer.remove(body);
    this.bodies.clear();
    this.names.clear();
  }
}

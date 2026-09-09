import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { Entity, Herd } from '../entities/entity';
import type { EntityRenderer } from '../entities/pool';

/**
 * Teleporting, made into something you can watch.
 *
 * A teleport used to be the one move in the game with no animation at all: the hero was here and
 * on the next frame he was two hundred tiles away, which reads as the game having lost its place
 * rather than as the player having a power. It is also the move made most often while exploring,
 * so it was the thing that most often looked like a bug.
 *
 * What happens now is a departure and an arrival. Where he left, a bright column of light stands
 * up into the sky and his own rig comes apart inside it — every block he is drawn from rising,
 * turning over and shrinking away. Where he lands, the same in reverse: the light stands, the
 * blocks fall together, and he is standing there.
 *
 * The blocks are the point, and they are not particles. This world is made of boxes and the hero
 * is a couple of dozen of them already, so the effect is those boxes flying apart — `Entity.apart`
 * and `pool.ts` do the actual scattering, working on the matrices the rig had worked out anyway.
 * Nothing new is drawn, nothing is cut, and he comes apart wearing whatever he is wearing.
 *
 * Two things this deliberately does not do.
 *
 * The simulation is not delayed by any of it. `player.teleport` still puts the hero at his
 * destination between one frame and the next — the playtest tool teleports and then reads his
 * position, and the game would be a liar besides if the thing you asked for happened half a second
 * after you asked. What takes time here is only the picture, and the picture is of a hero who is
 * already standing where he was sent.
 *
 * And the column casts no light. A point light appearing and disappearing changes the number of
 * lights the scene's materials were compiled against, and three rebuilds every shader when that
 * happens — a hitch at exactly the moment this is supposed to be smooth. The column is drawn
 * unlit and bright instead, the way the torch flame and the window glows already are.
 *
 * The camera is not held back either, which is worth knowing when reading this: the console snaps
 * the view to the destination the instant the hero moves, so the departure is usually happening
 * somewhere off screen and it is the arrival a player actually sees. Leaving the light standing
 * where he was is still right — a short hop shows both ends in one shot, and it is the same act
 * either way.
 */

/**
 * How long a hero takes to come apart, or to come back together, in seconds.
 *
 * The shortest thing that still reads as an event. This is the move a player makes most often
 * while exploring, so anything approaching a second becomes an irritation by the tenth use and
 * people stop teleporting; much under a fifth of a second and there is nothing to see at all —
 * at sixty frames that is a dozen of them, which is a flicker rather than a departure.
 */
const SCATTER = 0.34;

/**
 * How long the light stands, in seconds.
 *
 * Half again as long as the blocks, so the last thing left is the light going out rather than a
 * column blinking off with the man still half assembled in it. Longer than this and a teleport
 * ends with the player stood inside a pillar waiting for it to clear before they can see where
 * they have arrived.
 */
const LIGHT = 0.52;

/**
 * The share of its life the column spends standing up, before it starts to fade.
 *
 * It grows out of the ground rather than appearing at full height, because "a column of light
 * standing up into the sky" is a thing happening rather than a thing there — and a shaft that is
 * simply present for half a second reads as a rendering fault. A quarter is fast enough that it is
 * up before the blocks have gone anywhere.
 */
const STANDS_UP = 0.25;

/**
 * How far up the column reaches, in tiles.
 *
 * Off the top of the picture at any zoom the game is played at, which is what "into the sky"
 * means: a beam with a visible lid is a box, and the eye finds the lid immediately. Nothing is
 * paid for the height — it is two boxes and no shadow — so it is generous on purpose.
 */
const HEIGHT = 26;

/**
 * Half-width of the pale outer shaft and of the hot core inside it, in tiles.
 *
 * The shaft is wider than the hero with his arms out, so that his blocks come apart inside the
 * light rather than through the side of it — at two thirds of this they flew clear of it, which
 * reads as a man breaking up beside a beam rather than in one. The core is about the width of his
 * body, and is what gives the column a bright middle instead of one flat wash of blue: two nested
 * shapes, the same way the torch flame is a pale cone inside an orange one.
 */
const SHAFT = 0.85;
const CORE = 0.22;

/**
 * Pale sky-blue outside, white-hot inside, and how much light each adds where it stands.
 *
 * Added rather than mixed — both shafts are blended additively, so the column can only ever
 * brighten what is behind it. Drawn the ordinary way it was a shaft of frosted glass: over pale
 * desert sand it came out *darker* than the ground it stood on, which is a strange thing for a
 * light to do, and the hot core was invisible inside the outer one, because averaging two pale
 * colours gives you a third pale colour. Added, the core is the brightest thing on the screen
 * wherever the column happens to be standing.
 */
const SHAFT_COLOUR = 0x9fd8ff;
const CORE_COLOUR = 0xf4fbff;
const SHAFT_OPACITY = 0.17;
const CORE_OPACITY = 0.30;

/**
 * How far the column turns over its life, in radians.
 *
 * A square shaft seen from this camera is two flat faces and nothing else, and two flat faces that
 * hold still for half a second look like a poster of a beam. A slow quarter turn keeps catching a
 * different edge, which is all the movement it needs.
 */
const TURN = 0.5;

/** Columns that can stand at once. Two is one teleport; four is two of them overlapping. */
const AT_ONCE = 4;

/** One shaft of light: where it is, how long it has left, and whoever it is standing over. */
interface Column {
  group: THREE.Group;
  shaft: THREE.Mesh;
  core: THREE.Mesh;
  /** Seconds of light left. Nought means this one is free to be used again. */
  left: number;
  /**
   * The creature it belongs to, so an arrival's light settles with him.
   *
   * A hero put down somewhere new has not found the ground yet — `Player.settle` does that on the
   * next update, and on a mountainside it can be a dozen units of height away. A column planted at
   * the height he was standing at when he left would have its foot buried in the hillside or
   * hanging in the air above it. A departure has nobody to follow and takes null.
   */
  over: Entity | null;
}

export class Beam {
  private readonly columns: Column[] = [];
  private readonly shape = new THREE.BoxGeometry(1, 1, 1);
  /** The copy of the hero left behind to come apart where he was standing. */
  private ghost: Entity | null = null;
  private ghostLeft = 0;
  /** And the hero himself, putting himself back together wherever he arrived. */
  private arriving: Entity | null = null;
  private arrivingLeft = 0;

  /**
   * @param scene where the light stands. The overworld, which is where teleporting is worth
   * looking at; a hero warped about inside a house or a dungeon still comes apart and back
   * together, but the column is in a scene nobody is rendering and goes unseen. Fixing that means
   * moving the group between scenes on every doorway, for an effect nobody has asked for indoors.
   * @param renderer the pool the hero is drawn through, which the departing copy joins for as long
   * as it takes to fly apart.
   * @param carried what the hero is holding — his sword, his torch, the hem of his coat — which is
   * drawn as ordinary meshes rather than through the pool and so knows nothing about any of this.
   * It goes with him: a sword left hanging in the middle of a beam is worse than no effect at all.
   */
  constructor(
    private readonly scene: THREE.Object3D,
    private readonly renderer: EntityRenderer,
    private readonly carried: THREE.Object3D,
  ) {
    for (let i = 0; i < AT_ONCE; i++) {
      const group = new THREE.Group();
      const shaft = this.pillar(SHAFT, SHAFT_COLOUR, SHAFT_OPACITY);
      const core = this.pillar(CORE, CORE_COLOUR, CORE_OPACITY);
      group.add(shaft, core);
      group.visible = false;
      scene.add(group);
      this.columns.push({ group, shaft, core, left: 0, over: null });
    }
  }

  /**
   * One box of light. Unlit, so it is a source rather than a surface, and it writes no depth so
   * that the two nested shafts do not argue with each other about which is in front.
   */
  private pillar(half: number, colour: number, opacity: number): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.shape, material);
    mesh.scale.set(half * 2, HEIGHT, half * 2);
    mesh.position.y = HEIGHT / 2;
    return mesh;
  }

  /**
   * The hero is leaving from here. Call it while he is still standing where he was.
   *
   * What comes apart is a copy of him rather than the man himself, because by the time anybody
   * could watch this the man is already somewhere else. The copy is a real entity in the real
   * pool wearing his colours, so it is drawn by the same code, in the same rig, with the same
   * clothes on — down to the helm that hides his hat.
   */
  leaves(hero: Entity): void {
    this.clearGhost();
    this.stand(hero.x, hero.y, hero.z, null);
    const herd = new Herd(hero.kind, hero.x, hero.z, hero.x, hero.z, 0);
    const ghost = new Entity(hero.kind, hero.x, hero.z, herd, 'beam', mulberry32(1));
    ghost.y = hero.y;
    ghost.yaw = hero.yaw;
    ghost.tints = [...hero.tints];
    // frozen mid-stride rather than snapped to attention: he was walking, and then he was not there
    ghost.walk = hero.walk;
    ghost.phase = hero.phase;
    for (const tag of hero.hiddenTags) ghost.hiddenTags.add(tag);
    // a full pool is no reason to fail a teleport; the light stands and there is simply nobody in it
    if (!this.renderer.add(ghost)) return;
    this.ghost = ghost;
    this.ghostLeft = SCATTER;
  }

  /**
   * And he arrives here, in pieces, and gathers himself.
   *
   * Call it after the move, with the hero already at his destination. He starts fully apart, which
   * means the pool draws nothing of him at all for the first frame — so the effect must be ticked
   * from somewhere the frame cannot return early past, or a hero would be left invisible.
   */
  arrives(hero: Entity): void {
    this.arriving = hero;
    this.arrivingLeft = SCATTER;
    hero.apart = 1;
    this.carried.visible = false;
    this.stand(hero.x, hero.y, hero.z, hero);
  }

  /** Called once a frame, wherever the hero is standing and whatever else the game is doing. */
  update(dt: number): void {
    this.fade(dt);
    this.ageGhost(dt);
    this.ageArrival(dt);
  }

  /** Put a column of light at a place, taking whichever of them is free or the oldest if none is. */
  private stand(x: number, y: number, z: number, over: Entity | null): void {
    const column = this.columns.find((c) => c.left <= 0) ?? this.columns[0];
    column.left = LIGHT;
    column.over = over;
    column.group.position.set(x, y, z);
    column.group.rotation.y = 0;
    column.group.visible = true;
  }

  private fade(dt: number): void {
    for (const column of this.columns) {
      if (column.left <= 0) continue;
      column.left -= dt;
      if (column.left <= 0) {
        column.group.visible = false;
        column.over = null;
        continue;
      }
      const through = 1 - column.left / LIGHT;
      if (column.over) column.group.position.set(column.over.x, column.over.y, column.over.z);
      const grown = Math.min(1, through / STANDS_UP);
      for (const mesh of [column.shaft, column.core]) {
        mesh.scale.y = HEIGHT * grown;
        mesh.position.y = mesh.scale.y / 2;
      }
      column.group.rotation.y = through * TURN;
      // it holds its brightness while it is still rising and fades over what is left, so the shaft
      // is at its strongest at the moment the blocks are actually moving
      const gone = Math.max(0, (through - STANDS_UP) / (1 - STANDS_UP));
      (column.shaft.material as THREE.MeshBasicMaterial).opacity = SHAFT_OPACITY * (1 - gone);
      (column.core.material as THREE.MeshBasicMaterial).opacity = CORE_OPACITY * (1 - gone);
    }
  }

  /**
   * The copy left behind, coming apart. Squared, so it lets go slowly and then whips away: a rig
   * that starts flying at full speed reads as an explosion rather than as a man being taken up.
   */
  private ageGhost(dt: number): void {
    const ghost = this.ghost;
    if (!ghost) return;
    this.ghostLeft -= dt;
    if (this.ghostLeft <= 0) { this.clearGhost(); return; }
    const through = 1 - this.ghostLeft / SCATTER;
    ghost.apart = through * through;
  }

  /** And the hero, coming together: the same curve run backwards, so he lands gently. */
  private ageArrival(dt: number): void {
    const hero = this.arriving;
    if (!hero) return;
    this.arrivingLeft -= dt;
    if (this.arrivingLeft <= 0) { this.settle(); return; }
    const left = this.arrivingLeft / SCATTER;
    hero.apart = left * left;
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    this.renderer.remove(this.ghost);
    this.ghost = null;
  }

  /** Whole again, and holding his own sword. Safe to call when nobody is arriving. */
  private settle(): void {
    if (this.arriving) this.arriving.apart = 0;
    this.arriving = null;
    this.carried.visible = true;
  }

  dispose(): void {
    this.clearGhost();
    this.settle();
    for (const column of this.columns) {
      this.scene.remove(column.group);
      (column.shaft.material as THREE.Material).dispose();
      (column.core.material as THREE.Material).dispose();
    }
    this.shape.dispose();
  }
}

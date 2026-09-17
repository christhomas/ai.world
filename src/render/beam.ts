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
 * This was 0.34, and the note here argued for it: a teleport is the move a player makes most often
 * while exploring, so anything approaching a second becomes an irritation by the tenth use. That
 * reasoning was about the console's `teleport`, which is a tool, and it optimised away the thing
 * itself — Chris, on the effect nobody had ever actually seen:
 *
 * > *it looks cool, but its too fast*
 *
 * Which is the right complaint. A transporter is not a convenience, it is an event: a man comes
 * apart, he is gone for a moment, and he puts himself back together somewhere else. At a third of
 * a second all three of those happen inside one blink and at once, so what was drawn was a flicker.
 *
 * Four seconds either side. Long enough to watch the blocks actually travel, short enough that the
 * whole passage is ten seconds rather than a cutscene. Tools keep the old instant jump — see
 * `jumpTo` in `game/console.ts` — so nothing that teleports a hundred times waits an hour.
 */
export const SCATTER = 4.2;

/**
 * How long he is nowhere, in seconds.
 *
 * The beat between coming apart and coming back. Without it the two halves overlap and it reads as
 * a cut rather than a journey — and this is the moment the picture is *about*, because it is the
 * only part where the man is genuinely not anywhere. The destination's light is already standing
 * through it, which is what says where he has gone.
 */
export const AWAY = 1.6;

/**
 * How long the light goes on standing after the blocks have finished, in seconds.
 *
 * So the last thing left is the light going out rather than a column blinking off with the man
 * still half assembled in it.
 */
const LIGHT_TAIL = 0.6;

/**
 * How long the column takes to stand up, in seconds.
 *
 * It grows out of the ground rather than appearing at full height, because "a column of light
 * standing up into the sky" is a thing happening rather than a thing there — and a shaft that is
 * simply present reads as a rendering fault. A time rather than a share of its life, which is what
 * it used to be: with a column that now stands for five seconds a quarter of its life would be a
 * shaft taking well over a second to grow, and the rise is the snappy part.
 */
const STANDS_UP_IN = 0.55;

/**
 * And how long it takes to go out, in seconds.
 *
 * Also a time rather than a share, and for the mirror of the same reason: fading over everything
 * that is not the rise would leave the column dim for most of a five-second stand, when what is
 * wanted is a light that holds while the blocks are moving and then goes.
 */
const FADES_IN = 0.9;

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

/**
 * How long a whole passage takes, in seconds: apart, nowhere, together.
 *
 * Named rather than left to be added up, because it is the number the thing was asked for in and
 * the one anybody will want to change. Ten seconds.
 */
export const A_PASSAGE = SCATTER + AWAY + SCATTER;

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
   * How long this one was lit for, in seconds.
   *
   * Per column rather than one constant, because the two ends of a passage are not the same
   * length: the departure stands while he comes apart, and the arrival is already standing through
   * the beat where he is nowhere and goes on until he is whole.
   */
  life: number;
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
   * Seconds he still has to spend being nowhere, before he starts gathering himself.
   *
   * This is what makes the passage a sequence rather than two effects at once. He is already *at*
   * the destination by the time this runs — everything that asks where he is gets the answer it
   * will have when it finishes, which is what keeps the rest of the game out of this — but he is
   * held fully apart, so nothing of him is drawn there until the copy at the old place has
   * finished coming apart and the beat has passed.
   */
  private arrivingWait = 0;
  /** What to do at the moment he is no longer at the old place: move the camera, usually. */
  private whenAway: (() => void) | null = null;

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
      this.columns.push({ group, shaft, core, left: 0, life: 1, over: null });
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
    this.stand(hero.x, hero.y, hero.z, null, SCATTER + LIGHT_TAIL);
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
  arrives(hero: Entity, whenAway: (() => void) | null = null): void {
    this.arriving = hero;
    this.arrivingLeft = SCATTER;
    // he waits out whatever is left of his own departure, and then the beat where he is nowhere
    this.arrivingWait = this.ghost ? this.ghostLeft + AWAY : 0;
    this.whenAway = whenAway;
    hero.apart = 1;
    this.carried.visible = false;
    this.stand(hero.x, hero.y, hero.z, hero, this.arrivingWait + SCATTER + LIGHT_TAIL);
    if (this.arrivingWait <= 0) this.away();
  }

  /**
   * The moment the old place stops being where he is.
   *
   * Called once a passage, when the copy has finished coming apart. The camera goes here rather
   * than at the moment he moves, which is what lets a player watch themselves leave: the hero's
   * position changed several seconds ago and the view stayed behind to watch the light.
   */
  private away(): void {
    const told = this.whenAway;
    this.whenAway = null;
    told?.();
  }

  /** Called once a frame, wherever the hero is standing and whatever else the game is doing. */
  update(dt: number): void {
    this.fade(dt);
    this.ageGhost(dt);
    this.ageArrival(dt);
  }

  /** Put a column of light at a place, taking whichever of them is free or the oldest if none is. */
  private stand(x: number, y: number, z: number, over: Entity | null, life: number): void {
    const column = this.columns.find((c) => c.left <= 0) ?? this.columns[0];
    column.left = life;
    column.life = life;
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
      const lived = column.life - column.left;
      if (column.over) column.group.position.set(column.over.x, column.over.y, column.over.z);
      const grown = Math.min(1, lived / STANDS_UP_IN);
      for (const mesh of [column.shaft, column.core]) {
        mesh.scale.y = HEIGHT * grown;
        mesh.position.y = mesh.scale.y / 2;
      }
      column.group.rotation.y = (lived / column.life) * TURN;
      // it holds its brightness while the blocks are moving and goes out at the end, rather than
      // dimming the whole way down — a column that is fading for five seconds is a column nobody
      // believes is lit
      const gone = Math.max(0, 1 - column.left / FADES_IN);
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
    if (this.arrivingWait > 0) {
      this.arrivingWait -= dt;
      hero.apart = 1;                       // nowhere, and nothing of him drawn at either end
      if (this.arrivingWait <= 0) this.away();
      return;
    }
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
    this.arrivingWait = 0;
    // whoever was waiting for the view to follow gets it now rather than never, so a passage cut
    // short by a dispose or a second teleport does not leave the camera behind for good
    this.away();
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

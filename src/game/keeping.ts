import type { Manifest } from '../world/manifest';
import type { SaveStore, SessionSave, WorldKind } from '../save/store';
import { Houses } from './building';
import { Plots } from './farming';
import { Gifts } from './gifts';
import { Grudges } from './grudge';
import { Jail } from './jail';
import { Magic } from './magic';
import { Mines } from './mines';
import { Nemesis } from './nemesis';
import { Rescues } from './rescue';
import { Roaming } from './roaming';
import { Sailing } from './sailing';
import { Standing } from './standing';
import { GameState } from './state';
import { Mount } from './mount';
import type { Structures } from '../world/structures';

/**
 * The save, opened out and packed back up again.
 *
 * Everything the world could not work out for itself from its seed lives in one file, so it is
 * read in one place and written in one place: a save that is assembled from a dozen scattered
 * `toJSON` calls is a save with something missing from it, and the thing missing is always
 * whatever was added last.
 *
 * What is here and what is not is a real distinction. A band's route, a village's names and where
 * the whales are this hour are all derived from the seed and are absent on purpose; what has been
 * done to any of them — a band broken, a person buried, a mine emptied — is not derivable by
 * anybody and so has to travel.
 */
export interface Keeping {
  store: SaveStore;
  /** Which slot on the title screen this world belongs to. */
  slotKey: string;
  seed: number;
  world: WorldKind;
  saved: SessionSave | undefined;
  structures: Structures;
  /** The anchors: where each named place is, and what shape it grew. */
  manifest: Manifest;
  /** Seeded, so the horse a stable sold you is the same horse when you come back for it. */
  rng: () => number;
  /** Where the camera is looking, which nothing else in here can know. */
  cam: () => { x: number; z: number; rot: number; zoom: number };
  /** And where the hero is standing. */
  at: () => { x: number; z: number };
  /** And whether he is up in the clouds, because a save that forgets puts him over open sea. */
  sky: () => string | null;
}

export function openTheSave(ctx: Keeping) {
  const { store, slotKey, seed, world, saved, structures, manifest, rng, cam, at, sky } = ctx;

  const state = GameState.from(saved?.state ?? (saved ? { discovered: saved.discovered, inventory: saved.inventory } : undefined));
  /**
   * Where the hero stands between good and evil. The number lives on the save; this reads it,
   * and writes it back whenever a deed moves it, so there is one place that decides what a
   * killing is worth and one place that remembers.
   */
  const standing = new Standing(state.standing);
  /**
   * Breath, and whatever a spell is currently turning aside. Not saved: it refills in ten seconds,
   * so a save that remembered it would be remembering nothing.
   */
  const magic = new Magic();
  /**
   * The cells in the country's police stations: who is in them, and which of them are heaps of
   * timber. Not saved yet, so a reopened world finds every cell cold and every station standing.
   */
  const jail = Jail.from(saved?.state?.jail ?? null);
  /** Who the hero has been good to, and what each of them has decided about it. */
  const gifts = new Gifts(saved?.state?.gifts);
  /** Which villages somebody agreed to save, and what each of them owes them for it. */
  const rescues = new Rescues(saved?.state?.rescues);
  /**
   * What each village holds against the hero. Kept apart from the good and evil scale because
   * killing a man's cow is that village's business and not the whole country's.
   */
  const grudges = new Grudges(saved?.state?.grudges);
  /** Where Old Nettle is up to: what he is doing, whether he is held, and when he is next abroad. */
  const nemesis = Nemesis.from(seed, saved?.nemesis);
  /**
   * The bands that walk the roads. Danger that stays where you left it stops being danger and
   * becomes scenery, so these move: where one is on a given day is a pure function of the seed,
   * and only the killing has to be remembered.
   */
  const roaming = Roaming.from(seed, structures, saved?.roaming, state.day);
  /**
   * The workings under the caves: where the world's money is minted.
   *
   * An economy that only circulates runs down, so something has to mint, and it is the mines —
   * which is also the answer to why there are tunnels under the ground at all. People dug them,
   * some of them are still down there working, and what they bring up is the gold everybody else
   * spends. Held here beside the bands because it is the same sort of thing: a fact about the
   * world rather than about the hero, true whoever happens to be playing.
   */
  const mines = Mines.from(seed, saved?.state?.mines, state.day);
  const plots = new Plots(saved?.state?.plots);
  /** The builder you are holding, and every house you have had put up. */
  const houses = Houses.from(saved?.state?.houses);
  const sailing = Sailing.from(saved?.state?.boat ?? null);
  const mount = Mount.from(saved?.state?.horse ?? null, rng);

  const persist = (): void => {
    void store.save<SessionSave>(slotKey, {
      seed,
      world,
      cam: cam(),
      player: at(),
      state: { ...state.toJSON(), horse: mount.toJSON(), plots: plots.toJSON(), houses: houses.toJSON(), boat: sailing.toJSON(), gifts: gifts.save(), jail: jail.toJSON(), rescues: rescues.save(), grudges: grudges.save(), mines: mines.save() },
      manifest: manifest.toJSON(),
      nemesis: nemesis.toJSON(),
      roaming: roaming.save(),
      sky: sky(),
    });
  };

  return {
    state, standing, magic, jail, gifts, rescues, grudges, nemesis, roaming, mines,
    plots, houses, sailing, mount, persist,
  };
}

import { ITEMS } from '../items';
import { Picking, RECIPES, brew, canBrew, herbAt, missing, patchOf } from '../brewing';
import type { Surroundings } from './context';

/**
 * What Enter does with damp ground underfoot and a mortar in the pack: a leaf picked, and a heap
 * of leaves ground into something you can drink.
 *
 * Both come late in the chain for the same reason digging does. A mortar is carried everywhere
 * once you own one, and a tool that answers first is a tool that swallows every greeting.
 */
export function herbInteractions(ctx: Surroundings) {
  const { player, state, sampler, dialogue, hud, sound, seed, persist } = ctx;

  /** The patches picked this sitting. Local, because the leaf itself is derivable from the seed. */
  const picking = new Picking();
  /** One buffer for every press: reading a tile keeps nothing. */
  const probe = sampler.newSample();
  /** The day with its fraction, because a plant does not wait for midnight to grow back. */
  const now = (): number => state.day + state.time;

  const tryPick = (preview = false): boolean => {
    const tx = Math.floor(player.x), tz = Math.floor(player.z);
    sampler.sampleTile(tx, tz, probe);
    const leaves = preview && !picking.bare(tx, tz, now())
      ? herbAt(seed, tx, tz, patchOf(probe))
      : picking.pick(seed, tx, tz, patchOf(probe), now());
    if (leaves <= 0) return false;
    if (preview) return true;

    state.give('herb', leaves);
    sound.select();
    hud.flash(`Picked ${leaves > 1 ? `${leaves}× ` : ''}Bitter Herb 🌿`);
    persist();
    return true;
  };

  const tryGrind = (preview = false): boolean => {
    if (!state.can('grind') || state.count('herb') <= 0) return false;
    if (preview) return true;
    dialogue.start({
      speaker: 'Mortar and Pestle', emoji: '🥣',
      pages: ['Leaves, and a stone bowl to ruin them in. What are you making?'],
      choices: [
        ...RECIPES.map((recipe) => {
          const ready = canBrew(recipe, state);
          const short = missing(recipe, state).map((m) => `${m.short}× ${ITEMS[m.id]?.name ?? m.id}`).join(', ');
          return {
            label: `${recipe.emoji} ${recipe.name}${ready ? '' : ` — short ${short}`}`,
            next: () => {
              if (!ready) return { speaker: 'Mortar and Pestle', emoji: '🥣', pages: [`Not without ${short}.`] };
              brew(recipe, state);
              sound.jingle();
              hud.flash(`Ground ${recipe.name} ${recipe.emoji}`);
              persist();
              return null;
            },
          };
        }),
        { label: 'Not now', next: () => null },
      ],
    });
    return true;
  };

  return { tryPick, tryGrind };
}

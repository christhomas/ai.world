import { buy, holds } from '../../world/deeds';
import { CART_ITEM, ITEMS } from '../items';
import { villageTill } from '../tills';
import { cartTalk } from '../woodcraft';
import type { DialogueChoice, Surroundings } from './context';

/**
 * The one thing the builder makes that is not a building.
 *
 * A wright works timber, and a cart is worked timber, so the man a player already goes to about
 * wood is the man who hands one over. The item has promised exactly this since the day it was
 * priced — *"Built by a village wright out of wood you carried in"* — and for a day nothing in the
 * game could deliver it: `cartBuilt` and `woodWanted` were written and tested and called by
 * nobody, `frame.ts` read a speed off a cart no shop stocked, and a player could haul timber for
 * the rest of the world's life without one ever existing. `chore reachable` found it, which is the
 * only thing that could have: every test passed.
 *
 * Its own file rather than more of `builder.ts` because the two are different bargains. A house is
 * a job on the books — a deposit, a site, a crew, a settling-up weeks later — and a cart is a thing
 * on a shelf, offered whether or not he is busy. Keeping them apart also kept `builder.ts` inside
 * the size this codebase holds a module to, which is the pressure working as intended.
 *
 * What the wright *says* is `woodcraft.ts`'s business. This is the three questions the world has
 * to answer before he can say it, and the deed that follows if the player says yes.
 */
export function cartChoice(
  ctx: Surroundings, village: string, wright: string, woodSold: number,
): DialogueChoice {
  const { state, sound, hud, persist } = ctx;
  const price = ITEMS[CART_ITEM].price;
  const cart = cartTalk({ woodSold, owned: state.count(CART_ITEM) > 0, price, purse: state.inventory.gold });
  return {
    label: 'What about a cart?',
    next: () => ({
      speaker: wright, emoji: '🔨',
      pages: [cart.page],
      // a choice is only worth drawing where there is something to decide: a man being told to
      // come back with more wood is being told, not asked
      choices: cart.offer && cart.affordable ? [
        { label: `Take it (${price}g)`, next: () => {
          // the gold goes to the village that built it, exactly like every other job on his books
          buy(holds(state.inventory), villageTill(ctx.register, village), price);
          state.give(CART_ITEM, 1);
          state.version++;
          sound.jingle();
          hud.flash('The cart is yours. Put a horse in the shafts.');
          persist();
          return null;
        } },
        { label: 'Not today', next: () => null },
      ] : undefined,
    }),
  };
}

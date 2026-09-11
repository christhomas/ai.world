/**
 * Being alive, and how much of it is left.
 *
 * The third of the traits this world acts through, after `Holder` for money and `Pack` for things,
 * and it exists for the same reason both of those do: the same mechanics were being written out
 * again in every place that happened to need them. A hero keeps his health in `state.hp` against
 * `maxHpTotal`; a creature keeps its in `entity.hp` against `kind.hp`; a villager's is on the
 * register as how long it is since he ate. Three shapes, one idea, and every reader of any of them
 * had to know which it was looking at.
 *
 * ## The scale
 *
 * One number for everybody, and `FULL` is what a fit grown adult has. A villager is sixty of these,
 * a wolf thirty, a bear a hundred and eighty, Old Nettle four hundred and eighty, and the hero
 * starts at a hundred. That was chosen rather than inherited: the game ran on hearts — the hero had
 * ten of them and a wolf's bite took three — and a scale with ten steps in it cannot express
 * anything. A blow worth a twentieth of a man was not representable, so every blow in the game was
 * worth a tenth of one or more, which is why a wolf could kill the hero in four bites.
 *
 * A hundred is not a percentage and must not become one. A percentage cannot say that one creature
 * is tougher than another — a hero with five hundred and a rabbit with ten are both at a hundred
 * per cent when they are well — and being able to say exactly that is the whole point of having a
 * scale at all. What is drawn on screen is a *share*: `share()` below, which is what a bar wants
 * and is uniform across everything alive whatever its maximum. Number underneath, proportion on
 * top.
 *
 * ## What this does not do
 *
 * Dying. `damageEntity` in `entities/entity.ts` is where a blow lands — knockback, whose fault it
 * was, the bar coming up over the head, the body falling over — and it goes on being where those
 * happen. This is the arithmetic underneath it, and the reason it is worth having apart is that
 * the arithmetic is the part everything shares and the consequences are the part nothing does.
 */

export const HEALTH = {
  /**
   * What a fit grown adult has, and the unit everything else is quoted in.
   *
   * A hundred, and the roundness is the point — it is the number a reader can do arithmetic against
   * without looking anything up. "A wolf's bite is thirty" says what it means immediately, where
   * "a wolf's bite is three" needed you to know that a hero had ten.
   */
  FULL: 100,
  /**
   * The least a blow can come to: a graze that got through.
   *
   * A tenth of a heart in the old money, where the floor was a whole one. It has to be above nought
   * — a blow that lands must do *something*, or armour becomes an off switch rather than a defence
   * — and low enough that the difference between a good hit and a bad one is worth having.
   */
  A_SCRATCH: 10,
  /** What a man with nothing in his hands hits for. */
  BARE_HANDS: 10,
  /** And what each level of practice adds to that, before anything he is carrying. */
  PER_LEVEL: 10,
  /**
   * How hard a thing in the hand has to hit before it counts as being armed.
   *
   * What a villager decides to be frightened of, so it is the difference between a tool and a
   * weapon: a fishing rod and a shovel are below it, a sword is not.
   */
  COUNTS_AS_ARMED: 20,
} as const;

/**
 * Anything alive, as far as being hurt and mending is concerned.
 *
 * Shaped like `Holder`: `hurt` says what it actually took rather than assuming it took what was
 * asked, which is how it reports "there was not that much left of him" without throwing, and is
 * the same courtesy `take` does for a purse.
 */
export interface Living {
  /** What is left. */
  readonly hp: number;
  /** And what there would be if nothing had happened: the most this one has ever had. */
  readonly most: number;
  /** Take health off, and say how much actually came off. */
  hurt(much: number): number;
  /** And put health back, never above the most. */
  mend(much: number): number;
}

/** How much of it is left, nought to one. What a bar draws, uniform across everything alive. */
export function share(of: Living): number {
  return of.most <= 0 ? 0 : Math.max(0, Math.min(1, of.hp / of.most));
}

/** Is this one finished? Asked as a question rather than `hp <= 0` in thirty places. */
export function spent(of: Living): boolean {
  return of.hp <= 0;
}

/**
 * A creature's body: what it has left against what its kind is born with.
 *
 * `kind.hp` is the maximum for everything in the bestiary — a creature that has never been hurt is
 * at it — so there is no second field to keep in step, which is why nothing has ever had to.
 */
export function bodyOf(e: { hp: number; kind: { hp?: number } }): Living {
  const most = e.kind.hp ?? HEALTH.FULL;
  return {
    get hp() { return e.hp; },
    get most() { return most; },
    hurt: (much) => {
      const took = Math.max(0, Math.min(much, e.hp));
      e.hp -= took;
      return took;
    },
    mend: (much) => {
      const room = Math.max(0, most - e.hp);
      const got = Math.max(0, Math.min(much, room));
      e.hp += got;
      return got;
    },
  };
}

/**
 * The hero, whose maximum moves with what he is wearing.
 *
 * The one thing alive in this world whose `most` is not a constant, which is exactly why it is a
 * getter here: a helm taken off between one blow and the next changes what full means, and a copy
 * of the number taken when this was built would be the old full for as long as anybody held it.
 */
export function heroOf(state: { hp: number; readonly maxHpTotal: number }): Living {
  return {
    get hp() { return state.hp; },
    get most() { return state.maxHpTotal; },
    hurt: (much) => {
      const took = Math.max(0, Math.min(much, state.hp));
      state.hp -= took;
      return took;
    },
    mend: (much) => {
      const room = Math.max(0, state.maxHpTotal - state.hp);
      const got = Math.max(0, Math.min(much, room));
      state.hp += got;
      return got;
    },
  };
}

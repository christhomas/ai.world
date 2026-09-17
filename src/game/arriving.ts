/**
 * Walking into a village, as the village sees it.
 *
 * A hero who is not on a register is not a person, and almost everything a player might want to be
 * in this economy is written against people: `livelihoods.ts` pays over register people, a holding's
 * owner is a person, an oath's trade is given to whoever on the roll bears the sworn name, and the
 * errand a villager has for somebody deathless is offered to a row. #260 built all of that and left
 * one wire unconnected — nothing in the game ever called `register.arrive`, so in a played world
 * there was no such row, in any village, ever.
 *
 * This is that wire. The rule it implements is the plainest reading of the thing: **a hero is on the
 * roll of every village he has walked into**. Not the ones he has seen from a hill and named on his
 * map — that is `discover`, and it is a fact about what the player knows rather than about what the
 * village knows — and not only the one he swore an oath at, because he has to be on the roll before
 * the oath has anybody to give a trade to.
 *
 * Being on several rolls costs nothing and is honest. He is not in anybody's dinner queue, he does
 * not age, and he is paid for a trade rather than for standing there — so seventeen villages that
 * have met him is seventeen villages that have met him, and no more than that.
 */

/**
 * How long to leave it before asking again, in milliseconds.
 *
 * Asking is cheap and refusal is normal: a village the world has not settled yet cannot write
 * anybody into a roll it has not made, and the hero standing in one is the very thing that is about
 * to settle it. So this retries rather than giving up, and does it slowly enough that walking about
 * inside a village the world is still growing is a handful of messages rather than one a frame.
 */
export const ASK_AGAIN_AFTER = 5000;

/**
 * Watch where somebody is standing and ask the world to write them in when it is somewhere new.
 *
 * Returns the watcher, which is called with the village the hero is inside on every update that
 * finds him inside one. It stops asking when the roll answers, which is the only signal that the
 * asking worked — the world decides, and a page that assumed its own message was accepted would go
 * quiet on exactly the village where it was not.
 */
export function walkingIn(
  onTheRoll: (village: string) => boolean,
  ask: (village: string) => void,
  now: () => number = () => Date.now(),
): (village: string) => void {
  const asked = new Map<string, number>();
  return (village) => {
    if (village === '') return;
    const last = asked.get(village);
    // the clock before the roll, because this is called every update and a roll is a list to walk
    if (last !== undefined && now() - last < ASK_AGAIN_AFTER) return;
    if (onTheRoll(village)) return;
    asked.set(village, now());
    ask(village);
  };
}

/**
 * The watcher as the game actually builds it: the world's roll, and the hero's own name on it.
 *
 * Structural rather than typed against `Register` and `Online`, because what this needs of either
 * is one method, and a module that imported both to use two lines of them would be a module that
 * could not be tested without standing a world up.
 */
export function walksIn(
  book: { living(village: string): readonly { name: string }[] },
  player: { readonly name: string; arrive(village: string): void },
): (village: string) => void {
  return walkingIn(
    (village) => book.living(village).some((person) => person.name === player.name),
    (village) => player.arrive(village),
  );
}

/**
 * What the hero is wearing, as the hero rather than as a layer over him.
 *
 * Armour used to be drawn as extra boxes hung on the figure: a mail shirt was a grey box a
 * hundredth of a unit wider than the chest it covered, boots were two brown boxes over the boots
 * already there. That is the wrong idea twice over. It is a man in a costume rather than a man in
 * armour — you can see the shirt through the mail wherever the two surfaces meet, and every piece
 * has to be cut to clear the body it hides, which is why half the notes in `herogear.ts` are about
 * a tenth of a unit here or there. And it is the wrong thing to say: iron armour does not mean a
 * man with iron on him, it means a man whose chest is iron.
 *
 * So a worn piece names a part of the hero and the colour that part becomes. His rig is drawn from
 * the shared instanced pool, where a part may take its colour from the wearer's own palette rather
 * than from the shape — which is exactly the mechanism this wants, and was already there for
 * telling one brown cow from another.
 *
 * What stays geometry is what genuinely is: a sword, a shield, a lantern, a torch. Those are things
 * held in a hand, and a hand holding nothing is not a hand painted differently.
 */

/**
 * Which palette entry each part of the hero is painted from.
 *
 * The order is the hero's palette in `properties/people.json`, and the two have to agree — there is
 * no way to say "the trousers" to an instanced draw except by the number of the colour they take.
 */
export const enum Painted {
  Shirt = 0,
  Hair = 1,
  Trousers = 2,
  Boots = 3,
}

/** What a worn piece makes of the hero: the parts it becomes, and what they are made of. */
type Dressing = Partial<Record<Painted, number>>;

/**
 * Just enough of a worn thing to dress somebody in it, and of a slot to ask for one.
 *
 * Deliberately not the game's `Item`: what a piece of armour makes of a body is a fact about
 * drawing, and this file has no business knowing what a thing costs or what it defends against.
 */
interface Wearable { id: string }
type Covered = 'body' | 'head' | 'feet';

/**
 * Every wearable that changes what the hero is made of.
 *
 * A piece may take more than one part — greaves are shin and foot both, because a leg armoured to
 * the ankle over a leather boot is a costume again. Anything not here is either held in a hand or
 * too small to see on a figure this size, and simply leaves him as he was.
 */
const DRESSING: Record<string, Dressing> = {
  // cloth and leather over the chest: the shirt itself is that cloth
  tunic: { [Painted.Shirt]: 0xb8894a },
  jerkin: { [Painted.Shirt]: 0x6b4a2b },
  mail: { [Painted.Shirt]: 0x8f97a2 },
  // and on the head, where the hair is what a hat or a helm takes the place of
  cap: { [Painted.Hair]: 0x8a6a3d },
  helm: { [Painted.Hair]: 0x9aa2ac },
  // boots are feet; greaves are the shin as well, since they are worn over both
  boots: { [Painted.Boots]: 0x5a3f28 },
  greaves: { [Painted.Boots]: 0x9aa2ac, [Painted.Trousers]: 0x9aa2ac },
};

/** Whether a worn piece is something the hero becomes rather than something he carries. */
export function isDressing(item: Wearable): boolean {
  return DRESSING[item.id] !== undefined;
}

/**
 * The hero's colours, given what he has on.
 *
 * Built from the palette he was painted with rather than from whatever he is painted in now, so
 * taking a helm off puts his own hair back rather than leaving him bald in iron.
 */
export function dressed(base: number[], worn: (slot: Covered) => Wearable | null): number[] {
  const tints = [...base];
  for (const slot of ['body', 'head', 'feet'] as Covered[]) {
    const item = worn(slot);
    const dressing = item ? DRESSING[item.id] : undefined;
    if (!dressing) continue;
    for (const [part, colour] of Object.entries(dressing)) tints[Number(part)] = colour;
  }
  return tints;
}

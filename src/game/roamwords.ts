import { compassDir } from '../world/structures';
import { ROAM, type Band, type BandKind, type Steading } from './roaming';

/**
 * How a band is spoken about.
 *
 * The other half of `roaming.ts`, which is about where a band is and what it costs a village. This
 * is what anybody says out loud about one: what it is called by somebody who has seen it, what a
 * villager tells you is happening to their village, which way a troubled place lies, and the single
 * line a player gets when they come over a rise and find the thing in front of them.
 *
 * Apart because they change for different reasons. The arithmetic of a round moves when the world's
 * shape does; these move when somebody reads them and thinks a villager would not say that. And
 * because the file they were in went past the size the architecture test allows the day a dragon
 * was added to it, which is a fair moment to notice that a warning is not a simulation.
 */

/** What a band is called, in the words anybody who had seen it would use. */
export function nameFor(band: Band): string {
  switch (band.kind) {
    case 'wolf': return 'Wolves';
    case 'bear': return 'Bears';
    case 'skeleton': return 'The walking dead';
    case 'ogre': return 'Something very large';
    // what a villager says, which is never the word: nobody who has seen one calls it anything
    case 'dragon': return 'A shadow over the fields';
  }
}

/**
 * One line for somebody who has just come over a rise and found it, which is where this whole
 * design has to become legible or it is merely unfair. Each says what a player can do about it.
 */
export function warningFor(band: Band): string {
  const home = band.circuit[0].name;
  switch (band.kind) {
    case 'wolf':
      return `A wolf pack is working the roads out of ${home}. Kill enough of them and the rest scatter.`;
    case 'bear':
      return `Bears have come down as far as ${home}. There are not many, and every one of them is worth a fight you have thought about.`;
    case 'skeleton':
      return `Something that was buried near ${home} is walking, and it is not walking alone.`;
    case 'ogre':
      return `Something very large has taken the road by ${home}. You can outrun it. You will not outlast it.`;
    case 'dragon':
      // the one warning in this list with no advice in it, because there is none: it flies, it is
      // faster than you, and a sword cannot reach it. What it tells you is to be somewhere else
      return `There is a dragon over ${home}. It flies, it is faster than a horse, and nothing you carry will reach it from the ground.`;
  }
}

/** How somebody who lives in the place would put what is happening to it. */
export function saidOfPress(band: Band, place: Steading, pressure: number): string {
  const what = nameFor(band);
  // "Something very large have been seen" is how you can tell a sentence was assembled rather
  // than written, so the verb follows the subject the way it would out of somebody's mouth
  const many = plural(band.kind);
  const [is, has] = many ? ['are', 'have'] : ['is', 'has'];
  if (pressure >= ROAM.PRESS_SIEGE) return `${what} ${is} on ${place.name}. Nobody is sleeping and nobody is going out.`;
  if (pressure >= ROAM.PRESS_BLED) return `${what} ${has} been at ${place.name} for days. We have buried people over it.`;
  return `${what} ${has} been seen near ${place.name}. The dogs have not settled since.`;
}

/**
 * Which way a troubled place lies, and how far, in the words somebody would use.
 *
 * Deliberately not part of `saidOfPress`. That line is remembered so a village says its news once
 * rather than every morning until it is dealt with, and a distance changes with every step the
 * player takes — baking it in would make the same news new again constantly. So the sentence
 * stays put and this is added when it is spoken.
 *
 * The quest system already solved the same problem in the same words: a direction and a rough
 * number of paces. Null when you are already there, because somebody standing in it does not
 * need telling where it is.
 */
export function wayTo(place: Steading, from: { x: number; z: number }): string | null {
  const dx = place.x - from.x, dz = place.z - from.z;
  const away = Math.hypot(dx, dz);
  if (away < ROAM.NEARLY_THERE) return null;
  return `It lies to the ${compassDir(dx, dz)}, about ${Math.round(away / 10) * 10} paces off.`;
}

/** Whether what a band is called takes a plural verb. Wolves have; something very large has. */
function plural(kind: BandKind): boolean {
  return kind === 'wolf' || kind === 'bear' || kind === 'skeleton';
}

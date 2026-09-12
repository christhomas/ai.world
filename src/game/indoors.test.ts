import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where the hero is, when the hero is indoors.
 *
 * He is nowhere. Coordinates go **room-local** the moment he walks through a door — he stands at
 * about (8, 10) inside every pub, every shop and every hall in the world — and that is correct and
 * has always been correct: a room is its own small world, drawn from its own origin.
 *
 * What it means is that **no question about the country may be asked from inside one**. Asking
 * "which villages are near the hero" indoors returns whatever village happens to stand near the
 * *world's* origin, and it will do it confidently, in every building in the game.
 *
 * That is not a hypothetical. It emptied the game everywhere but one village: the landlord looked
 * for villages near the hero, then discarded every one whose name was not the door's — so he
 * answered only in the village built at (0, 0), and everywhere else a shopkeeper answered instead.
 * With him went the builder and every commission, the boat, the darts, the errand, the rumours and
 * the news from the mine. Two separate walks dead-ended on it before anybody found the cause.
 *
 * A door knows which village it belongs to. Indoors, that is the only thing worth asking.
 */
const SOURCE = readFileSync(new URL('./interact/village.ts', import.meta.url), 'utf8');

/** Every function body in the file, by name, so a rule can be asked about one of them. */
function bodyOf(name: string): string {
  const at = SOURCE.indexOf(`const ${name} = `);
  expect(at, `there is no ${name}`).toBeGreaterThan(-1);
  const next = SOURCE.indexOf('\n  const ', at + 10);
  return SOURCE.slice(at, next < 0 ? SOURCE.length : next);
}

describe('asking about the country from inside a room', () => {
  it('does not ask what is near the hero when he is indoors', () => {
    // the landlord is the one who did, and the one this test exists for
    const landlord = bodyOf('tryLandlord');
    expect(landlord).toContain('places.indoors');
    expect(landlord, 'the landlord is searching the country from inside a room again')
      .not.toContain('villagesHere()');
  });

  it('finds the village whose door it is, by the name the door carries', () => {
    expect(bodyOf('tryLandlord')).toContain('room.door.village');
  });

  it('still asks what is near the hero where he is actually standing outdoors', () => {
    // the board at the square and the market pitches are outdoor things, and the question is right
    // for them: this is not a rule against asking, it is a rule about asking from a room
    for (const outdoors of ['tryBoard', 'tryMarket']) {
      const body = SOURCE.includes(`const ${outdoors} = `) ? bodyOf(outdoors) : '';
      if (body) expect(body).not.toContain('places.indoors');
    }
    expect(SOURCE).toContain('villagesHere()');
  });
});

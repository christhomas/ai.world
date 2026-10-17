import { describe, expect, it } from 'vitest';
import type { Person } from '../world/people';
import type { Register } from '../world/register';
import { doingNear, rosterView } from './roster-view';

const somebody = (over: Partial<Person>): Person => ({
  id: over.name ?? 'x', name: 'Nobody', village: 'Elsewhere', trade: 'farmer', born: 0, lives: 900,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 0, hungry: 0, ...over,
} as Person);
const register = (day: number, folk: Person[]) => ({ today: day, everybody: () => folk }) as unknown as Register;

/**
 * The roster's rows, which the page's roster and an installed app's roster page both show (#575):
 * everybody on the register, in the order asked, with what each column has always said.
 */
describe('the roster, wherever it is read', () => {
  const day = 100;
  const folk = [
    somebody({ name: 'Ada Reed', village: 'Byre', purse: 3, born: 60, mother: 'Mae Reed', father: 'Tam Reed' }),
    somebody({ name: 'Bo', village: 'Alder', purse: 40, hungry: 2, born: 10, lives: 95 }),
    somebody({ name: 'Cass', village: 'Alder', purse: 12, hungry: 5, born: 95, trade: '' }),
    somebody({ name: 'Dell', village: 'Alder', purse: 1, born: 50, trade: '' }),
  ];

  it('reads everybody in the order asked, with the sums the head of the page gives', () => {
    const view = rosterView(register(day, folk), 'purse', 5, new Map());
    expect(view.people.map((p) => p.name)).toEqual(['Bo', 'Cass', 'Ada Reed', 'Dell']);
    expect([view.alive, view.villages, view.purse, view.hungry, view.unvisited]).toEqual([4, 2, 56, 2, 3]);
    expect(rosterView(register(day, folk), 'village', 2, new Map()).people.map((p) => p.name))
      .toEqual(['Bo', 'Cass', 'Dell', 'Ada Reed']);
  });

  it('says each column as the page always has: a stage for no trade, old age, parents by first name', () => {
    const rows = new Map(rosterView(register(day, folk), 'name', 2, new Map([['Bo', 'fishing']])).people.map((p) => [p.name, p]));
    expect(rows.get('Ada Reed')).toMatchObject({ trade: 'farmer', age: 40, old: false, parents: 'Mae & Tam', doing: '' });
    expect(rows.get('Bo'), 'the last fortnight of a life is old age').toMatchObject({ old: true, doing: 'fishing' });
    expect(rows.get('Cass')?.trade, 'a child with no trade is a child').toBe('baby');
    expect(rows.get('Dell')?.trade, 'a grown person without one has a dash').toBe('—');
    expect(rows.get('Dell')?.parents).toBe('—');
  });

  it('says what the people near enough to have a body are doing, and nothing of anybody else', () => {
    const crowd = { within: () => [{ person: 'Bo', doing: 'fishing' }, { person: '', doing: 'grazing' }, { person: 'Cass', doing: '' }] };
    expect([...doingNear(crowd, { x: 0, z: 0 })]).toEqual([['Bo', 'fishing']]);
    expect(doingNear(undefined, { x: 0, z: 0 }).size).toBe(0);
    expect(doingNear(crowd, undefined).size).toBe(0);
  });
});

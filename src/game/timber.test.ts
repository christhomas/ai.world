import { describe, expect, it } from 'vitest';
import { TIMBER, Timber } from './timber';
import { BUILDS, CATALOGUE, Houses, buildable, deposit } from './building';

/**
 * The first material, and the first limit in this economy that is not arithmetic.
 *
 * Every price in this world has been paid in coin, so a builder could in principle put up houses
 * until the gold ran out and a village on a bare rock differed from one with a wood behind it by
 * nothing but the speed its purses filled. These are about the three things that stop being true:
 * that a yard can be empty, that only felling fills it, and that a village with nobody to fell is a
 * village that does not build however rich it gets.
 */

const ASHFORD = 'Ashford';
const house = buildable(BUILDS.HOUSE);

describe('a village yard', () => {
  it('is found with a week of its own loggers behind it, and empty where nobody cuts', () => {
    /*
     * A village that has stood for years has a stack by the sawpit. Opening every yard in the world
     * at nothing would mean no house anywhere could be commissioned until a player had stood about
     * for a week watching a man with a saw, which reads as a bug rather than as a rule — and it
     * would hide the distinction this whole thing is for behind a wait.
     */
    const timber = new Timber();
    timber.felled(ASHFORD, 1);
    expect(timber.at(ASHFORD)).toBe(TIMBER.A_DAY * (TIMBER.STANDING + 1));

    const rock = new Timber();
    rock.felled('Stonedale', 0);
    expect(rock.at('Stonedale'), 'a village with nobody to cut found timber anyway').toBe(0);
  });

  it('goes on filling a day at a time, and stops when there is nowhere to stack it', () => {
    const timber = new Timber();
    timber.felled(ASHFORD, 2);
    const opened = timber.at(ASHFORD);
    timber.felled(ASHFORD, 2);
    expect(timber.at(ASHFORD), 'a second day cut nothing').toBe(opened + 2 * TIMBER.A_DAY);

    // and a quiet century does not leave every village able to build anything instantly, which
    // would be the limit going away again by arithmetic
    for (let day = 0; day < 500; day++) timber.felled(ASHFORD, 2);
    expect(timber.at(ASHFORD)).toBe(TIMBER.HOLDS);
  });

  it('takes all of what a job wants or none of it', () => {
    // half the timber for a house is a house nobody can start, and a yard quietly emptied by a job
    // that was then refused would be a village that lost its wood to a conversation
    const timber = new Timber();
    timber.land(ASHFORD, 10);
    expect(timber.draw(ASHFORD, 40), 'a house was started on ten lengths').toBe(false);
    expect(timber.at(ASHFORD), 'the yard was emptied by a refusal').toBe(10);

    expect(timber.draw(ASHFORD, 10)).toBe(true);
    expect(timber.at(ASHFORD)).toBe(0);
  });

  it('says how short it is, which is what tells a player whether to wait or to go and cut', () => {
    const timber = new Timber();
    timber.land(ASHFORD, 18);
    expect(timber.shortBy(ASHFORD, house.timber)).toBe(house.timber - 18);
    expect(timber.shortBy(ASHFORD, 18), 'short of what it exactly holds').toBe(0);
  });

  it('takes wood from anybody who brings it, not only from the men who cut it', () => {
    /*
     * The half that makes this a chain a player can stand in rather than a wall they wait at. A
     * place with no logger in it never fills its own yard, and somebody who walks in with a saw and
     * a pack full of timber can be the supply — out of an act the game already had.
     */
    const timber = new Timber();
    timber.felled('Stonedale', 0);
    expect(timber.at('Stonedale')).toBe(0);
    for (let log = 0; log < house.timber; log++) timber.land('Stonedale', 1);
    expect(timber.draw('Stonedale', house.timber), 'wood carried in would not build a house').toBe(true);
  });

  it('rides in the save beside the commissions it pays for', () => {
    // a yard is a running total of what was cut and what was built, and the second of those
    // includes what a player chose to have built — which no seed implies and nothing can re-derive
    const houses = new Houses();
    houses.yard.land(ASHFORD, 55);
    const again = Houses.from(JSON.parse(JSON.stringify(houses.toJSON())));
    expect(again.yard.at(ASHFORD)).toBe(55);
  });
});

describe('what a building costs in wood', () => {
  it('gives everything a builder puts up a price that is not money', () => {
    for (const entry of CATALOGUE) {
      expect(entry.timber, `${entry.name} is built out of nothing`).toBeGreaterThan(0);
    }
  });

  it('measures it by the size of the job rather than by its price', () => {
    /*
     * The reason it is its own column. A fountain is stone and costs ninety gold and wants almost
     * nothing; a jetty is cheaper than a house and is nearly all timber. A fraction of the price
     * would have made the fountain a forest and the jetty a splinter.
     */
    const jetty = buildable(BUILDS.JETTY), fountain = buildable(BUILDS.FOUNTAIN);
    expect(jetty.price).toBeLessThan(house.price);
    expect(jetty.timber, 'a jetty is piles and boards and wants less wood than a stone bowl')
      .toBeGreaterThan(fountain.timber * 4);
  });

  it('makes a house a thing that took somebody a week to cut', () => {
    // the sentence the whole feature exists to make true: one logger keeps one crew going, and
    // takes about as long over the timber as the crew takes over the house
    const daysOfCutting = house.timber / TIMBER.A_DAY;
    expect(daysOfCutting).toBeGreaterThan(4);
    expect(daysOfCutting).toBeLessThan(9);
  });

  it('leaves a village that cannot cut unable to build, whatever is in its purse', () => {
    /*
     * The whole of item 50 in one assertion. Gold is fungible and a player who wants a house badly
     * enough will always find four hundred and twenty of it; timber has to have been cut, by
     * somebody, somewhere with trees.
     */
    const houses = new Houses();
    for (let day = 0; day < 100; day++) houses.yard.felled('Stonedale', 0);
    expect(houses.yard.shortBy('Stonedale', house.timber), 'a hundred days made timber out of nothing')
      .toBe(house.timber);
    // and the same hundred days in a village with one man cutting builds several
    for (let day = 0; day < 100; day++) houses.yard.felled(ASHFORD, 1);
    expect(houses.yard.draw(ASHFORD, house.timber)).toBe(true);
    expect(deposit(house.price), 'a deposit is still money, and money is not the limit here')
      .toBeGreaterThan(0);
  });
});

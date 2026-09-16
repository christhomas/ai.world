import { describe, expect, it } from 'vitest';
import { FOOD } from '../world/food';
import { PRICES } from '../world/prices';
import { ITEMS } from './items';
import { askingFor } from './shopprice';
import { Register } from '../world/register';

describe('what a shop asks for food', () => {
  const register = new Register(1);

  it('asks more for bread in a village with an empty cellar than in a full one', () => {
    register.settle('Ashford', 8, ['seller', 'farmer']);
    const people = register.living('Ashford');
    const dear = askingFor(ITEMS.bread, 0, people, 0);
    const cheap = askingFor(ITEMS.bread, cellarFull(people), people, 0);
    expect(dear).toBeGreaterThan(cheap);
  });

  it('leaves a sword alone, because nobody in the world makes one yet', () => {
    const people = register.living('Ashford');
    expect(askingFor(ITEMS.sword, 0, people, 0)).toBe(ITEMS.sword.price);
  });

  it('still adds what the shopkeeper thinks of you', () => {
    const people = register.living('Ashford');
    const plain = askingFor(ITEMS.bread, 0, people, 0);
    const surly = askingFor(ITEMS.bread, 0, people, 0.5);
    expect(surly).toBeGreaterThan(plain);
  });
});

const cellarFull = (people: readonly { id: string }[]): number => people.length * FOOD.KEEPS_DAYS;

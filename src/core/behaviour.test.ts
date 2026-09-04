import { describe, expect, it } from 'vitest';
import {
  Memory, act, always, check, every, fail, forever, latch, not, selector, sequence, steps, succeed, wait, when,
  type Node,
} from './behaviour';

/** A world a test can poke at, so a behaviour has something to decide about. */
interface Scratch {
  log: string[];
  hungry: boolean;
  distance: number;
}

const run = (node: Node<Scratch>, world: Scratch, dt = 0.5, memory = new Memory()) => ({
  status: node({ world, dt, memory }),
  memory,
});

const note = (what: string): Node<Scratch> => act(({ world }) => { world.log.push(what); });

const world = (over: Partial<Scratch> = {}): Scratch => ({ log: [], hungry: false, distance: 10, ...over });

describe('the shape of a decision', () => {
  it('takes the first thing that works', () => {
    const w = world();
    const tree = selector(
      when(({ world: s }) => s.hungry, note('eat')),
      note('wander'),
    );
    run(tree, w);
    expect(w.log).toEqual(['wander']);

    w.hungry = true;
    w.log = [];
    run(tree, w);
    expect(w.log).toEqual(['eat']);
  });

  it('does a sequence in order, and stops where it stops', () => {
    const w = world();
    expect(run(sequence(note('one'), note('two'), note('three')), w).status).toBe('success');
    expect(w.log).toEqual(['one', 'two', 'three']);

    w.log = [];
    expect(run(sequence(note('one'), fail(), note('never')), w).status).toBe('failure');
    expect(w.log).toEqual(['one']);
  });

  it('reports running upward, so a parent waits rather than moving on', () => {
    const w = world();
    const tree = sequence(note('before'), forever(() => {}), note('after'));
    expect(run(tree, w).status).toBe('running');
    expect(w.log).toEqual(['before']);
  });

  it('turns a question around, and swallows a failure when told to', () => {
    const w = world({ hungry: true });
    expect(run(not(check<Scratch>(({ world: s }) => s.hungry)), w).status).toBe('failure');
    expect(run(not(fail<Scratch>()), w).status).toBe('success');
    expect(run(always(fail<Scratch>()), w).status).toBe('success');
    expect(run(always(forever<Scratch>(() => {})), w).status).toBe('running');
    expect(run(succeed<Scratch>(), w).status).toBe('success');
  });
});

describe('decisions that take time', () => {
  it('waits, then goes on, then waits again next time round', () => {
    const w = world();
    const memory = new Memory();
    const tree = sequence(wait<Scratch>(1), note('arrived'));

    expect(run(tree, w, 0.4, memory).status).toBe('running');
    expect(run(tree, w, 0.4, memory).status).toBe('running');
    expect(w.log).toEqual([]);
    expect(run(tree, w, 0.4, memory).status).toBe('success');
    expect(w.log).toEqual(['arrived']);

    // and it forgets, so reaching the branch again waits afresh
    expect(run(tree, w, 0.4, memory).status).toBe('running');
  });

  it('lets something through now and then and refuses in between', () => {
    const w = world();
    const memory = new Memory();
    const tree = every<Scratch>(2, note('now'));

    for (let t = 0; t < 1.5; t += 0.5) expect(run(tree, w, 0.5, memory).status).toBe('failure');
    expect(w.log).toEqual([]);
    expect(run(tree, w, 0.5, memory).status).toBe('success');
    expect(w.log).toEqual(['now']);
    // the gap starts again after it fires
    expect(run(tree, w, 0.5, memory).status).toBe('failure');
  });

  it('sees a started thing through, whatever the world does meanwhile', () => {
    const w = world({ distance: 2 });
    const memory = new Memory();
    // steps() asks "am I close?" once, at the start, rather than on every tick of the run
    const tree = latch(
      steps(check<Scratch>(({ world: s }) => s.distance < 5), wait<Scratch>(1), note('bite')),
      note('circle'),
    );

    expect(run(tree, w, 0.5, memory).status).toBe('running');
    w.distance = 40;                                  // the boat pulls away mid-run
    expect(run(tree, w, 0.5, memory).status).toBe('success');
    expect(w.log).toEqual(['bite']);                  // it finished anyway
    // and now that it is over, the tree reconsiders and does the other thing
    run(tree, w, 0.5, memory);
    expect(w.log).toEqual(['bite', 'circle']);
  });

  it('reconsiders from the top when a plain selector is used instead', () => {
    const w = world({ distance: 2 });
    const memory = new Memory();
    const tree = selector(
      when<Scratch>(({ world: s }) => s.distance < 5, sequence(wait<Scratch>(1), note('bite'))),
      note('circle'),
    );

    expect(run(tree, w, 0.5, memory).status).toBe('running');
    w.distance = 40;
    run(tree, w, 0.5, memory);
    expect(w.log).toEqual(['circle']);                // the run is abandoned, as it should be
  });

  it('keeps each node to its own memory', () => {
    const w = world();
    const memory = new Memory();
    const tree = sequence(wait<Scratch>(1), wait<Scratch>(1), note('both'));

    for (let i = 0; i < 4; i++) run(tree, w, 0.5, memory);
    expect(w.log).toEqual(['both']);        // two waits of one second, not one shared second
  });
});

describe('a remembering sequence', () => {
  it('resumes at the step it was on, rather than asking everything again', () => {
    const w = world();
    const memory = new Memory();
    let asked = 0;
    const tree = steps<Scratch>(
      check(() => { asked++; return true; }),
      wait(1),
      note('done'),
    );

    expect(run(tree, w, 0.5, memory).status).toBe('running');
    expect(run(tree, w, 0.5, memory).status).toBe('success');
    expect(w.log).toEqual(['done']);
    expect(asked).toBe(1);              // asked once at the start, not once a tick

    // a third tick is a fresh pass, and asks again — the memory is of one run, not forever
    run(tree, w, 0.5, memory);
    expect(asked).toBe(2);
  });

  it('starts over once it has finished, and after a failure', () => {
    const w = world();
    const memory = new Memory();
    let asked = 0;
    const tree = steps<Scratch>(check(() => { asked++; return w.hungry; }), note('eat'));

    expect(run(tree, w, 0.5, memory).status).toBe('failure');
    w.hungry = true;
    expect(run(tree, w, 0.5, memory).status).toBe('success');
    expect(asked).toBe(2);
    expect(w.log).toEqual(['eat']);
  });
});

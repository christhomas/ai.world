import { describe, expect, it } from 'vitest';
import { TOPICS, noSuchTopic, topicFor, topicIndex, topicNames } from './topics';

/**
 * The help the game gives when it is asked. It replaced a box of keys that was always on the
 * screen, so the thing worth checking is that asking for something reasonable always lands
 * somewhere: a player who types `? key` and is told "nothing here about key" has been given back
 * the worst of both.
 */

describe('asking the game something', () => {
  it('finds a topic by its name, by its start, and by any part of it', () => {
    expect(topicFor('keys')?.name).toBe('keys');
    expect(topicFor('key')?.name).toBe('keys');
    expect(topicFor('KEYS')?.name).toBe('keys');
    expect(topicFor('fight')?.name).toBe('fighting');
    expect(topicFor('  travel  ')?.name).toBe('travelling');
  });

  it('answers nothing for nothing, so the caller can print the index instead', () => {
    expect(topicFor('')).toBeNull();
    expect(topicFor('   ')).toBeNull();
  });

  it('says what it does have when asked for something it does not', () => {
    const said = noSuchTopic('dragons');
    expect(said[0]).toContain('dragons');
    for (const name of topicNames()) expect(said[1]).toContain(name);
  });

  it('lists every topic when asked for none', () => {
    const index = topicIndex();
    for (const topic of TOPICS) expect(index.join('\n')).toContain(topic.name);
  });

  it('gives every topic something to say and a line about itself', () => {
    for (const topic of TOPICS) {
      expect(topic.lines.length, topic.name).toBeGreaterThan(0);
      expect(topic.about.length, topic.name).toBeGreaterThan(4);
      for (const line of topic.lines) expect(line.length, topic.name).toBeGreaterThan(0);
    }
  });

  it('has no two topics under one name', () => {
    expect(new Set(topicNames()).size).toBe(TOPICS.length);
  });

  /**
   * The key list is the one topic that has to keep pace with the game: it is what the box in the
   * corner used to say, and it is now the only place a player is told which key does what.
   */
  it('still tells somebody how to move, fight and open this box', () => {
    const keys = topicFor('keys');
    const said = keys?.lines.join('\n') ?? '';
    expect(said).toContain('WASD');
    expect(said).toContain('X strikes');
    expect(said).toContain('Enter or Escape drops this console down');
    // Space took over talking when Enter took the console
    expect(said).toContain('Space talks');
  });
});

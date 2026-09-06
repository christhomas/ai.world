import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../server/protocol';

/**
 * A crowd of players, for finding out what a world server actually costs.
 *
 * Phase three moved the creatures onto the server, and the numbers that decided it were measured on
 * a laptop: thirteen kilobytes a second a player, two per cent of a core. The machine that matters
 * is a Raspberry Pi with a media centre already running on it, and the difference between those two
 * is exactly the sort of thing nobody finds until a Saturday evening when four people are playing.
 *
 * So this stands up as many players as you ask for, walks them about a world, and reports what came
 * back: how much, how often, and how much of it was creatures. It is deliberately dumb — it does
 * not draw anything and it does not play the game — because what is being measured is the server.
 *
 *   chore crowd -- ws://aiworld.homelab.local 8 60
 *
 * Read the answer next to `kubectl top pod`, which is the other half of it.
 */

/**
 * How often a player says which way they are pushing, in milliseconds.
 *
 * The real client batches a frame at a time and sends about thirty a second; this sends ten, which
 * is enough to keep a hero walking and keeps the tool's own cost off the measurement. What the
 * server does per steer is the same either way.
 */
const STEER_EVERY = 100;

interface Counted {
  name: string;
  bytes: number;
  messages: number;
  creatures: number;
  creatureBytes: number;
  /** How many times the world said where this player's hero is, which is phase four's traffic. */
  answers: number;
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'ws://localhost:8787';
  const many = Number(process.argv[3] ?? 4);
  const seconds = Number(process.argv[4] ?? 60);
  const seed = Number(process.argv[5] ?? 3);

  console.log(`${many} players into world ${seed} at ${url} for ${seconds}s`);
  const counted: Counted[] = [];
  const sockets: WebSocket[] = [];

  for (let i = 0; i < many; i++) {
    const mine: Counted = { name: `Crowd${i + 1}`, bytes: 0, messages: 0, creatures: 0, creatureBytes: 0, answers: 0 };
    counted.push(mine);
    const socket = new WebSocket(url);
    sockets.push(socket);

    socket.on('message', (raw) => {
      const text = String(raw);
      mine.bytes += text.length;
      mine.messages++;
      // creatures are the thing phase three added, so they are counted apart from everything else
      if (text.startsWith('{"type":"youAre"')) mine.answers++;
      if (text.startsWith('{"type":"creatures"')) {
        mine.creatureBytes += text.length;
        const said = JSON.parse(text) as Extract<ServerMessage, { type: 'creatures' }>;
        mine.creatures += said.near.length;
      }
    });

    await new Promise<void>((open, fail) => {
      socket.on('open', () => open());
      socket.on('error', fail);
    });
    socket.send(JSON.stringify({
      type: 'join', seed, name: mine.name, version: PROTOCOL_VERSION, day: 1, time: 0.4,
    }));

    // spread them round a circle so they are not all standing in one field, which would measure
    // one player's neighbourhood several times rather than several neighbourhoods
    const angle = (i / many) * Math.PI * 2;
    // put them down where they start; after that the server walks them, which is what phase four
    // moved across and what this is now measuring
    socket.send(JSON.stringify({
      type: 'move',
      x: Math.cos(angle) * 120, z: Math.sin(angle) * 120,
      yaw: angle, walk: 1, place: 'surface', riding: 'foot', gear: [],
    }));
    let step = 0;
    let seq = 0;
    let away = 120;
    const walking = setInterval(() => {
      step++;
      // a slow arc rather than a straight line, so they cross ground rather than leaving the world
      const heading = angle + Math.sin(step / 40) * 1.4;
      socket.send(JSON.stringify({
        type: 'steer', seq: ++seq,
        dx: Math.cos(heading), dz: Math.sin(heading), pace: 1, ms: STEER_EVERY,
      }));
      // A ring drawn round the middle of a world lands some of its players in the sea, and the
      // server does not walk anybody who is not standing on anything — so a player it has said
      // nothing to for a couple of seconds is standing in the water, and wades inland to look for
      // some. Without this a third of a crowd stands still and the measurement is a third short.
      if (mine.answers === 0 && step % 20 === 0 && away > 15) {
        away /= 2;
        socket.send(JSON.stringify({
          type: 'move', x: Math.cos(angle) * away, z: Math.sin(angle) * away,
          yaw: angle, walk: 1, place: 'surface', riding: 'foot', gear: [],
        }));
      }
    }, STEER_EVERY);
    socket.on('close', () => clearInterval(walking));
  }

  await new Promise((rest) => setTimeout(rest, seconds * 1000));
  for (const socket of sockets) socket.close();

  const total = counted.reduce((sum, c) => sum + c.bytes, 0);
  const creatures = counted.reduce((sum, c) => sum + c.creatureBytes, 0);
  console.log('');
  for (const c of counted) {
    console.log(`  ${c.name}: ${(c.bytes / seconds / 1024).toFixed(1)} KB/s`
      + `, ${(c.messages / seconds).toFixed(0)} msg/s`
      + `, creatures ${(c.creatureBytes / seconds / 1024).toFixed(1)} KB/s`
      + `, walked ${(c.answers / seconds).toFixed(0)}/s`);
  }
  console.log('');
  console.log(`  everybody: ${(total / seconds / 1024).toFixed(1)} KB/s out of the server`
    + `, of which ${((creatures / Math.max(1, total)) * 100).toFixed(0)}% is creatures`);
  console.log(`  per player: ${(total / seconds / 1024 / many).toFixed(1)} KB/s`);
  process.exit(0);
}

void main();

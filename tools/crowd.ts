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

/** How often a player says where they are, which is what the real game does. */
const MOVE_EVERY = 100;
/** How far each of them wanders from where they started, in tiles. */
const ROAM = 90;

interface Counted {
  name: string;
  bytes: number;
  messages: number;
  creatures: number;
  creatureBytes: number;
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
    const mine: Counted = { name: `Crowd${i + 1}`, bytes: 0, messages: 0, creatures: 0, creatureBytes: 0 };
    counted.push(mine);
    const socket = new WebSocket(url);
    sockets.push(socket);

    socket.on('message', (raw) => {
      const text = String(raw);
      mine.bytes += text.length;
      mine.messages++;
      // creatures are the thing phase three added, so they are counted apart from everything else
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
    let step = 0;
    const walking = setInterval(() => {
      step++;
      const wander = Math.sin(step / 40) * ROAM;
      socket.send(JSON.stringify({
        type: 'move',
        x: Math.cos(angle) * 120 + wander,
        z: Math.sin(angle) * 120 + wander,
        yaw: angle, walk: 1, place: 'surface', riding: 'foot', gear: [],
      }));
    }, MOVE_EVERY);
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
      + `, creatures ${(c.creatureBytes / seconds / 1024).toFixed(1)} KB/s`);
  }
  console.log('');
  console.log(`  everybody: ${(total / seconds / 1024).toFixed(1)} KB/s out of the server`
    + `, of which ${((creatures / Math.max(1, total)) * 100).toFixed(0)}% is creatures`);
  console.log(`  per player: ${(total / seconds / 1024 / many).toFixed(1)} KB/s`);
  process.exit(0);
}

void main();

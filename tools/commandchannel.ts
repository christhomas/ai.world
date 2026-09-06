import type { Plugin, ViteDevServer } from 'vite';

/**
 * The development door for commands.
 *
 * A running browser is otherwise a place you can only reach by typing into it. This opens a way in:
 * post a line of text to the dev server and it goes down the channel Vite already keeps open to
 * every page it is serving, where the game runs it on its own command bus. That is how
 * `chore cmd -- teleport 322 53` moves the hero in a tab nobody is touching, and how a script here
 * can drive a game running over there.
 *
 * It is a Vite plugin, so it exists in development and nowhere else — there is no build flag to get
 * wrong and no route to accidentally ship. The other door, for operating a real world, is on the
 * world server behind a token; the two are deliberately separate because they are not the same act.
 * `docs/server-authority.md` has the shape of both.
 */

/** Where a command is posted, and where the last few answers can be read back. */
const POST_TO = '/__command';

/** How many answers are kept for reading back. Enough to see what just happened, and no history. */
const KEEP = 20;

interface Answered {
  line: string;
  at: number;
  /** What the page said happened, once it has said anything. */
  result?: unknown;
  /**
   * Which world answered: its seed and whether it was grown from roads or from polygons.
   *
   * Every page the server is serving runs the command, and two pages open on two different worlds
   * is the ordinary case while something is being compared. Without this the answers come back
   * indistinguishable, and a teleport that put one hero on a summit and another in the sea reads
   * as one hero somewhere strange.
   */
  seed?: number;
  world?: string;
}

export function commandChannel(): Plugin {
  const answers: Answered[] = [];

  return {
    name: 'ai-world:command-channel',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // The page reports what a command did, so a tool that posted one can find out rather than
      // guess. Answers are matched by the line itself, which is enough for a channel this small.
      server.hot.on('ai-world:command-result', (data: { line: string; result: unknown; seed?: number; world?: string }) => {
        const waiting = answers.find((a) => a.line === data.line && a.result === undefined);
        const answer = waiting ?? { line: data.line, at: Date.now() };
        answer.result = data.result;
        answer.seed = data.seed;
        answer.world = data.world;
        if (!waiting) answers.push(answer);
        while (answers.length > KEEP) answers.shift();
      });

      server.middlewares.use(POST_TO, (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(answers.slice(-KEEP), null, 1));
          return;
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('post a command'); return; }

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const line = body.trim();
          if (!line) { res.statusCode = 400; res.end('nothing to run'); return; }
          answers.push({ line, at: Date.now() });
          while (answers.length > KEEP) answers.shift();
          // to every page this server is serving: several tabs is the ordinary case when a change
          // is being looked at from two places, and both should do as they are told
          server.hot.send({ type: 'custom', event: 'ai-world:command', data: { line } });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ sent: line }));
        });
      });

      server.config.logger.info('  ➜  Commands: post to http://localhost:'
        + `${server.config.server.port ?? 5173}${POST_TO}  (chore cmd -- teleport 322 53)`);
    },
  };
}

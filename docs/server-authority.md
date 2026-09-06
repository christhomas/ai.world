# Moving the game onto the server

Decided 2026-09-06. This is the plan the work follows; it is not a description of what exists yet.

## Where we are

The world is grown from its seed on every client. Terrain, villages, dungeons and creatures are
identical everywhere because the same code ran on the same number, and the wire carries only what
could not be worked out that way: where people are, what they said, the time of day, the market,
the post, and a short list of things players changed.

That is cheap and it is why the game works offline. It also means every client is its own
authority. Two players in one village see two different sets of villagers doing two different
things; a creature killed on one screen is alive on another; anything that depends on what
happened — a quest, an economy, a war — cannot be built without each client guessing at what the
others believe.

## Where we are going

The simulation moves to the server. The browser draws the world and sends input; the server owns
what is true. Every change to the world is a **command**, the server is the only thing that runs
one, and what comes back is what happened.

Single player does not go away and does not fork the code: the server is a module, not a process.
In a browser with nobody else in the world it runs in a Web Worker beside the game and the two
talk over a `MessagePort`; against a real world it runs on the Pi and they talk over a WebSocket.
The simulation never learns which. That constraint is what keeps one implementation honest — if
the sim cannot tell a thread from a network, it cannot quietly grow a dependency on the client.

```
        browser tab                         Pi (or a VPS)
  ┌───────────────────────┐           ┌───────────────────────┐
  │  drawing, input, HUD  │           │      simulation       │
  │          │            │           │  world, villagers,    │
  │      CommandBus       │◄─ ws ────►│  economy, combat      │
  │          │            │           └───────────────────────┘
  │   ┌──────▼───────┐    │
  │   │ Worker: sim  │◄───┘  MessagePort — the same sim, single player
  │   └──────────────┘
```

## What a command is

One named thing that can happen, with its arguments: `teleport 322 53`, `strike 14 3`,
`sow wheat 12 44`, `buy silverholm#2 rope 3`. Commands are the only way the world changes, which
buys three things at once:

- **Coherence.** One authority runs them in one order, so every client is told the same story.
- **A seam to hook.** Anything that can issue a command can drive the game: the player's own input,
  a villager's mind, a quest script, a test, a tool of ours over an operator endpoint.
- **A record.** A world's history is the list of commands that made it, which is a replay, a
  debugging tool, and the honest way to reproduce a bug.

The game issues them to itself. A villager deciding to walk to the well issues `walk`; the market
closing at dusk issues `close`. There is no privileged internal path that skips the bus, because a
path that skips the bus is a path that cannot be observed, replayed or injected into.

## Injection

Two doors, and they are not the same door.

- **Development.** The client opens a command link to the local world server and obeys what comes
  down it. `chore cmd -- teleport 322 53` puts it in the running browser with no ceremony. Stripped
  from production builds.
- **Operating a real world.** `POST /operate` on the server, authenticated with `OPERATOR_TOKEN`
  from the environment. With no token in the environment the route is not registered at all — not
  guarded, not present. `OPERATOR_WATCH_TOKEN` is the same door for anything that should only ask
  questions: it runs the commands marked `reads` and refuses the rest, so a dashboard can be given
  a key that cannot teleport anybody. Both are rate limited, and every command that goes through is
  logged, because there is no other record — the game is on the clients.

## The order of the work

Each phase leaves the game playable. Nothing here is a flag day.

**1. The bus and the vocabulary.** `server/commands.ts` holds the command vocabulary — names,
arity, how one is parsed and printed — and is shared by both halves the way `protocol.ts` already
is. The client gets a bus that runs them locally. The `window.__*` debug hooks become commands, so
the hooks and the tools and the future server all speak one language. Both injection doors are
built here, against the local bus.

**2. The sim, hosted twice.** The authoritative world moves into a module with no Node in it and no
DOM in it: it takes commands and time, and emits what changed. Two hosts are written for it — a
Node one over WebSocket, a Worker one over `MessagePort` — and single player starts using the
Worker. Nothing has moved out of the client yet; the sim starts by owning what the server already
owns today (clock, market, post, deltas) and proves the two hosts are interchangeable.

**3. The world's life moves across.** Villagers, herds, village economy, monsters. This is where
the bandwidth question is settled: the server sends each client what is near it rather than
everything, and sends it at a rate the Pi and a domestic router can carry. Clients keep drawing
smoothly by interpolating between snapshots, which they already do for other players.

**4. The hero moves across.** Movement, collision and combat. The client predicts locally so the
game still feels immediate, and reconciles when the server disagrees. This is last because it is
the part players feel, and everything before it can be tested without risking that.

## What it buys the player's machine

The simulation happens once instead of once per player. Today every client works out what every
villager in the world is doing, and ten people in one village means the same village thought about
ten times on ten machines. Moved across, the Pi thinks about it once and pushes out what happened,
and a phone or an old laptop is left with drawing and input.

Worth being exact about the size of that win, because it was measured rather than assumed: a CDP
sampling profile of the running game showed JavaScript idle about 95% of the time, with the frame
cost sitting in draw calls and fill rate. So this will not make the game run at twice the frame
rate on a good machine — the GPU is the thing under load there, and it stays where it is. What it
does buy is a weak device that no longer has to keep the whole world's mind in its head, a battery
that lasts, and a world that behaves the same for everybody in it. The coherence is the reason;
the offloading is a real benefit that follows from it.

It also concentrates the cost. What was spread thinly over every player's machine now lands on one
Raspberry Pi, which is why sleeping empty worlds and sending each client only what is near it are
part of the plan rather than optimisations to think about afterwards.

## What this costs, stated plainly

- **Latency.** Every act round-trips. Prediction hides it for movement; it cannot hide it for
  anything that needs an answer, so those have to be designed as requests with an outcome rather
  than as instant results.
- **Bandwidth.** Around two hundred creatures stand near a player at once. Sending all of them
  several times a second is not affordable; interest management and rate limits are part of phase
  three, not an optimisation afterwards.
- **The Pi.** Standing up a world costs about a tenth of a second and the map base about a quarter,
  measured. That is fine per world; a dozen busy worlds on one Raspberry Pi is not, and the
  simulation has to be able to sleep a world nobody is in.
- **Offline.** The Worker host is what keeps the game playable with no network at all, so it is not
  a nicety to be added later — it is the thing that stops phase two from breaking single player.

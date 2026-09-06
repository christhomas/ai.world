# The work list

Everything known to be outstanding, in one place. A thing found while doing something else goes on
here rather than into a memory: the list is finished when it is empty, and anything not written down
is not finished, it is forgotten.

Kept in the repository on purpose. A list in a chat window belongs to one conversation; this one
belongs to the project, and the next person to open it can see what was known.

## Server authority — `docs/server-authority.md`

- [x] **Phase 2 — the sim, hosted twice.** *(`server/sim.ts` is the simulation with no socket and no
      filesystem in it; `serve.ts` hosts it on websockets and files, `src/workers/sim.worker.ts`
      hosts the same code in a Web Worker with `localStorage`. The client reaches either through a
      `Link`. Leaving the server address empty plays against the world in the next thread.)*
- [x] Single player should use the Worker world by default. *(Connected at boot; leaving a server
      returns to it. Joining your own world says nothing, because it is not news.)*
- [x] **Phase 3 — the world's life moves across.** *(The simulation grows the world it serves, owns
      the wildlife on it, and tells each player what is within sixty tiles of them three times a
      second — only what changed, which halved it. Measured: 13.7 KB/s a player, 1.8% of a core,
      ~120 creatures over 49 chunks. Villagers stay client-side on purpose: they are the seed and
      the register, which every client already agrees about, and a villager the server owned would
      be one nobody could talk to. Hunting works through a strike message, with the world capping
      what one blow may be worth.)*

### Phase 4, the rest of it — combat

- [x] A swing becomes a `swing` command: how hard, how far, how wide, and nothing about what it hit.
      The world measures the arc itself, against the hero it has been walking and the creatures it
      owns. *(The client used to send a list of numbers to hurt, which is a client choosing its own
      targets. It goes on drawing the blow landing, because a hit that waits for a round trip does
      not feel like one.)*
- [x] The bow: the same message with `one` set, so the world takes the first creature an arrow would
      reach rather than everything in the arc, and counts height towards the distance.
- [x] A spell, which is a swing with a longer arm and its own damage.
- [x] The roster's `strike` message is gone, because a swing carries it.
- [x] **A creature the world owns could not hurt anybody at all.** *(Found while doing the above:
      the client stopped stepping a creature the world owns when phase three moved them across, and
      the server stepped them with no `onAttack` at all — so nothing anywhere decided that a wolf
      had bitten you, and every wild animal in the world had been decorative since. The world now
      reports a bite and the client works out what it cost, which is the same division as
      everywhere else on this wire. `server/wildlife.test.ts` stands a person in front of a wolf.)*
- [x] A creature put down by hand out of doors was swept away on the next step. *(Filed under
      `dungeon`, which the chunk sweep reads as nowhere, and nowhere is never worth keeping.)*

### Phase 4, the rest of it — warps

A hero moves further in one message than a walk could, and the server takes it: that is how a
teleport, a staircase and a gangplank all work today, and it is also what a client would send to
walk through a wall. Each one wants a reason the server already knows about.

- [x] A jump is now told rather than guessed at: `stood`, with the reason — a teleport, a
      staircase, a gangplank, a saddle — and the world moves its own hero to match and answers with
      where that leaves him. *(The answer carries the sequence number the world has already run, so
      the steers still in flight when somebody teleports are thrown away rather than walked on top
      of the new position.)*
- [x] Stairs, doors, boats and horses: the client says so the moment the place or the ride changes,
      which is the one thing it knows and the world cannot — it has never grown a cellar and does
      not know where a boat is.
- [x] `WARP_STEP` is gone. A `move` from a hero the world is walking says nothing about where he is
      standing, which is what owning him means; everywhere else it says everything, which is what
      not owning him means.
- [ ] `stood` is still taken on trust — it has to be, while the places it is about are the client's.
      What closes it is the places themselves moving across, which is the dungeon-floor work below
      and the same again for interiors. Until then the trust has a name and a place in the log
      rather than being inferred from how far somebody moved.

### Monsters on a dungeon floor

Owned by whichever player is standing on the floor, which is the older co-op arrangement: the owner
leaves and the monsters change their minds. Wildlife on the surface has already been through this,
so the shape is known and the pieces are the same ones.

- [x] Grow a dungeon floor on the server. *(The generator has no DOM in it, and the seed is derived
      rather than sent: the same root seed and the same anchor name give the same rooms on every
      machine, so two people who name the same floor are standing in the same one by arithmetic
      rather than by agreement.)*
- [x] A floor owner in the simulation. *(`Wildlife` now takes any ground and any chunk source, so
      the same class owns a hillside and a cellar; a floor has no chunks streaming into it, so what
      lives there is put there once when the floor is stood up.)*
- [x] Send the floor's monsters to everybody on it, keyed by place. *(`creatures`, `killed` and
      `bitten` all carry the place they are about, because a number means nothing outside the world
      that issued it — a snapshot for somewhere you are not is dropped rather than drawn.)*
- [x] Blows go through `swing` against a floor, from where the world last saw somebody go rather
      than from where the message says they are.
- [x] Let go of a floor nobody is on. *(Grown when the first person walks down into it, dropped when
      the last one climbs out: the rooms are the same every time they are grown, and what was in
      them is not worth remembering.)*
- [x] **A dungeon floor had no monsters on it at all.** *(Found by standing in one: the manager
      forgets the country behind the hero by dropping the chunks he has walked away from, and a
      floor's monsters are filed under `dungeon`, which read as a chunk at nowhere — and nowhere is
      never near enough to keep. So every monster was dropped on the first step taken on the floor.
      Invisible from outside: the rooms, doors, chests and torches are all there, and the place is
      empty. `src/entities/floors.test.ts`.)*
- [ ] `src/game/coop.ts` and the `monsters` and `hit` messages are what the floors used to run on,
      and nothing sends them now. Deleting them takes a test with it, so it wants a yes first.

### Village economy

- [ ] Audit what in the economy is not already derived from the register or held by the market, and
      write down what is left. The belief is that it agrees on every client already — prices come
      from the register and stalls are the server's — so this may close with a note rather than
      with code, and if it does not, the list wants the exceptions rather than the worry.
- [~] **Phase 4 — the hero.** *(Walking and collision are across. What crosses the wire is a
      `steer` — which way somebody pushed and for how long — and the server walks the hero itself
      against the ground it grew, then says where he got to. Both halves walk with the same
      `src/entities/stride.ts` over the same terrain, so the client's guess and the world's answer
      are the same arithmetic: measured over a walk in seed 3, thirty-six answers and not one
      correction. Six players walked at once cost 20.9 KB/s each and 2–12% of a core, against 21.9
      KB/s for phase three alone. A hero standing on nothing the server has grown — at sea, indoors,
      underground, on a horse or in a boat — is still the client's own, and the client takes back
      authority by itself whenever the server has no ground under him.)*
## Mountains

- [x] Rivers no longer run off mountains. Hydrology takes its downhill from the massif uplift,
      which is zero in a polygon world. *(Median source-to-peak distance: 70 tiles → 40.)*
- [x] The walled-in village — a ring of high country round a flat floor, reached only by the roads
      it already had — is gone. *(Rebuilt as ring geometry with gates where roads cross; the dead
      branch of `planMassifs` is deleted.)*
- [x] Mountains are missing from the map and the minimap: they are no longer terrain, and nothing
      draws them there. *(The map base shades rock grey to white by height.)*
- [x] Creatures still spawn on and under the rock. Only props are suppressed. *(Herds are placed on
      open ground, and nothing that cannot climb walks onto a flank. Eagles still fly over it,
      which is what eagles are for.)*
- [x] The rock reads flat: one colour ramp, little variation between facets. *(Bedding and facing
      painted into the colour, wider low-to-high ramp, and snow that only lies where it can.)*
- [x] One peak per mesh face, so a range is a couple of overlapping cones rather than a chain of
      peaks with valleys between them. *(A face carries up to three summits by area, the later ones
      shorter; seed 3 went from four peaks to six.)*

## The world's surface

- [x] The sea was one repeating texture: the same wave everywhere, crossing a beach without
      noticing it. *(`src/render/coastfield.ts` measures how far every point of water is from land
      and hands the shader a small picture of it; waves are contours of that field, so a swell
      refracts round to arrive parallel to whatever coast is there, bunches and stands up as it
      shallows, and breaks white at the water's edge. The wave field drives the surface normal, so
      the light on it is the game's own sun. 0.3 ms a sweep, a few sweeps a second.)*
- [x] Roads between towns stood on causeways with a ten-unit drop either side. *(The rivers were
      carved before the high country was raised over them, so a river in the hills still ran at its
      old level and dragged the ground beside it back down — but not the road. The country is now
      cut down into the valley at the same slope the valley sides climb, so road and fields come
      down together. Worst step beside a road: 21 terraces → 7.)*
- [~] The roads are too uniform: every one the same width, the same flat colour, the same straight
      run between two nodes. A trunk road between towns and a lane to a farm should not look alike.
      *(Surface done: a road wide enough to have a middle is drawn as made surface, one that is all
      edge as worn earth, with per-tile wear over both and a scuffed verge where the fields meet
      them. Width is not: widening the spread from 1.8–3.4 tiles to 1.8–5.4 moves every village a
      little, and the roaming bands are planned off where the villages are — seed 1 went to ten
      bands over one neighbourhood against a design figure of eight, and left one village unvisited
      over a whole season. So the width and the shape of the web want doing together with the band
      plan re-tuned, and that is a day's work rather than a constant.)*
- [ ] Ground beside a road can still stand seven terraces above it over six tiles, which is a
      cutting rather than a verge. Worst offenders are near the world edge. *(`td` in `sampleTile`
      is not clamped, so the rise away from a road goes on growing past the land width it was meant
      to be measured against.)*

### Roads, the rest of it

The surface is done. What is left is that every road is the same size and runs dead straight, and
the two are separate jobs with a third in between them.

- [ ] Widen the road width spread — a track at a yard and a half, a trunk road at five tiles — and
      re-tune the roaming band plan beside it. The measurement to beat: seed 1 came out at ten bands
      over one neighbourhood against a design figure of eight, and left one village unvisited over a
      season.
- [ ] Update the golden fingerprint and say in it what moved and why, because this one moves the
      ground rather than its colours and so moves every saved world's layout.
- [ ] Make a road wander: a low-frequency offset on the centreline so it is not a ruled line between
      two nodes. Everything that reads `roadDist` — villages, props, spawning, the map — has to read
      the same wander, so this is one function and every caller of it.
- [ ] Surfaces that belong to their country: cobbles where a road runs through a village, sand
      drifting over it in the desert, snow lying on it in the north.

## Deployment

- [x] Push the work, bump the chart to 0.2.0 and cut the release that gives it an image. *(Took
      three goes: the config's import of the dev command channel, then the Dockerfile copy, then
      `.dockerignore`. Image 0.2.0 is published for amd64 and arm64.)*
- [x] Flux on chrispi. *(Done by the homelab-server session: v0.2.0 running, Helm revision v4,
      arm64 pulled from the manifest list, answering on http://aiworld.homelab.local. Note for
      anyone writing `ignore` rules: `/*` then `!/deploy` does not re-include the directory's
      contents — it needs `!/deploy/**` too, and the error names the Kustomization's path rather
      than the fetch that omitted it.)*
- [x] An optional `envFromSecret` in the chart, so the operator tokens can be given to the server
      without a password travelling through chart values into Flux's storage. Chart 0.2.1.

## Releasing

- [x] A release is one act: chart version, game version, tag and image all naming the same moment.
      *(`chore release`, and `docs/releasing.md`.)*
- [x] v0.2.1 was tagged and published with no image behind it. *(0.3.0 cut with the new tooling and
      published for both architectures; the dead tag and its release are deleted, because a version
      somebody could roll back to and never start is worse than no version at all.)*

- [ ] Nothing since 0.3.0 is released: the sea, the roads off their causeways, the road surfaces
      and the server-walked hero are all on `main` and not in the cluster. One `chore release minor`
      when the world geometry has settled enough to be worth a version.

## Smaller

- [x] The page asks for `/favicon.ico` on every load and gets a 404. *(`public/favicon.svg`: sea, a
      shore, and a mountain, in the game's own colours.)*

- [x] `server/proxy.test.ts` is flaky under full-suite load. *(It was a race, not a deadline: the
      test joined through the proxy in the same breath as the direct player. It waits for the
      server to say she is in.)*
- [x] `server/serve.test.ts` fails about one run in ten under full-suite load. *(A real deadline
      rather than a race: every message it waits for is sent as soon as the one before it is read,
      so a second was enough on an idle laptop and not on one running a hundred workers and a
      socket. Four seconds, and it still returns the moment the message arrives.)*
- [ ] `/time 0.5` answers "day 1, time 0.5" and the clock in the corner stays at 08:13. Seen once,
      from a headless console; find out whether the command sets a time nothing reads, or whether the
      day cycle eases to it too slowly to see in three seconds.
- [ ] The server answers every steer with a `youAre`, which is about 0.7 KB/s a player down. Cheap
      enough to leave alone, and the knob to turn if the Pi ever complains: answer at the presence
      tick instead, since the client predicts either way.
- [ ] The coast field is measured only where chunks are loaded, so water past the streamed ground
      has open-sea waves and no shore. Invisible at the zoom the game plays at, and worth writing
      down before somebody widens the view and wonders.

- [x] The operator door has no safety story. *(`OPERATOR_WATCH_TOKEN` may only run the commands
      marked `reads`; both tokens are rate limited, and every command through the door is logged.)*

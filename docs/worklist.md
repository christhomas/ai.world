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
- [ ] Village economy and monsters are still each client's own. The economy is derived from the
      register, so it agrees already; the monsters on a dungeon floor are owned by whichever player
      is on it, which is the older co-op arrangement and not yet the server's.
- [~] **Phase 4 — the hero.** *(Walking and collision are across. What crosses the wire is a
      `steer` — which way somebody pushed and for how long — and the server walks the hero itself
      against the ground it grew, then says where he got to. Both halves walk with the same
      `src/entities/stride.ts` over the same terrain, so the client's guess and the world's answer
      are the same arithmetic: measured over a walk in seed 3, thirty-six answers and not one
      correction. Six players walked at once cost 20.9 KB/s each and 2–12% of a core, against 21.9
      KB/s for phase three alone. A hero standing on nothing the server has grown — at sea, indoors,
      underground, on a horse or in a boat — is still the client's own, and the client takes back
      authority by itself whenever the server has no ground under him.)*
- [ ] Combat is still the client's: a swing is resolved where it is drawn, and the server is told
      about it afterwards through `strike`.
- [ ] A warp is taken on trust. Teleports, staircases, ferries and boats move the hero further in
      one message than a walk could, so the server reads a long jump as a warp and accepts it —
      which is also what a client would send to walk through a wall. It wants a reason: a command
      the server ran, or a place it knows the hero was standing in.

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
      cutting rather than a verge. Worst offenders are near the world edge.

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

## Smaller

- [x] The page asks for `/favicon.ico` on every load and gets a 404. *(`public/favicon.svg`: sea, a
      shore, and a mountain, in the game's own colours.)*

- [x] `server/proxy.test.ts` is flaky under full-suite load. *(It was a race, not a deadline: the
      test joined through the proxy in the same breath as the direct player. It waits for the
      server to say she is in.)*
- [x] The operator door has no safety story. *(`OPERATOR_WATCH_TOKEN` may only run the commands
      marked `reads`; both tokens are rate limited, and every command through the door is logged.)*

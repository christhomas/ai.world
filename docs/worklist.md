# The work list

Everything known to be outstanding, in one place. A thing found while doing something else goes on
here rather than into a memory: the list is finished when it is empty, and anything not written down
is not finished, it is forgotten.

Kept in the repository on purpose. A list in a chat window belongs to one conversation; this one
belongs to the project, and the next person to open it can see what was known.

## Server authority — `docs/server-authority.md`

- [ ] **Phase 2 — the sim, hosted twice.** The authoritative world as a module with no Node and no
      DOM in it. A Node host over WebSocket, a Worker host over `MessagePort`, single player moved
      onto the Worker. Start with what the server already owns: clock, market, post, deltas.
- [ ] **Phase 3 — the world's life moves across.** Villagers, herds, village economy, monsters.
      Interest management is part of this, not an optimisation afterwards: about two hundred
      creatures stand near a player and they cannot all go over the wire several times a second.
- [ ] **Phase 4 — the hero.** Movement, collision, combat, with prediction on the client and
      reconciliation when the server disagrees. Last, because it is the part players feel.

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
- [ ] The rock reads flat: one colour ramp, little variation between facets.
- [ ] One peak per mesh face, so a range is a couple of overlapping cones rather than a chain of
      peaks with valleys between them.

## Deployment

- [x] Push the work, bump the chart to 0.2.0 and cut the release that gives it an image. *(Took
      three goes: the config's import of the dev command channel, then the Dockerfile copy, then
      `.dockerignore`. Image 0.2.0 is published for amd64 and arm64.)*
- [ ] Flux on chrispi: `GitRepository` + `Kustomization` pointing at `deploy/flux`, and the
      `ai-world-cluster-values` ConfigMap with the hostname. Owned by the homelab-server session;
      unverifiable from here while kubectl fails with the Go-dialer bug.

## Smaller

- [ ] `server/proxy.test.ts` is flaky under full-suite load — one-second deadlines lose a race when
      a hundred other files are running.
- [ ] The operator door has no safety story: anything the client will run, an operator can send.
      The vocabulary already marks which commands only read; nothing uses that yet.

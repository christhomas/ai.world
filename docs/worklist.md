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
- [x] `stood` is no longer taken on trust wholesale. *(Split into the three things it was carrying.
      A **door** — a staircase, a doorway — leaves the hero standing where he was, because the world
      has no business following anybody into a cellar it has never grown, and it remembers the door:
      a hero who reappears more than a few paces from the one he went in by is put back at it, since
      a door lets you out where it let you in. A **teleport** is a console act and is refused where
      there is anybody else in the world to wind about, exactly as the clock is. A **ride** is taken
      as it comes, and is now the last thing on this wire that is — the world has never been told
      where a boat is.)*
- [x] **A hero on a horse outran the world and was hauled back for it.** *(Found while looking at
      what a ride still trusts. A horse does not carry the hero — he walks, and the horse follows
      underneath — so a mounted hero was already being walked by the world; but the mount was a
      multiplier applied beside the steer rather than in it, and the world has never seen anybody's
      stable. A courser on a road went two and a half times faster on the client than in the world,
      and every answer dragged him back. The pace on the wire is now one number, the gait and
      whatever is carrying him together, and the ceiling is the fastest thing in the game rather
      than a walk. `src/entities/stride.test.ts` pins what a steer may and may not buy.)*
- [x] A boat is the world's now. *(`helm` is a steer for somebody who is not walking — along the
      bow and round it — and the world moves its own boat with the same `helm()` the client does,
      against its own water. Where a boat is *moored* is still the client's word, because nothing
      has ever told the world that; from the moment somebody boards, the boat is the world's, and
      stepping off happens beside it — a gangplank is a stride long, and somebody who leaves a boat
      half a county from where the world has it is put back on it. Measured over a sail out of
      Elderton: seventy-three answers, one correction, five centimetres.)*
- [x] **A ferry crossing would have dragged the hero back over the strait.** *(A ferry runs to a
      timetable — its position is a pure function of the world's clock, so every client already
      agrees about it without being told — and it carries the hero across without a single step
      being walked. So no steer was sent, the world's hero stayed on the pier he sailed from, and
      the first step taken on the far shore was answered with a position back across the water. The
      landing is now told, the way boarding a boat is.)*
- [x] And now checked rather than told. *(Three ways to get on or off something, and the world can
      check all three: a saddle, where you mount and dismount where you are standing and the world
      knows where that is; a boat, beside the boat it has been sailing; a ferry, at a pier — because
      a pier is the only thing in the world that reaches out over the water, so a ferry lands at one
      or it lands nowhere. Anything else leaves the hero where the world had him. That is the last
      of the trust in `stood`.)*

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
- [x] The old co-op path is gone: `src/game/coop.ts` and its test, the `monsters` and `hit`
      messages both ways, `MonsterSnap`, `ownerOfPlace`, the server's relay of them and the socket
      test that covered it. *(Nothing had sent any of it since the world took the floors. What it
      was for — one player simulating a floor for everybody standing on it, with the lowest player
      id winning the job — is worth remembering as the arrangement that came before a server.)*

### Village economy

- [x] Audited. Most of it does agree on every client already, and by two different means: the
      register is *derived* — who lives in a village, what they earn, what a village is worth and
      therefore what things cost are all grown from the seed and lived forward, with the facts that
      cannot be derived travelling as deltas (`died`, `cleared`, `told`, `found`, `sow`, `reap`,
      `chest`, `key`) — and the market and the post are *held*, by the server, which is the other
      way to agree. What came out of it is one exception, below.
- [x] **A house a player builds was never told to anybody.** *(It went into that player's own save
      and nowhere else: their village grew a house and on every other screen the plot stayed empty
      grass. A `built` delta now carries where it stands, which way it faces and the day work
      began — the stage it has reached is worked out from the day, so it is the same building at
      the same stage on every screen — and `Houses.adopt` takes one on without anybody owing a
      village for somebody else's house.)*
- [x] **Phase 4 — the hero.** *(Walking, collision, blows and jumps are all across.
      Walking and collision: What crosses the wire is a
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
- [x] The roads are too uniform: every one the same width, the same flat colour, the same straight
      run between two nodes. *(Two of the three are done — the surface tells a made road from a worn
      track, and the line wanders. The width stays uniform, and the item below says why.)*
      *(Surface done: a road wide enough to have a middle is drawn as made surface, one that is all
      edge as worn earth, with per-tile wear over both and a scuffed verge where the fields meet
      them. Width is not: widening the spread from 1.8–3.4 tiles to 1.8–5.4 moves every village a
      little, and the roaming bands are planned off where the villages are — seed 1 went to ten
      bands over one neighbourhood against a design figure of eight, and left one village unvisited
      over a whole season. So the width and the shape of the web want doing together with the band
      plan re-tuned, and that is a day's work rather than a constant.)*
- [x] Ground beside a road standing seven terraces above it: measured properly, and mostly not what
      it looked like. *(The worst of them near the world edge were cliff coasts — a road along the
      top of one with the sea at nought six tiles away — and the scan was counting the drowned end
      of a road as a road tile. What was real was the other way up: a lake left standing eight units
      above the fields around it, on a pedestal made of its own bank, by the rule that took the
      roads off their causeways. Water sits in its own country now.)*

### Roads, the rest of it

The surface is done. What is left is that every road is the same size and runs dead straight, and
the two are separate jobs with a third in between them.

- [no] Widen the road width spread. **Tried, measured, and put down.** A road's surface half-width
      is not only what is drawn: rivers are routed around it, houses are set back from it and errands
      are written about what it passes, so widening it moves every one of those. The fingerprint says
      so plainly — `graph`, `hydro`, `structures`, `chunks` and `quests` all move, which is every
      saved world in the world relaid.
      What it costs is not the relaying, it is that the world comes out worse: with villages packed
      closer, the roaming bands crowd. Measured over seeds 1, 2, 5 and 12, bands over one
      neighbourhood inside a healing window went from 6/6/6/7 to 5/10/1/11 against a design figure of
      eight. Dealing each band's circuit at a stride through what lies near home, rather than
      shuffling it, recovers some of that (5/9/1/10) and is not enough. The width wants the roaming
      design revisited, not a constant, and the surface work already tells a lane from a highway.
      Tried again after the lopsided deck was fixed and the roads began to wander, which took most
      of the objection away: a spread to 5.4 tiles now gives 8/8/2/7 against a design figure of
      eight, all inside it. It still fails, and on a different clause — a world holds 22 bands
      against a busy county's 8, and the test wants three times rather than two and three quarters.
      Backing off to 4.4 tiles makes it *worse* (9/4/8/8), which is the tell: the crowding is
      sensitive to exactly where each village lands, so a width is being chosen by which seeds
      happen to come out well. That is tuning by coincidence, and it is why this stays down.
- [x] **Seed 12 had three villages no band ever reached over a season**, and so did seed 33.
      *(A band takes the next ground off a shuffled deck of every stop in the world — villages and
      landmarks together — and there are more stops than bands, so a village at the bottom of the
      deck got no home; one that was also outside everybody's circuit was never worked by anything
      at all. Villages are dealt before landmarks now, and there are more bands than villages, so
      every village is somebody's ground. Across seeds 1, 2, 5, 12 and 33: villages nothing ever
      comes to, three and three, now none anywhere. The test asked one seed and passed for years.)*
- [x] **The roads wander.** *(Third time, and the answer was the one written down here after the
      second: a road keeps two distances. The line it was **surveyed** along, which the rivers that
      avoid a road and the villages that sit on one are laid out against — bending that is what ran
      a river across Thorncross's square — and the line it is **drawn** with, which leans off the
      first by a tile or two. `src/world/wander.ts`. The lean is read at the point rather than along
      the road, so two roads meeting at a junction are pushed the same way and the junction holds;
      and every node carries how free it is, fading to nothing near water, where a bent road drowns,
      and near anywhere a village could stand, where it would run through a parlour. That last is
      asked of the graph rather than of the villages, because the terrain needs the answer before
      the villages exist. Costs nothing: a chunk still builds in a millisecond and a world stands up
      in 141 ms. `graph` and `hydro` do not move at all, which is the whole point; the landmarks are
      placed against the drawn road and moved with it.)*

## On a phone

- [x] A phone is held sideways to play this. *(`src/ui/sideways.ts`: the lock is asked for where a
      browser will give it, and where it will not — which is iOS, at any price — an upright phone is
      covered by a card asking to be turned, and uncovered the moment it is.)*
- [x] Detect a phone rather than a touch screen. *(The screen's own two sides and whether the
      pointer is a finger: a tablet on its end is a fine way to read a map, and a laptop with a
      touchscreen is not a phone. Which way up it is being held comes from the *window* instead,
      because on iOS `screen.width` is the width of the phone standing up whichever way it is
      turned — read that for the orientation and the game asks somebody to turn a phone they have
      already turned.)*
- [~] The HUD on a phone. *(The panel buttons hung a hundred and eighty pixels down the right-hand
      side, which on a landscape phone is the middle of the picture, wrapped into two rows because
      eight of them do not fit across two thirds of the glass. They are one row across the strip
      under the compass now — the pack panel ends to its left, the corner map begins to its right,
      and both thumbs are at the bottom — with the toast and the duel bar moved below them. What is
      left is the part that wants a real thumb on real glass rather than an emulator.)*

## Found while playing it on a phone

Things Chris hit on a real phone, in the order he hit them.

- [x] The title screen — the slots you pick a world from — was unusable on a phone. *(Laid out for a
      desktop: three slots stacked down a tall page, the switches pinned to the bottom-right corner,
      the lot centred in a box that does not scroll. On a screen 342 pixels tall that put the game's
      name above the top edge, slot three below the bottom one and the switches over slot two, with
      no way to reach any of it. On a short window it now scrolls from the top, the slots go side by
      side — three columns is the shape of a landscape phone — and the switches come out of the
      corner into the flow.)*
- [x] On a phone in landscape, take the whole glass. *(Asked for from the tap that enters a world,
      because that is the one moment a browser will give a page the screen — and because that tap is
      when the page stops being a page and becomes a game. Fullscreen first and the orientation lock
      second, in that order, since Chrome on Android will only hold an orientation for a page that
      is already fullscreen. Checked on an emulated phone and a desktop: the phone asks for both,
      the desktop asks for neither. iOS gives neither at any price and keeps the turn-your-phone
      card as its fallback, which works everywhere.)*
- [x] The message log read badly and ate the screen. *(One grey slab with every line the same
      weight and the system lines dimmer and italic — so a warning was the least readable thing on
      the screen. It has no box now: each line carries its own darkness, only as wide as its own
      words, with a coloured rule down the left saying who is speaking — purple for a person, gold
      for the world — and older lines stepping back in opacity. On a phone it shows two lines and
      takes 360 by 62 pixels against the old 734 by 120, which was 29% of the screen and had its top
      eighteen pixels drawn off the top edge.)*
- [x] The touch controls were the ugliest thing in the game. *(One visual language now — dark glass
      discs with a hairline rim, defined once as variables rather than per button. The action cluster
      orbits the big button at one reach, so the only number left per button is an angle, and the big
      one says `USE` rather than naming a key on a keyboard nobody is holding. The panel row became a
      single rail that shares its centre with the banner above it instead of seven hand-placed
      squares wrapping onto two rows. Tap targets went from 40 to 44 pixels, which is the floor.
      Along the way: the `more` shelf was 658 pixels tall on a 342-pixel screen, centred and
      unscrollable — it is a two-column shelf that fits now.)*
- [x] The HUD sits against the edge of the glass on a phone. *(Every inset went to the safe-area
      insets — which are a notch and a home indicator, a real obstruction — and the panels carry
      their own padding instead. Recovers about a twentieth of a 750 by 342 screen that nothing
      could use.)*
- [x] The default zoom on a phone was a view from five hundred metres up. *(The number was not the
      problem — the unit was. The zoom band was written in tiles of ground, and a tile is not a
      fixed size on a screen: thirty tiles leaves the hero forty-five pixels tall on a monitor and
      fifteen on a phone. It is written as how big the hero should be on the glass now, and the
      tiles follow from the window: a phone opens at 12.4 rather than 30, and the hero goes from
      fifteen pixels to forty-two. Nothing changes on any window nine hundred pixels tall or more.)*
- [x] On a wide desktop window the HUD runs down the right edge. *(A 250-pixel column holding the
      corner map, the hearts, the pack and the log, with the log at its foot so the newest line is
      always in the same place. The breakpoint was measured rather than chosen: a column that far in
      clears the middle half of the window from 1080 pixels wide, and below that nothing changes at
      all. HUD standing in the middle half of the picture: 10.5% before, 2.0% at 1440 by 900.)*
## Found while playing it on a phone — the world itself

- [x] **The animals and villagers froze.** *(Not the simulation: the client. A world talks
      constantly — presence ten times a second, the creatures three — so silence means it has gone,
      whatever the socket believes. And a socket can believe a great deal: a phone that sleeps, a
      wifi handover, a laptop lid all leave a connection open and dead at once, with nothing
      arriving and no close ever fired. The client went on faithfully drawing the last thing it was
      told, which is every animal standing exactly where it was. Six seconds of silence is now taken
      as a world that has gone: it says so, hands the creatures back to this client so they start
      moving again, and goes back and knocks on the same door. `src/game/online.test.ts` arranges a
      world that says nothing, which is the one case a real socket cannot be made to do.)*

## Found while playing it on a phone — the game itself

- [x] **The wolves were relentless.** *("It's like every second of the game you're being chased by
      wolves. If you stay still for 5 seconds, you're surrounded and killed." Measured: two wolves
      standing over somebody landed **13 bites in ten seconds**, which kills a full-health hero in
      under eight. They now bite on a longer jaw — 3.4 seconds rather than 1.6 — and drop back for a
      couple of seconds after each one, so a pack ebbs and comes again instead of standing in your
      face chewing. And a hunt starts at seven tiles rather than nine, so they do not come from
      across the field. Measured after: **4 bites in the first ten seconds and 12 in a minute**,
      arriving 4/1/2/1/2/2 — which is the sporadic it was asked to be. All three numbers are in
      `behaviours/creatures.json` with a note saying what each does.)*

## The numbers of the world

- [x] **The numbers of the world moved out of the source and into `properties/*.json`.** *(Three
      moves in one: what a creature *is* — six files for thirty-five creatures, every field noted in
      prose beside the number it argues about, colours as `"#f2f2f2"` because six digits of decimal
      is not a thing anybody can change; where they come from — the radius, the nineteen dials, the
      six countries with their land, water and night lists together; and the `BEHAVIOUR` defaults,
      which is where it was worth saying out loud that they *are* defaults and a tree naming
      `cooldown` beats them. The rigs stayed in the source, because a shape is read by looking at
      it. `src/core/properties.ts` parses against a type written once, so nothing downstream sees an
      `any`, and a bad value stops the game at load naming the file, the creature and the field.
      Proof it was a move and not a rewrite: the whole `KINDS` table dumped before and after,
      key-sorted at every depth, identical byte for byte at 104 KB, and the golden fingerprint did
      not budge. `animals.ts` went 661 lines to 404.)*
- [x] **The rigs went out after them, into `models/creatures/` — a file each, thirty-five of them.**
      *(The entry above says the rigs stayed in the source because a shape is read by looking at it.
      That is still true about shapes and turned out to be the wrong reason to keep them in
      TypeScript. What settled it is the character builder: it asks Claude to change a rig, and the
      sentence it sent was "the `wolf:` entry somewhere in `src/entities/` — find it rather than
      guessing", because a page could not reliably say which of three files a creature was drawn in.
      It sends `models/creatures/wolf.json` now, and `modelFile(id)` in `entities/models.ts` is
      where that answer lives so a test and a command line can ask the same question the page does.

      A file is a recipe wherever it can be. Two thirds of the bestiary is `biped` or `quadruped`,
      so most files name the generator and its arguments and lay the shapes that make that animal
      itself on top — which is what the generators already took as `extras`, in the same order. The
      four primitives were written out three times, privately, in `animals.ts`, `monsters.ts` and
      `villain.ts`; there is one copy now, in `rigs.ts`, which is the tidier end state both of those
      files had a paragraph asking for. `monsters.ts` and `villain.ts` are down to naming which of
      the kinds they are about; `animals.ts` went 538 lines to 54.

      Angles are radians, except that a right angle may be written `"-1/4"` — a fraction of a full
      turn, which is exact because halving and quartering a double is exact, and which is a thing a
      person can read where `-1.5707963267948966` is not. Every value is checked on the way in and
      every complaint names the file, the field and what was expected, because these files are
      edited by hand and by Claude and both write a colour as a number sooner or later.

      Proof it was a move and not a rewrite: every creature's part list hashed before and after,
      canonically — the old rigs carry their keys in whatever order each call site spread them, and
      that is not part of what a rig is — thirty-five hashes identical, the same order, the same
      collision box to the digit. The collision bench came back the same report but for its
      timestamp, still nothing TOUCHING and nothing INTERSECTED, and eight creatures screenshotted
      through the builder before and after are the same picture.)*
- [x] The six numbers in `properties/behaviour.json` that nothing read are gone: `FLEE_RADIUS`,
      `HUNT_RADIUS`, `CIRCLE_NOTICE`, `CHARGE_EVERY`, `SEA_BITE_COOLDOWN` and `CIRCLE_CLOSE`.
      *(The first five were superseded when the trees started writing those numbers themselves —
      which is the right place for them, because a shark's ring and a wolf's are different sharks
      and different wolves rather than one default. `CIRCLE_CLOSE` was dead outright: the ring no
      longer tightens, it holds. The notes that explained them went with them.)*
- [x] The HUD scales with the screen. *(`--ui-scale` is a *length* rather than a number, because CSS
      cannot divide one length by another, and every HUD rule says `calc(13 * var(--ui-scale))` where
      it used to say `13px`. Two terms, smaller wins, and each is a constraint rather than a taste:
      the window's height against the 720 it was drawn at, and the width against the 1080 at which a
      column still clears the middle half of the picture — which makes last week's breakpoint true at
      every size instead of at one. Measured: 1.00 / 1.50 / 2.00 / 3.00 at 1280, 1920, 2560 and 3840
      wide. A maximised browser on a 4K screen has about 2020 pixels of viewport rather than 2160, so
      what Chris will actually see is 2.8×. The phone cannot reach the ramp at all — the floor is 1
      below 720 tall — which is a stronger guarantee than a media query somebody has to remember.)*
- [x] Two things the scaling made obvious rather than caused. The corner map is an upscale, not a
      bigger map: its canvas is 180 pixels square whatever size it is shown at, so at 3× it is a 4×
      blow-up of the same image, and `minimap.ts` should size its own backing store and its markers
      from the box it is given. And the modal panels — journal, rucksack, options, world map, the
      title screen — do not scale at all, so at 4K a 13-pixel journal sits inside a HUD that has
      trebled and reads as a different application. *(Both done. The map sizes its
      backing store from the box the stylesheet gives it and draws its marks as shares of the map
      rather than counts of pixels — the stylesheet has to state the size, because a canvas that
      sets its own width grows the box, asks for more pixels, and walks across the screen on a
      retina display. The base image is only about 176 real pixels of world, so past 2× the extra
      resolution buys the marks rather than the map, and the blit turns smoothing off when
      enlarging: a blocky world enlarged should read as tiles, not as a soft photograph. The modal
      panels now ride the same ramp — journal, rucksack, options and world map measure 1.0 / 1.5 /
      2.0 / 3.0 at 1280, 1920, 2560 and 3840 wide.)*
- [x] Three more the same, found while doing the above: `#castbar` sits at `bottom: 200px` on a
      phone, which is directly over the hero; `#toast` and `#duelbar` are still pinned with
      hand-computed offsets in the middle of the picture and want the treatment the log just had;
      and the panel rail mixes colour emoji with monochrome ones, which is the one thing left
      stopping it reading as a single set. *(All three. The toast stands one line above the
      log, the duel's score joins the readouts down the left, and the cast bar goes bottom-centre
      where cast bars live — the phone's bands are now rail, duel, toast, log, cast bar, with
      nothing at all on the hero. The emoji are gone: eleven controls are drawn in `glyphs.ts` on
      one grid at one stroke width in `currentColor`, so they light with the button and stay crisp
      at 4K. A filter could never have fixed it — the map, pack and book arrived as full-colour
      pictures and the cog and arrows as thin strokes, and the difference is weight and detail, not
      hue. Four wanted redrawing once they were up: the pack read as a padlock, the turn arrows as
      a damaged letter C, the sword as a scratch with a bead on it, the bow as an arrow in a
      bracket. The options button is sliders rather than a cog, because what is behind it is a
      panel of sliders and a cog is a word for everything.)*

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

## Playing it without a browser over it — September 10th

> "Is it not possible to run full screen in the browser without the address bar by showing or
> hiding it on demand? I got told that maybe the only option was to install as a PWA" — and then:
> "But if we can do it on a normal web site that would be better"

- [x] **It already could, everywhere but one place.** *(`ui/sideways.ts` has had `toggleFullScreen`
      for days and the settings panel has had a Full screen button: on every desktop browser and on
      Android Chrome the page asks for the screen and gets it, and F11 does the same without any of
      our code. A phone is given the screen automatically on the tap that enters a world. So the
      answer to "can a normal web site do it" is yes, and it was already doing it — what was missing
      was any way to find out, so the keys topic in the console now says which button.)*
- [x] **The exception is an iPhone, and there a manifest is the only answer.** *(iPhone Safari
      refuses the Fullscreen API to anything that is not a video — there is no flag, no gesture and
      no permission that changes it — so on an iPhone the address bar comes off only by adding the
      page to the home screen. `public/manifest.webmanifest` plus four meta tags, and the page is
      still an ordinary web page at a URL: a manifest is an offer and a browser that ignores every
      line of it plays this game exactly as before.

      The trap, and the reason `ui/installable.test.ts` exists: this game is served from
      `/ai.world/`, Vite rewrites the `href`s in `index.html` and rewrites nothing inside a file
      copied out of `public/`. Every path in the manifest is therefore relative, and a test says so
      — because a wrong path there fails silently and nobody finds out until somebody installs it
      and gets a white page. `apple-touch-icon.png` is a real PNG rendered from the favicon rather
      than the SVG, because iOS ignores the manifest's icons and will not take an SVG for this one.)*

## Walls you can see what they are made of — September 10th

> "I think the castle walls can be better, we can design a block texture like the walls of a real
> castle instead of flat polygons" — and: "We can have a rock mining tunnel like texture for
> dungeons and mines too"

- [x] **Both, and neither of them is a texture.** *(There are no textures in this world and there
      should not be: the whole look is flat colour on honest geometry. So the blocks are geometry,
      the same way the miner's hard hat has a moulded rib rather than a picture of one. It is the
      difference between a wall and a drawing of a wall, and at this camera the eye can tell.

      **The castle's own walls** are props, so they are cut in `entities/castle.ts`. A curtain wall
      was one box five metres tall; it is five courses of two blocks now, each standing a hair
      proud of the slab behind it and shaded a little off the wall's colour, so the joints are real
      shadow rather than drawn lines. The stagger is what makes it read: alternate courses start
      half a block along, so the vertical joints break instead of running the height of the wall.
      The drum towers get string courses instead of blocks, and that is a decision rather than a
      shortcut — a tower is eight faces wide and its stones run round it, so what reads at this
      distance is the horizontal joints; laying individual blocks on a curve would be nine rings of
      eight stones for detail nobody can resolve, with the corners of the octagon fighting for the
      same pixels.

      **The rock underground** is terrain, so it is cut in the mesher, behind an optional `WallCut`
      that nothing above ground passes. `stone` is coursed and staggered; `hewn` is the same
      subdivision with three times the spread of shade and no stagger at all, because a mine face
      is where a pick went rather than where a mason laid. A cliff above ground is untouched and a
      test says so — a hillside is not made of anything, so a hillside of one colour is the truth.

      The slab behind the blocks stays in both cases. It is what an arrow loop is cut through and
      what keeps the face solid where the courses break.

      Costs, measured: a castle floor's land mesh grows by about half again, and the exterior of
      Saltmarch goes from 144k triangles to 148k. The thing that made it worth doing is that a
      castle now reads as built from the ridge, which was the whole complaint.)*

## Found while looking, September 10th

- [x] **An interior had no crowd at all.** *(There is one `EntityManager` per place — the country
      has one, and every dungeon floor, mine and castle keep has its own — and an interior had
      none. `placeKeeper` built a lone `Entity` and added it straight to the visit's renderer, so
      `__entities()`, `__entitiesFull()` and `__blow()` all reported the *outdoor* crowd while the
      hero was standing in a shop. Walking into the watch house at Crossroads Town and asking who
      was there listed ducks and sheep in a field two hundred tiles away, and not the sergeant in
      front of the hero. A whole class of interior fault could never have been seen.

      A room gets its own crowd now, on the same terms the dungeon floor was given one earlier
      tonight: no villages, no tiles, but the register and the same `fallen`. `Places.crowd` asks
      indoors first, then underground, then the country — the order `frame.ts` branches in. The
      keeper is admitted rather than spawned, and that distinction is the interesting part:
      `spawnPack` would scatter him off his tile and would ask `canStand` about the ground behind a
      counter, which can answer no and leave a shop with nobody in it.

      Proved by mutation rather than by assertion alone: with `crowd` put back to the old
      expression the new test fails with `expected [ 'sheep', 'sheep', 'sheep', 'sheep' ] to
      include 'shopkeeper'` — the reported fault, verbatim. `manager.ts` paid for it: it was six
      lines under the cap, so `spawnVillageFolk` moved out to `street.ts`, the same seam
      `paddocks.ts` came out of, and the moved code was diffed byte for byte after normalising
      indentation so that no village's random stream moved.

      Left undone and worth knowing: nothing calls `update` on a room's crowd, so the keeper still
      does not breathe or turn. The only tree his body resolves to is the wanderer, and ticking him
      today would walk him four tiles off his counter while the game goes on reading the counter
      tile — you would talk to an empty till. Minding a shop is a behaviour that has to exist
      first. And `blows.ts` still swings at the underground crowd or the country's, so a keeper is
      not yet hittable indoors: that is a decision about murder in a shop, not a probe fix.)*

## A village's descent, September 10th

> "at the town hall, you should be able to see the family tree for the whole village as a graphic
> you can mouse drag yourself around and see information on each person, this would be interesting
> from a genealogy standpoint. You could pay for the service"

- [x] **The family tree, sold across a counter.** *(Every part of it was already written down and
      nothing had ever read it. A `Person` carries `mother` and `father` — by *name* rather than by
      id, deliberately, because "lineage is for talking about, and the dead are not kept" — so a
      parent who died forty years ago is still a name on their child's record long after there is
      any person to point at. The churchyard keeps sixty stones. Between the two, a village's
      descent was there the whole time.

      Three pieces. `game/lineage.ts` builds it and lays it out; `ui/kin.ts` draws it with the
      world map's own gestures, because a player who has opened a map has already learned this one;
      and `enquiry.ts` gains one idea — a book may be **unrolled** rather than read. Every other
      book is read three lines at a time, which is right for a list and wrong for a family: a roll
      is a column of names and a descent is a *shape*, and read aloud it is thirty sentences nobody
      can hold in their head. The counter still does everything it did — the gist for nothing, the
      fee, the sitting that lasts as long as the conversation — and only the last step differs.

      It is the dearest thing anybody sells here, at 36 gold against the roll's 12, and the price
      is the work: every other book is one pass over one list, and this is the roll and the
      churchyard cross-referenced against every parent named on either.

      **The bug worth keeping.** Keyed by name, the first version made a grandson named for his
      grandfather into one node — so the grandfather became his own descendant, and the walk that
      settles how deep each generation sits went round that loop once per pass. A village of
      twenty-eight came out **a hundred and forty-three generations deep**. Found by measuring
      rather than by looking, because it draws perfectly happily. A name is not a person: `whoWas`
      turns a parent's name back into whichever bearer of it was alive when the child was born, and
      the test now asserts the tree is no deeper than the village has had days to be.

      Where it is drawn is a hook (`whereLineageIsDrawn`) rather than a parameter, and that is a
      trade worth naming: `enquiry.ts` earns its keep by knowing nothing about the game around it —
      a town hall and a watch house cost it one `case` each — and threading a panel through it
      would end that. Unset on the server, where the book is still sold, still priced, and simply
      has nowhere to appear.)*

## Getting close to the hero — September 10th

> "we need to be able to support being much closer to the player, almost over their shoulder if you
> want to get into tight spaces like this" — and: "perhaps we can have a occlusion box fixed to the
> screen, almost like a camera, which will cut away geometry that it intersects"

- [x] **The camera comes right in.** *(It stopped at fourteen tiles of frustum, which is the width
      of a castle ward — so the closest a player could stand was "the whole courtyard fills the
      screen". Six now. The models were never the problem: at six tiles a keep's cell block reads
      beautifully, and always did, because the props were built to be looked at from the character
      builder's own distance.

      Two numbers had to move, not one, and that is worth knowing because it has caught somebody
      before: the band takes whichever of `MIN_ZOOM` and the hero-pixel limit is further out, so
      raising one alone does nothing. `MIN_ZOOM` 14 → 6 and `HERO_LARGEST` 98 → 230.)*
- [x] **And a cutaway, so what is in front of him gets out of the way.** *(At forty-five degrees a
      wall hides as many tiles of ground behind it as it is units tall. A terrace is half a unit and
      hides half a tile; a castle's curtain is 6.1 and hides six, which is half a ward. So being
      close enough for a courtyard to be a place means being hidden by the wall you walked through.

      A fragment is discarded if it is nearer the camera than the hero, within a radius of him on
      the glass, and above the ground he is standing on. **The third test is the one that earns its
      place.** The naive version takes the floor with it, because on a forty-five degree view the
      ground in front of somebody genuinely is nearer the camera than they are — so you punch a hole
      through the floor at their feet. The proper repair is to build the cutaway volume, intersect
      it with the ground and subtract, which is real geometry every frame; the cheap one is to
      notice that the ground in front of you is at your feet and a wall is not. Terrain is left
      unpatched as well, which costs nothing — half a tile per terrace — and removes the case
      entirely.

      Dithered rather than cut: a hard circle reads as a hole punched in the picture, and an ordered
      dither over the outer half reads as the wall thinning out.

      **The fault it uncovered is the one worth keeping.** `three` gives a material one
      `onBeforeCompile`, and the season tint already used it — assigned from the chunk manager,
      after the prop library had installed the cutaway in its own constructor. The second assignment
      silently erased the first. Nothing threw, nothing warned, and the only symptom was a feature
      that did not happen; it took a screenshot of a hero plainly hidden behind a cottage to find.
      `shaderpatch.ts` registers named edits and runs them all, with the cache key made of every
      name — because `three` caches programs by that key and two differently-patched materials must
      not be taken for each other.)*

## Releasing

- [x] A release is one act: chart version, game version, tag and image all naming the same moment.
      *(`chore release`, and `docs/releasing.md`.)*
- [x] v0.2.1 was tagged and published with no image behind it. *(0.3.0 cut with the new tooling and
      published for both architectures; the dead tag and its release are deleted, because a version
      somebody could roll back to and never start is worse than no version at all.)*

- [x] Released as the work lands, so it can be tried on the cluster and on a phone: 0.4.0 (the sea,
      the roads off their causeways, the surfaces, the server-walked hero, the blows and the floors),
      0.4.1 (a phone held sideways), 0.4.2 (the phone's buttons, and the world's own clock). Each one
      built for amd64 and arm64 and pulled by Flux.

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
- [x] `/time 0.5` answered "day 1, time 0.5" and left the clock at 08:13. *(The clock belongs to the
      world and the world says what time it is ten times a minute, so setting it on the client alone
      lasted until the next thing the world said. Asked of the world now, which tells everybody in
      it — and refuses where there is anybody else in it to tell, because the time of day is the one
      thing a world has to agree about and a stranger winding it to midnight is not a thing anybody
      wants done to them. On a real server the way in is the operator door, which is what it is for.)*
- [note] The server answers every steer with a `youAre`, about 0.7 KB/s a player down. Cheap enough
      to leave alone; the knob if the Pi ever complains is to answer at the presence tick instead,
      since the client predicts either way.
- [note] The coast field is measured only where chunks are loaded, so water past the streamed
      ground has open-sea waves and no shore. Invisible at the zoom the game plays at; worth knowing
      before somebody widens the view and wonders.

- [x] The operator door has no safety story. *(`OPERATOR_WATCH_TOKEN` may only run the commands
      marked `reads`; both tokens are rate limited, and every command through the door is logged.)*

## Playing it, September 7th

- [x] Nothing on a shop's shelf says what it does. A row read "Iron Sword — 60g" and the only way
      to find out what that bought you was to buy it. *(Every row now carries what it gives you
      underneath — `+2 attack`, `heals 5`, `climb two terraces at once` — from the same
      `itemSummary()` the rucksack and the journal already used, so there is no second table to
      drift. Where an item grants nothing measurable the note says what it is instead: seeds have
      no stats, and a player needs to know they go on bare earth beside a village. And it exposed
      something older — a general store stocks seventeen things and the dialogue box is anchored to
      the bottom of the screen, so it already stood 90 pixels off the top of a desktop window and
      251 off a phone. The box is capped at the screen now, the shelf scrolls, and the highlighted
      row is kept in view.)*
- [x] The corner map does not show the right place, and the hero is not in the middle of it.
      *(Three faults compounding. It clamped its crop to the edge of the base image, so near the rim
      of the world the hero slid off centre. It was north-up while the camera can be swung right
      round, so a village on your left could be behind you. And the box showing what is on screen
      was a square drawn round the hero, turned 45° and stretched by a hand-picked 1.4 — which was
      true only while the camera looked straight down at his feet, and false from the day it learned
      to aim up at a mountain, which puts him 70% down the frame. The map is now always centred on
      him, turns so that the way the camera looks is the top of it, and asks the camera itself where
      the picture meets the ground.)*
- [x] At night the hero is lit as though the light comes out of his head. He should be carrying a
      torch — something like a tiki torch, in his hand, that the light comes from. *(He was: the
      night light was pinned a metre and a half above his feet, which is his head, so his shadow
      went out in every direction from a point nobody could see. He now carries a cane torch — a
      shaft, two ties of cord, a bowl of pitch and a flame — in his off hand from dusk, and the
      light comes from the fire on the end of it. The flame is drawn flat at full colour rather
      than lit like everything else, because a flame shaded by the light it is casting is a dull
      cone in the middle of its own glow. Held straight up it sat directly over his hat, which is
      the picture it was meant to replace, so it leans out and is held wide: yaw first and lean
      second, so it tips out to his side whichever way he is facing. It takes the off hand while it
      is out — nobody holds a shield and a torch in one fist — and a lantern, which is better light,
      keeps it in its pocket.)*
- [x] A stable reads as an ordinary house. It wants a paddock attached, with goats and horses
      walking about inside it, so that it is obviously a stable from a distance. *(It was not a
      building at all: a stable was a roll on a village's name and a man on the square who would
      sell you a horse, so there was no finding one except by asking everybody in turn. A village
      that keeps one now lays a fenced paddock beside the stable house — behind it where the ground
      allows, since the door faces the road — with a gate on the side you come from and two or
      three of the country's own animals inside. Two things had to be got right. The yard asks a
      different question of the ground than a building does: `footprintOk` keeps a house's width
      clear of everything standing, so the paddock was refused by its own stable in every village,
      and `footprintLevel` wants one exact terrace, which refused it three times in four more. A
      paddock is a fence round some grass — it may abut the house, and grass gets levelled, up to
      one terrace of fall. With both asked properly, two to five villages in a world keep one. And
      the ground inside is cleared as well as levelled, or a paddock laid in a wood is a fence with
      three trees in it. `structures.ts` went past 700 lines doing it, so the paddock is its own
      file and the pier planner — the one job in there about a coast rather than a settlement —
      went to another.)*

## The way it looks, September 8th

- [x] The title screen is a bad loading screen: three fat rounded boxes with a green button each,
      an options panel floating in the bottom-right corner in a different visual language and
      overlapping the third slot, and — on a phone — everything crammed into the top-left third with
      two-thirds of the glass empty. Wants to be sleeker and to work on both desktop and a phone: a
      sidebar layout on the desktop. *(Rebuilt in cut stone, the language chosen off a design canvas
      of four directions. A rail down the left holds the name, what a new world is made of, and the
      keys — or, on a phone, the one line a thumb needs. The slots are bands rather than boxes: a
      numeral, the day, the facts in one muted line, and the whole band is the button, because a
      saved world has exactly one thing you want to do with it. Throwing one away is a small mark at
      the far end of its own row instead of a red button beside Play. Behind it, `titlesky.ts` draws
      four terraced ridges under a dusk sky, drifting; drawn rather than grown, because a title
      screen has to be up on the first frame. The same shape at every size — 1440, 4K, and a phone
      held sideways where the bands come to 68 pixels and the seed number, which is for a bug report
      rather than for a player, goes.)*
- [x] The whole interface is built out of rounded rectangles with thick light borders, and it reads
      as a template rather than as this game — cobbled-together layers rather than a designed one.
      It is not even good pixel art: a 2px rounded border is a web page's idea of a box, not a
      drawn one. The worst of it: the desktop's right-hand column, a rounded box with wasted space
      above and beside it; and the banner that names the town you are walking into. This wants one
      visual language decided and then applied everywhere, not a tweak per panel. *(Cut stone,
      chosen off a design canvas and written down at the top of the stylesheet: a panel is a slab
      that meets an edge, the only line is a hairline on the edges facing the game, corners are
      square. Thirty-six rounded corners went; the three that are genuinely round stayed with the
      reason written beside them — a thumb travels in a circle and the stick's ring is a picture of
      how far, and a dot in a map key stands for a dot on the map. The three readouts had rings in
      three different colours, red and yellow and purple, which is exactly what nothing-was-decided
      looks like; they are one corner now. The town's name was a black plaque with a purple ring
      hung in the sky — a name is a caption, not an object, so it is set as one: letterspaced over a
      gold rule, with the compass as its second line rather than as a second plaque overlapping the
      first. And the accent is used once per panel at most, so an ordinary line of news lost the
      gold rule it had briefly acquired.)*
- [x] The faces on the villagers are bad — the dialogue box draws something anime-ish and it is not
      the standard of the rest of the game. *(The eyes were the whole of it: a tall white opening
      with a coloured iris, a lozenge pupil and two specular highlights — a glossy wet sphere drawn
      with a gradient's worth of tones, in a world of flat-shaded polygons with no textures at all,
      where the villager three feet behind the box has two dark cubes for eyes. They are cut the
      way everything else is now: a dark socket with the colour as a band in it and one square of
      light. Filling the socket with the eye colour at full strength was tried first and came out
      as two saturated blocks the size of a thumbnail — a blue no eye is. And the hair lost its
      pink, mint, lilac and teal: an anime village is full of them and this one is greens and sands
      with nothing brighter in it than a market awning, so a mint-haired villager read as a bug
      rather than as somebody who had dyed their hair. What is left is what soot, henna, woad or
      lime would give you, at one in eight rather than three in ten.)*
- [x] The torch's flame comes away from the torch when the hero walks, and he does not look like he
      is holding it — it floats beside him with no arm reaching for it. *(The flame hung off a mount
      of its own, a little above the shoulder, while the hand hangs below it — and the arm swing is
      a rotation about the shoulder, so the two were carried round it in opposite directions. The
      fire orbited the hand instead of sitting on the end of the stick. It is now worked out from
      where the shaft actually ended up. And the torch moved in to where a shield hangs, which is
      where the rig's hand really is: held further out it was a torch floating beside a man with his
      arms at his sides. What is left of "no arm reaching for it" belongs to the models, which are
      their own item — the rig has no arm that extends.)*
- [x] The villagers and the other people are blocky in the wrong way. Keep them blocky — that is the
      game — but they want designing rather than assembling. *(They were a cube with a slab of hair
      on it, a box for a body and four sticks: arms pinned flat to the body's sides ending in
      nothing, and legs. Four things make a stack of boxes read as somebody, and all four were
      missing — a beam of shoulders for the arms to hang off, a block of hand on the end of each
      arm, a neck so the head is not sitting straight down on the chest, and hair with a fringe and
      a mass behind the skull so the head has a silhouette. At this distance everything is
      silhouette. And the eyes: one dark block apiece, which does not read as an eye looking at you
      so much as a hole — an eye is a white with a pupil standing proud of it, which is two blocks
      and gives it somewhere to be looking.)*
- [x] Villagers and creatures do not touch the ground. They hover over it. *(Not the ground — the
      legs. A villager's leg ran from 0.26 up, while his boot lay from 0 to 0.08, so there were
      nearly two tenths of a unit of nothing between the two: an eighth of the whole figure, and
      the eighth nearest the ground. Standing still that reads as somebody floating; walking, the
      leg and the boot swing on the same hip at different radii, so the gap opens and shuts and the
      feet look like two blocks following him about. The leg reaches the boot now. Checked what was
      underneath first: the entity origins were already sitting on the drawn surface to within a
      tenth of a unit, and that tenth is a creature mid-step across a terrace edge.)*
- [x] Walking into a house's door should take you inside. At the moment you have to stop and press
      something. *(`doorways.ts`. The awkward half is not the going in, it is the coming out:
      leaving a building stands you one tile beyond the doorway, close enough that the next step in
      any direction would round you straight back inside — out of a shop and into it again before
      you had finished leaving. So the step is disarmed on arrival and stays disarmed until the
      hero is clear of every door in the world. The key still works, for when you are already on
      the step and would rather not shuffle.)*
- [x] Some buildings open a conversation when you try to go in, which reads as talking to a
      building. *(The pub. Standing at its door delivered the room's gossip, the errand, a game of
      darts and a builder's quote — all from a closed door with nobody at it — and the way in was
      one of the choices in that menu, under "Get a drink", so the door talking at you was also the
      door you had to ask permission to open. The door is a door now: walk into it and you are in
      the room, and everything it used to say is said by the landlord behind the bar, who was the
      one saying it all along.)*
- [x] A ship sailed straight through an island. *(The ferry. It is not steered — its position is
      worked out from the clock, sliding down the straight line between two jetties — and that line
      was land for much of its length: measured over three worlds, crossings ran 61, 65 and 93 of
      their 121 soundings aground, one of them three-quarters of the way. Each jetty walked out
      from the middle of its own shore along one axis and stopped at the first coast, which on a
      ragged shore puts the two on rays that miss. Both shores are surveyed now and then paired,
      and the shortest crossing with clear water all the way is the one built. Refusing the rest
      cost three of seven worlds their only ferry at first, which is why the survey tries eight
      directions at four distances along either axis rather than aiming once — with that, every
      world has more ferries than it did and none of them crosses land.)*
- [note] The other half of that report — "you should only be able to get on and off a boat at a
      dock" — is deliberately not done. It is already true of the ferry, which only ties up at its
      two jetties. Of the little boat you buy it would be a different game: most islands have no
      jetty at all, so a boat that could only be left at one could never land you anywhere worth
      rowing to. Say the word if you meant it for that boat too and it is a small change.
- [x] There is no way to open the console on a phone. It is tilde on a keyboard and nothing at all
      on a thumb, so it wants a button in the touch rail. *(In the extra-controls shelf rather than
      the always-visible rail: you stop to type at a console, and the rail is already eight squares
      wide on a screen 390 tall. Worth noting it is not the same door as the Chat button that was
      already there — that one only opens in a shared world, so on a phone playing alone it was the
      one thing that looked like a way to type and did nothing.)*
- [x] Edge — and probably others — never goes full screen, so the browser's own chrome keeps a fifth
      of the glass. `takeTheScreen()` asks on the tap that enters a world; find out what it is
      actually doing on those browsers rather than assuming the request was granted. *(It was doing
      exactly what it was written to do: nothing. It returns immediately unless the screen is a
      phone's — coarse pointer, and no side longer than 1100 — so on a desktop, and on a tablet,
      the request was never made at all. That is right as a default: a page that grabs the whole
      screen because somebody clicked a save slot is doing something it was not asked to. What was
      missing is any way to ask, so there is now a Full screen button in the options, which works
      wherever the browser will allow it and says "Leave full screen" once it has. It listens for
      `fullscreenchange` too, because a player can leave with Escape or F11 and the button would
      otherwise go on claiming the game was still full screen. Not verified in Edge itself — there
      is no Edge on this machine — so if it still refuses there, the next thing to look at is
      whether the request is reaching it at all.)*
- [x] The world map does not light up the parts you have discovered — a black area that does not
      show properly. *(The remembering was right; the drawing was not. Each explored chunk was
      punched out of the fog as a hard rectangle, so the edge of the known world was a staircase
      with sixteen-tile steps — and the corner map shows a hundred and ten tiles across, so each
      step is a third of its width. Turned with the camera it arrived as a blocky diamond sitting
      on the picture, which reads as a fault rather than as fog. The union of the chunks is kept on
      a mask of its own now and blurred once as it is punched out: blurring each rectangle
      separately would leave every seam inside the known world half dark, criss-crossed with the
      grid it was revealed in. Lightening the dark was tried at the same time and put back — it
      brought the land up as a warm brown wash and made the whole map muddy. The edge was the
      fault, not the darkness.)*

## Playing it, September 9th

- [x] The door activates going into a building but not coming out, and it fires when you are
      anywhere in front of the building rather than on the door. *(Two faults. The frame called the
      doorstep below the branch that ends an indoor frame, so it ran out of doors only — the same
      trap the blow cooldowns were in, and it is now above the branch with them. And the trigger was
      a circle of radius 0.62 round the `Doorway` record, which is the tile you stand on to knock:
      two whole tiles out from the middle of the house, when the door leaf `house()` draws is at
      1.22. So it was testing a spot three-quarters of a tile out in the street, with a circle wider
      than the tile it sat on. It is now the leaf's own rectangle — 0.62 wide, 0.08 thick, at 1.22 —
      grown by the hero's shoulders and nothing else. Mapped: it fires between 1.00 and 1.44 out
      from the middle of the house and within 0.49 along the wall, and nowhere else.)*
- [x] Walking through market stalls, and invisible walls with nothing drawn on them. *(One cause,
      both directions. Collision was a bit per tile: a prop stood on a tile and that whole tile was
      solid. A stall is drawn two and a half tiles across and blocked one — you walked through the
      counter. A cottage's footprint is stamped three tiles wide while its walls are 2.4 — a ring of
      invisible wall round every house, measured at 0.15 of a tile. A one-tile grid cannot describe
      either, so it has stopped trying: every prop is now collided against the box its own geometry
      occupies, taken off the same meshes that draw it. Only what is below head height counts, which
      is the rule that makes boxes usable rather than merely accurate — a canopy, a stall's roof and
      a cottage's eaves are things you walk under, and taking whole bounding boxes would make a wood
      impassable. Measured after: the house blocks to 1.2 and is clear at 1.35, against walls drawn
      to 1.20.)*

## Playing it, September 9th — the day the collision boxes were finished

Everything below was reported by playing it, and every one of them was invisible to the tests. The
tests were about the arithmetic; each of these was about whether the arithmetic and the screen were
describing the same world.

- [x] Walking through the back of a house, reliably, on some houses and not others. *(The boxes were
      right and the index was wrong. Each chunk kept a grid of its own sixteen tiles and a box was
      registered in every tile it reached — clamped to that grid, because there was nowhere else to
      put a tile outside it. A cottage is 2.52 across, so a house within a tile and a bit of a chunk
      boundary had the part of its box over the line registered nowhere at all. Ten of the thirty-two
      houses in the four villages nearest the start of seed 3 straddle a boundary like that. Trees
      went on working throughout, which is what made the reports look contradictory: an oak is 0.9
      across and stays inside its own chunk. One index for the world, keyed by world tile, with
      chunks putting boxes in by name and taking the same boxes out again.)*
- [x] Stepping clean over things. *(A move asked whether its far end was inside something and said
      nothing about the way there. A hero walks 5.5 tiles a second and a step may be a quarter of a
      second, so 1.4 tiles on foot and 4.8 on a courser — a cottage is 2.5. Both ends on clear grass,
      and through the wall he went. It was frame-rate dependent, which is why it was reported as
      happening "sometimes". A move is now the segment against the box: both ends into the box's own
      frame, then the standard slab clip. The tile grid keeps a sampled sweep in slices shorter than
      the thinnest thing in it.)*
- [x] Bitten by wolves that are not there; blows that land on nothing. *(One fault, and a number:
      the screen was drawing creatures 2.01 tiles on average from where the world had them, 5.34 at
      worst, against a wolf 0.6 across and a swing that reaches about a tile. The client eased
      towards the last snapshot, so it always drew where a creature had been; and the world described
      everything at the rate the middle distance deserves. Now each creature is carried forward at
      the speed the world's own corrections imply — clamped to its own pace, never more than 0.45s,
      and not at all for anything that flies, which circles — and whatever is within fourteen tiles
      of a player is described every tick. Measured after: 0.09 to 0.11 of a tile.)*
- [x] Walking through beds. *(Indoors blocked furniture by the tile it stood on. A bed is drawn 1.9
      tiles long, so the foot of every bed in the world was scenery. Furniture is boxed now, off the
      same measurements, turned the way the piece is turned. The opposite risk — a room its own
      furniture seals — is tested by flooding every kind of room at five seeds from where the hero
      arrives, and failing if the door or the keeper cannot be reached.)*
- [x] A door triggering over and over while its owner is nowhere near one. *(Going through leaves you
      on the far side of the same doorway, and one frame off the threshold re-armed it, so leaning on
      an arrow key span you in and out several times a second. A door now rests for five seconds
      after somebody goes through it, with the arming still running underneath — walking away while
      it rests still counts as having walked away.)*
- [x] Respawning inside an object and being trapped in it. *(Both halves were true. Whatever puts
      somebody somewhere names a point on a map, not a place to stand — a hero carried home is set
      down two tiles from the middle of his village, which is sometimes a market stall — and the
      placing answered by shoving him a tile east every frame until something gave, which gets you
      out of a hut and into the sea. It now looks for the nearest spot a body of that kind fits. And
      being inside a solid is no longer a life sentence: every direction out failed the test that
      should have stopped him getting in, so anybody already inside something is let out, with the
      ground still having to be ground.)*
- [x] A ghost in his own village: walking through walls, wolves biting from nowhere, blows landing on
      nothing, in a road world. *(A seed is not a world. The same number grows a road country or a
      polygon one and they share nothing — in one slab of seed 3 the polygon world has eight cottages
      and the road world none, on ground that is not the same height. The client picked from the
      save; the server built the polygon one for everybody. Since the server owns where a hero is
      standing, it walked him about on a land he could not see and corrected him through the walls
      his own game had stopped him at. `join` carries the world kind now, a room remembers which
      country it opened as, and two players of one seed from different countries are turned away
      rather than put somewhere they cannot agree about. Protocol 14.)*
- [x] The server bundle imported `three` into an image that installs one dependency. *(Introduced by
      measuring the props on the server, and it would have killed the container at startup on the
      first deploy. Rolled into the bundle: 594 kB to 1,050 kB. Found by building the bundle and
      reading it, which is an argument for building the image on the way in rather than on the way
      out.)*

### Still open, from the same day

- [x] A prop is defined by a list of `THREE` primitives, so measuring one needs a renderer — which is
      why the server carries three. Creatures are already part lists that anything can read. Doing
      the same for props would take the geometry out of the server bundle and make a prop's box a
      property of the prop in the same way a creature's is. *(Done, and the server has put three
      down: the bundle went from 1,083 kB to 616 kB, 285 to 189 gzipped, and all that is left in it
      is `ws` and four node builtins. A prop is now a part list in `entities/props.ts`, beside
      `entities/animals.ts`, which has always been one, with its box worked out from its own parts.
      Every one of the seventy-five boxes is the number the mesh gave, to eight decimal places, and
      the thing that made that possible is worth writing down: a part is measured whole, but a ball
      is measured face by face. A crown of leaves can have its widest point over your head and only
      its underside in the walking band — a birch measured whole is 6cm wider than the tree that is
      drawn. `world/footprints.test.ts` now stands the two answers side by side for every prop, so a
      shape the drawing and the measuring disagree about is a failing test rather than a wall nobody
      can see. The collision bench is identical either side of it — PASS, nothing touching, nothing
      intersected — and the golden fingerprint did not move, because where a prop is put has never
      gone through its box.)*
- [x] The sweep test rides. *(Half of it was already done and nobody had noticed: `SPEEDS` in
      `src/world/collisions.test.ts` walks the hero at a courser's pace of three and a half for a
      quarter of a second, which is the mounted case as the arithmetic sees it — a horse does not
      carry the hero, it multiplies his pace, so what changes is the length of a step and a step
      longer than the thing it walks into is how a wall gets stepped over.

      The played half needed a way onto a horse from a script, because mounting is only reachable
      through a stable's dialogue: a person does that in ten seconds and a script cannot do it at
      all. `__ride` buys one where the hero stands if he has none, which is the only part a stable
      was really for. The playtest now walks into the same wall twice, once on foot and once at a
      gallop — 1.62 tiles from the middle walking, 1.58 riding — at whatever frame rate the machine
      actually manages, which is where the sweep is under real load.

      Where it goes in the script turned out to matter, and finding that out cost a run: put before
      the creature-drift check it took the hero away from the spot the drift is measured at and the
      check reported nought corrections, which reads as a broken world and was a broken test. It
      rides after the drift is measured. 11/11.)*
- [x] The playtest needs a dev server and a borrowed playwright. It should be possible to run it in
      CI on the way in, which is where all of this would have been caught. *(`chore playtest` now
      serves the page itself when nothing is answering on the port, plays, and puts the server away
      whether it passed, failed or threw; a dev server somebody already has up is played against and
      left alone. Its own CI job beside `check` rather than inside it — two minutes against that
      gate's seconds, and a gate too slow to run before a commit stops being run. Playwright stays
      out of `package.json` on purpose and the reason still holds: everything that installs this
      project's dependencies would pay for it, including the server image, twice, once per
      architecture — so CI borrows one globally and points NODE_PATH at it, exactly as a desk does.
      Two things came out of making it run rather than out of playing. It printed FAIL and exited 0,
      so a pipeline could never have stopped on it. And the fight had not been played in a long
      time: it wanted a clear line of sight up to forty tiles to pick an animal, and a tenth of the
      ground round that village is trees, so it found nothing to swing at every time and said so
      quietly. Fixed to ask the question it meant — is there a fence in the two tiles it teleports
      into — and to close the gap when the chase loses it, since a hero cannot outrun a deer by
      design and the check is named for whether the blow lands. Nine of nine now. The drift
      tolerance had to become nameable: the drawn body is carried forward between snapshots, so the
      gap is partly a count of frames, and the same build read 0.11 on a quiet laptop, 0.46 with the
      cores busy and 0.62 with them fought over. CI holds 1.5 — under the two tiles a swing reaches,
      so it is still a ceiling with a meaning — and prints what it got, so the line can be pulled in
      from evidence.)*

## The world comes from the world

Both halves grow the landscape from the seed. That is why they can be in different countries, and it
is why an afternoon went into a bench that checks they are not — `chore test halves`, four thousand
points of two worlds, asking both the same questions. The bench is worth having. It is also a test
for a thing that should not be possible.

So: the server grows the world and the page is told. The server already grows those chunks — it has
to, to walk creatures on them — so this costs sending, not generating.

Measured before starting: a chunk is 3.3 kB raw, 448 bytes packed; 121 of them fill a view, so 53 kB
on arrival; walking at full pace needs a new ring about every three seconds, near enough 1.6 kB a
second. The creatures already cost 13.7 kB a second, so this roughly doubles a quiet world's traffic
and less than that a busy one.

- [x] The wire carries bytes as well as words. `Link` and `Wire` take `string | ArrayBuffer`; a
      websocket does it natively, a worker port by transfer, so a chunk costs nothing between
      threads. Nothing sends one yet.
- [x] The page asks for a chunk it does not have, and the world answers with it. Request and answer
      rather than the world pushing, so a page that already has the country says nothing at all.
- [x] The page keeps them. The world is deterministic, so a chunk is worth exactly one transfer
      ever: `idb-keyval` is already a dependency and the saves already live in IndexedDB. Keyed by
      **the world's own fingerprint** rather than by a version number anybody has to remember —
      generation changes, the fingerprint changes, every stale chunk becomes unreachable, and there
      is no invalidation to get wrong. This is the whole of why streaming is affordable: after the
      first visit a country costs nothing.
- [x] The chunk worker meshes what arrives, and grows ground only while the world is still
      answering. *(The fallback stays on purpose — a page that waited would stare at nothing every
      time a socket hiccupped, and on a first visit the world has a hundred and twenty-one chunks to
      grow before it can answer any of them. What was wrong is that it never went back: the page
      drew its own country, filed the world's answers for next time, and spent the whole visit on
      ground the world did not agree with. Late ground is now drawn over the top, and how much of
      the country is still the page's own guess is counted on `__stream` as `grown`. It was a
      hundred and twenty-one out of a hundred and twenty-one. It is nought.)*
- [x] **And the last of it: `grown` is nought on a cold world too.** *(Measured in a real headless
      page with a cold store and a cold world: the worst `grown` was 132 of 132 and it *stayed*
      there — the page drew its own country for the whole first visit and never found out. It is
      nought now, through a whole first view, and a second visit reads `kept 121, asked 0, grown 0`.
      A world answers a first view in under a millisecond where it took about 650 ms.

      Three changes. The join says where the hero is standing, so the world grows that view while
      it is still saying hello; `GroundWorld` keeps what it grows, where it used to regenerate a
      chunk on *every* asking; and the page waits — but only between the welcome and the world
      saying its country is grown.

      Two real bugs fell out of measuring it, both worse than the timing. `Online.wantChunks`
      silently dropped asks made before the welcome arrived while the streamer had already written
      them down as asked-for: 110 of 121 chunks the world was never told about, drawn by the page,
      never put right, for the whole visit — and it turned on which of two promises settled first,
      so it happened on some loads and not others. And `ChunkManager.unload` never decremented
      `grown`, so the one number that says whether the halves agree could not be believed when it
      was small.

      The cost, stated: a first visit to a new world has about two seconds more loading screen,
      because the page waits for the world's country rather than drawing its own. Overlapping the
      two sampler builds means sending the join before the country is grown, which is a reorder of
      all of `main.ts`.)*
- [x] **Structures too — or rather, everything the graph is a function of now travels.** *(The kind
      already did; the islands did not. Where islands hang is planned from the seed for a world made
      today, but an older save keeps its own in its manifest — so a server growing from the seed
      alone put the same houses in different fields. Islands are on the join now, and a second
      player whose islands differ is refused at the door with a reason, which is the rule the world
      kind already had. Plus `countryStamp`: the world hashes its graph and sends it with the
      welcome, so the page can *check* rather than assume. That stamp is the only cover the
      villages, doors and eyries get, since they still do not travel themselves.)*
- [x] **And then the generator has one caller.** *(There were two expressions that grew a world and
      they differed — the server grew road worlds without islands, `game/country.ts` grew them with.
      `src/world/growworld.ts` is the only place either generator is called now, and
      `growworld.test.ts` reads the source of `src/`, `server/` and `tools/` and fails if a second
      caller ever appears. That is the measurement rather than the intention: it currently returns
      exactly one file.

      And `twohalves.test.ts` was read again, as the item asked. It is deliberately demoted: it now
      guards the page's *fallback* generator — what happens when there is no world to be told by —
      and the head of the file says so.)*

## The endless world, in pieces

Weeks of work, so it is written down as units small enough to finish, each leaving the game
playable, and each with the thing that proves it. The order matters: everything below B2 is
downstream of B2 being true.

The rule the whole thing rests on, stated once: **a place's content is settled by a bounded
neighbourhood**. Never by a traversal, never by how you got there. Break it anywhere and that one
thing drags the whole world back into being generated from the middle outwards.

### B — the country

- [x] **B1. Points that do not care how you reached them.** `scattercells.ts`: space cut into cells,
      each hashing to candidates and ranks, a candidate standing unless a better one wants the same
      ground. Proven the same asked for cold, as a corner of something ten times bigger, in quarters
      in the wrong order, and after generating ground ten thousand tiles away.
- [x] **B2. A mesh from those points, and the seam test.** Faces from the local sites; a face
      computed from the east must be the face computed from the west, corner for corner. This is the
      unit that decides whether any of the rest is possible.
- [x] **B3. Roads and towns, locally.** A road is a border between two faces, so it belongs to the
      pair and both sides compute it identically. Towns at junctions, named from the pair-hash so a
      name is stable without a registry. *(Five wrong versions of the junction rule, each of them
      local but not symmetric — the lesson is written into `localroads.ts`. What holds: a junction
      is a triple of faces with an empty circumcircle, bounded by circumradius so that all three are
      certain to have looked at each other. Cells now remember which of their candidates stood, and
      countries remember their faces, which took the bench from 115 seconds to 2.5.)*
- [x] **B4. Provinces the server owns.** The unit of loading, simulating and persisting becomes the
      province rather than the world. Load when somebody is in it, flush and compact when nobody is.
      `GroundWorld.reach`/`keepOnly` and `Simulation`'s per-seed worlds are the shape to grow from.
- [x] **B5. Sea links.** A border between land and sea is a port; the link across it is a ferry
      rather than a road. Islands stop being special and become provinces reached by water.
      *(Ferries by mutual choice — a crossing exists only where two ports pick each other, which is
      symmetric where "the nearest port" is not. 989 ports and 194 crossings over twelve hundred
      tiles of coast.)*
- [x] **B6. The page stops growing its own country.** Chunks stream from the world and are kept in
      IndexedDB under the world's own fingerprint. Until this, an endless world cannot be handed
      over at a join. *(121 chunks asked for on a first visit and none on the second, live. Two
      traps: a batch assembled before the store had answered asked for nothing at all, and a page
      that meshes before the world has replied meshes ground it invented — so chunks wait a moment
      on arrival. The doorstep widened with it: a body stops further from a wall than a point did.)*
**B7. The radius comes off.** `GRAPH.RADIUS` stops meaning anything; the map becomes a local one;
distances, ferries, roaming bands and tidings all stop assuming a bounded world. Too big to do in
one go — the ground is grown by a `TerrainSampler` built once for a whole world, holding an index of
every road, every river, every village and every range there is — so it is cut into the pieces that
can each be finished and each leave the game playable.

- [x] **B7a. The sampler is built for a window.** It takes the patch of country it is being asked
      about and indexes only what reaches into it. The contract, and the test: a sampler windowed to
      a province paints every tile inside that province exactly as a sampler of the whole world
      does. That does not make generation bounded — it still grows the world and throws most of it
      away — but it says what bounded has to mean, and everything below keeps it true. *(The
      argument that a window is free is entirely in the margins: each thing is indexed under the
      ground it can paint, so a box that misses the window cannot answer anything asked from inside
      it. `window.ts` holds those, and the third test is the one that matters — it fails if a window
      ever stops pruning, which would make the first two vacuous.)*
- [x] **B7b. Roads and towns from the local country.** The window's roads come from `localroads`
      rather than from a `RoadGraph` grown to a radius. *(`localgraph.ts`. Three answers had to stop
      being global: where a road bends is hashed from the road's own name rather than drawn from one
      stream of numbers in a fixed order; how high a crossroads sits is read off a field slow enough
      that no road climbs more than a terrace, which is what smoothing along a spanning tree was
      for; and there is no spanning tree, so `parent`, `depth` and `size` are left at what a lone
      crossroads would have — the two things that read them, where a river rises and how big a
      village grows, are B7d and B7e.)*
- [x] **B7c. Land and high country, locally.** Face kind from `localmesh`; `highlandLift`'s flood
      over every mountain face in the world becomes a bounded one, capped, giving the same answer
      whichever face it starts from. *(`localland.ts`. Three of the bounded world's four rules are
      simply gone — no rim to drown, no islands placed by how far out they are, no middle to keep
      clear. The lakes only needed saying differently: a rule about the ground rather than about the
      order a list was walked in. And the flood is exact rather than approximate, because the ground
      stops rising after three faces, so a count that stops at three is the same number.)*
- [x] **B7d. Water, locally.** The hard one: a river today is a traversal from a spring to the sea,
      which is exactly what the rule forbids — and worse, each river is stopped by any water built
      *before it*, so a course depends on how many rivers the world happened to build first.
      *(`localwater.ts`. A spring is a property of a place, kept apart from its neighbours by the
      mutual-choice rule the ferries use. A river runs down the slope of the ground rather than
      along a road, so "never uphill" stops being a running minimum and becomes true by
      construction — and where the ground stops going down, the water stops, which is what a lake
      is. Where two rivers meet, the springs' own names decide which one ends. The cost is the
      gather: a river three hundred tiles long reaches into a patch from three hundred tiles
      outside it, which is why a local river is shorter than a world-sized one.)*
- [x] **B7e. Villages founded from their own names.** The road tree founds them by walking a list
      and drawing each from one stream of randomness, so a village's layout depends on its position
      in the walk — found the same town second instead of fifth and its houses stand somewhere else.
      A world can now be handed the places to build instead, and each village is drawn from the name
      of the place it stands on: the same order in any order, in any company, and alone. The road
      tree's own worlds are untouched, which matters because houses stand on saved ground.
      *(`structures.ts` grew past what one screen holds on the way, so the jetties, signposts, caves
      and wrecks — everything placed against the villages rather than among them — moved to
      `landmarks.ts`.)*
- [x] **B7e2/B7f. A sampler that stands in the endless country.** `endless.ts`: land from
      `localland`, roads from `localgraph`, water from `localwater`, villages founded from `townAt`.
      The mesh turned out to be asked only two questions by everything downstream — *is this dry* and
      *how high does the country stand* — so the join is an interface with two members. Two patches
      five hundred tiles across, overlapping by half, paint the ground they share tile for tile.
      *(Three faults found by that test, all the same fault: a thing at the edge of a patch judged
      against only what the patch could see. A junction can stand a face's width from the sites that
      make it, so a patch missed crossroads plainly inside it — `junctionsIn` gathers wider than it
      answers, and three call sites use it. The roads are held straight near a village, so a patch
      has to know about towns in its margin as well as its middle. And the drawing pinned the roads
      round `nodes[0]` as though it were the hub, which in a world with no middle is whichever
      crossroads sorted first — a graph now says whether it has a hub instead of assuming one.)*
- [x] **B7f2. The rock.** *(`localrock.ts`. Three things had to stop being global: a face's height
      came from a die rolled for every face in the world in id order, so a mountain's height depended
      on how many faces sorted before it; it was measured against the widest mountain face there is,
      so country added elsewhere made this mountain shorter; and a corner was held down by an array
      of the world's corners. Now a face's height comes from its own name, measured against the size
      a face of this country's spacing has, and a corner is a crossroads, which `junctionsIn`
      already answers locally. The subdivision needed nothing: a midpoint is displaced by a hash of
      the two ends of the side it sits on, written to close a seam inside one mountain, and it closes
      the seam between two patches for free.)*
- [x] **B7f3. Landmarks, locally.** *(`markThePlaces`. A crossroads is asked whether it holds a
      signpost, rather than being the eleventh node a shuffle reached, and nothing is counted: a
      patch with a great many cliffs has a great many caves. A signpost points at the towns within a
      day's walk, gathered from wider than the patch, or it is not raised at all. One rule had to
      change rather than move: a cave was "the first tile drawn as high ground", which does not
      carry over — the road tree's mountains lift a tile's own rise, so their flanks read as `High`,
      while a country made of polygons raises the base the tiles are measured from, so ground can
      stand fifteen terraces up and every tile of it still read as ordinary. A country of cliffs
      would have had no caves in it and nothing would have said so.)*
- [x] **B7f4. Ports and ferries in a drawn world.** *(`pairJetties` turned out never to have needed
      an island: it takes two bare points and finds the two facing beaches with clear water between
      them, so a crossing between two ports is the same question with the same answer, and a ferry
      line finds its two halves without learning a second vocabulary. What did need fixing was the
      reach — a ferry's range was written in face-widths, which is a sensible ferry in a country of
      small faces and eight hundred and sixty tiles in the country this game draws, three times the
      longest river and a search over three million tiles of water per port. A ferry is a distance,
      not a number of fields.)*
- [x] **B7g. And then the radius is deleted.** `GRAPH.RADIUS` out of `config.ts`; the whales, the
      sea test in `wild.ts`, the debug readout, the map's padding and the roaming bands stop
      measuring from the middle of a world that no longer has one. *(It survives as
      `EDGE_OF_THE_WORLD` in `graph.ts`, because a bounded world still has to be grown to
      something, and it is imported only by the three things entitled to say a world stops: the
      road tree, the polygon mesh and the web laid over it. The whales were the real work. Eighteen
      pods thrown at a ring of the radius until enough of them landed in deep water is a ring, a
      count and a search, and all three need a finished world; the sea is cut into squares now,
      each offering one family where its own name says, standing if the water there is deep and no
      better family wants the same stretch — twenty-odd in a world the size of the old one, and the
      same density in an ocean a thousand tiles from anywhere. The sea test in `wild.ts` was dead
      code and had always been: it could never return a point, because the line below it only hands
      back water the chunks already hold. The map's padding was the one that turned up a bug — the
      islands are anchored past where the mainland reaches, so a map padded to the radius ended at
      four hundred and eighty and never had them on it at all, and sizing it by the furthest road
      it is actually drawing put them on the map for the first time, at twice the pixels. The
      roaming bands, which this item said measure from the middle, do not: nothing in `roaming.ts`
      ever read a radius. What they assume is a count of bands and a shuffled deck of every stop in
      the world, which is the same shape of problem and a separate piece of work, because a band's
      id is in the save.)*

### The hero, as he is seen

- [x] **Armour is the hero, not a layer over him.** A worn piece names a part of him and the colour
      it becomes — iron on the chest means the chest is iron — rather than a box cut a hundredth of a
      unit proud of the body it hides. `worn.ts`. What is left as geometry is what is genuinely held:
      a sword, a shield, a lantern, a torch, and the skirt of a garment, which has to move.
- [x] **The shield is bigger than the man.** From the front it covers his chest and most of his
      face. It was cut for a figure seen from further away than this camera now stands. *(0.62 by
      0.46 is his hip to his collarbone and the full width of his shoulder beam — but the arithmetic
      was never the whole of it. A shield hangs a quarter of a unit nearer the camera than the man
      does, so perspective alone pushes its top edge up over his chin, and any size chosen by
      measuring the body will be wrong by that much. Three quarters as tall and three quarters as
      wide — half the area — and dropped so it rides the forearm rather than reaching for the
      shoulder.)*
- [x] **The arms are still bare in mail.** Right for a mail shirt, wrong for plate — which is an
      argument for the arms taking a palette entry too, when there is anything to put on them.
      *(Done as the trousers and boots were: `armTint` on `biped()`, a fifth colour in the hero's
      palette, and `worn.ts` naming which pieces take it. The palette entry is his own skin, so a
      hero wearing nothing is unchanged — which is what made this cheap. The hands had to go with
      the arms: a plated sleeve ending in a bare fist is the same half-a-suit the bare arms were.
      There was nothing to paint them with, so `plate` exists now — 340 gold, +6 guard, the only
      body piece that armours anything but the chest. Adding it turned up a limit in the turnaround
      sheet rather than in the game: a browser keeps about sixteen WebGL contexts, the sheet kept
      one per figure, and at four rows by four angles it was exactly at the limit — a fifth row and
      the page never finishes loading, with nothing logged. One renderer, blitted.)*

### Noticed while working, not yet chased

- [x] **The roaming bands stop counting the world.** They were the last thing in the game that
      assumed a world it could count: twenty-four per world, each dealt a ground off a shuffled deck
      of every stop there is. *(`grounds.ts`. A place holds a band because of what it is, and a band
      is named after the place it works out of rather than by a slot — which is what lets two people
      in different corners of a country agree that the pack at Stonemere is the pack at Stonemere.
      Two clauses had to be added because the plain rule was measurably wrong. Shuffling a deck
      spreads the grounds whether it means to or not; a hash asked of each place separately does
      not, and where names fall together a neighbourhood ended up with ten bands working it inside
      one five-day window against the eight one person can hold. And a village with nothing inside a
      band's circuit is a village no round can reach, so a village alone in its country keeps its
      own pack. Forcing every village to be a home was tried first and is what caused the ten;
      coverage belongs to the round instead — a band prefers the ground near it that nobody holds.
      A saved game loses its bands: ids that were numbers match no place, so those records lapse
      quietly and the country is rolled fresh.)*

- [x] **A web world's first village is at its hub, and it turns out it always was.** *(The item
      was written from reading the code and it was right about the code: `roadweb` rooted its
      spanning tree at the crossroads nearest the middle, and `generateStructures` founded
      Crossroads Town on `nodes[0]`, the lowest-numbered corner on dry land. Two different
      questions, two different answers, and nothing making them agree.

      Measured before changing anything, which is the part worth keeping: **they are the same node**
      — index nought, at the origin, on every seed tried. The web is laid out with a crossroads at
      the middle of the world and that crossroads sorts first, so the coincidence has held for as
      long as there has been a web. Nobody's village moves; the fingerprint does not budge; the
      fear that this would rewrite every saved world was unfounded.

      Done anyway, because a coincidence is not an answer. `graph.hub` is what the tree was rooted
      at now, and the hub town is built on `graph.nodes[graph.hub]` — so the day the web gains a
      node that sorts before the middle one, the town stays where the country radiates from instead
      of quietly moving to a corner.)*

- [x] **The suite times out when the machine is busy.** Five different tests have failed a full run
      and passed alone, and the failures are always `Test timed out in 60000ms` rather than a
      disagreement. Measured while a Rust build on another project held most of the cores: with
      `--maxWorkers=4` the same run is green. Vitest spawns one worker per file — a hundred and
      thirty-six of them — so a busy machine starves each of them below the sixty-second budget of
      the slowest test in it.
      *(Fixed: half the machine rather than all of it — measured, sixty-five seconds against
      seventy-nine, because past a point the workers only queue behind each other — one worker reused
      across files instead of a fresh environment for each of a hundred and thirty-six, and a budget
      of two minutes, which is a number only a genuine hang reaches. `isolate: false` is the first
      thing to turn off if a test ever starts passing alone and failing in company.)*

### C — the simulation, when there is more of it than a machine can hold

- [x] **C1. Measure first.** How many live agents will this hardware tick at ten a second, and how
      long does a cold province take to catch up on a week? `tools/ticks.ts`, run with `chore ticks`,
      which leaves `tick-report.txt` beside the other benches' reports. It is the processor's half of
      the pair `crowd.ts` opened: that one measures what a server sends, this one what it thinks.

      *The machine, because it matters: an M3 Pro, twelve cores, shared the whole time with another
      project's Rust build and five other agents. Load average was 13, then 65, then 27 across the
      three full runs these numbers come from, and the same rung came out up to 3.2x slower on its
      worst run than its best. Read the spread; the best run is a brochure.*

      ***Between 3,600 and 7,300 live agents at ten a second.** The factor of two is entirely the
      neighbours: 7,312 at load average 13, 5,500 at 65, 3,636 at 27. A fourth and shorter run agreed
      at 7,435 and went on to twenty-two thousand agents at 163ms a tick. Four thousand is the number
      to plan with on a machine that is shared. The figure that survives a
      change of hardware is **4 to 10µs per live agent per tick** — about 4 at a couple of hundred
      agents, 7 at a thousand, 12 at two thousand, 18 to 28 at three and a half. It rises with how
      thickly they stand rather than with how many there are, because three things in the tick are
      quadratic in the neighbours: the elbow pass in `contact.ts`, `EntityManager.within` (a linear
      scan, once per hunter per tick), and `tellAboutCreatures`, which walks every creature once for
      every client. Spread thin across many worlds it stays at 7 to 9µs all the way out to twenty-two
      thousand agents — so the ceiling is a budget being spent, not a structure giving way.*

      ***A cold province: there is no catch-up operation at all**, and saying so is half the finding.
      Nothing anywhere ticks a province with nobody in it — `Simulation.tick` closes an empty room
      and drops its ground and its creatures with it, and `SharedWorld.tick` moves the clock and
      stops. So the measurement is the nearest honest proxy, arriving and stepping forward, in the
      three parts arriving is made of: the terrain sampler is 150–650ms once per world, a province of
      1,024 chunks is 2 to 8.5 seconds of ground, and the leavings are 0.3–2.7ms for a hundred
      changes and 7–20ms for ten thousand. Reading a province is cheap. Ticking one is not: the
      country puts 2.1 creatures on a chunk, so a province holds about 2,150 of them, and a week of
      world is 50,400 seconds — **one to twelve hours of processor per province per week**, measured
      at 209 to 738 minutes packed as this bench packs them and about 55 minutes costed at the
      thinnest per-agent figure it saw anywhere.*

      *What that means for what follows, which is why the measuring came first:*

      - ***C2's closed form is not an optimisation, it is the only thing that reaches.** A
        province-sized population steps at 1.1x to 3.2x real time — the simulation is barely faster
        than living through it. Catching up a week inside a second wants fifty thousand times real
        time. Drop the coarse tier from ten ticks a second to one a minute, which is six hundred
        times fewer, and it is still twenty-five to seventy-five times too slow. Nothing short of a
        closed form gets there, and any coarse tier that is "the same code, less often" will not.*
      - ***The third tier does not exist yet, and it saves half of nothing.** An agent beyond
        `ACTIVE_RANGE` today costs 3 to 3.5µs a tick against 4 to 7.5µs live, because frozen means a
        skipped mind and not a skipped body: it is still in the separation sweep and still a row in
        what every client is told. Frozen has to mean off those lists, not off one branch inside
        them.*
      - ***The threshold that is obviously wrong is `Roster`'s four thousand.** It is a per-world cap
        and this laptop happens to run out of tick budget at about the same population, so today the
        cap and the hardware agree by coincidence. On a Pi the hardware will say four hundred while
        the cap goes on saying four thousand. It wants to become a budget rather than a number.*
      - ***C3 is cheap, and it should be done before C2 rather than after.** Reading a province's
        leavings is single-digit milliseconds, so a scheduled arrival costs nothing; what it removes
        is a walk across a border, which means two provinces live at once for as long as the walk
        lasts, and that is seconds of terrain either side. It is also what makes the closed form
        writable at all — a behaviour's long-run effect cannot be written down for an agent that
        might be in any province by the end of it.*
      - *A Raspberry Pi core is a guess: somewhere between four and eight times slower than one of
        these. Nobody has run `chore ticks` on the cluster. Run it there and that stops being a
        guess, and every number above moves by that one factor and nothing else.*
- [x] **C2. Three tiers.** Live where a player is; coarse where a province is loaded and nobody is
      watching; frozen otherwise. The rule that makes it work: a behaviour's long-run effect must
      have a closed form, so arriving somewhere untouched for a week is a calculation rather than a
      week of ticks.

      *The closed forms are written and checked. They are in `src/entities/unwatched.ts`, with
      `src/entities/timetable.ts` beside it reading the numbers back out of `behaviours/` so that
      there is one copy of each rather than two, and `unwatched.test.ts` running the simulation
      forward beside every form and holding it to what that form says it keeps. **The seam left for
      the tiers themselves is `catchUp(herd, away)`**: hand it a herd and how long nobody was
      looking and it is done. It reads no clock, no player list and no province, so whoever wires
      the tiers up decides when to call it and nothing else.*

      ***A week of a behaviour moves things and does nothing else**, and that was not the expected
      answer. The obvious expectation — a wolf pack thins a village over a fortnight, a hunter
      empties the woods — is wrong here, for three separate reasons, and each of them is worth
      knowing before anybody writes a coarse tier:*

      - ***Wild populations are not state, so predation has nothing to write into.** A chunk's
        animals are re-derived from the world seed every time it is spawned —
        `mulberry32(hash3(seed, cx, cz, HERD_CHUNK))` in `ChunkManager.spawnChunk`. Kill a rabbit,
        walk away, come back, and the roll is the same roll. A closed form that reduced a population
        would be reducing something that does not exist and would be silently undone by the next
        spawn. It is a real gap — see the note below — but it is not one to paper over here.*
      - ***A village's dead are already somebody else's closed form.** `game/rescue.ts` says what a
        pack or a haunt takes out of a village per night, as a share of who is left, and
        `game/nemesis.ts` says what Old Nettle costs a village per fortnight. Both are closed forms
        already, written a layer up where the register lives. A second toll at the behaviour layer
        would be the same deaths counted twice, which is worse than no toll at all.*
      - ***Purses, meals and births are the register's day, not a creature's week.*
        `game/economy.bench.ts` already lives villages forward a hundred days a day at a time out of
        the books, so a villager's earnings over an unwatched week are accounted for there.*

      *Which leaves the behaviour layer owning exactly what it should: where a thing is, whether it
      is indoors, and — for a third of the bestiary — nothing whatever. **The coarse tier's job is
      to place creatures, not to simulate them.** Twenty-three trees came out as four forms:*

      - ***`staysPut`, and it is a result rather than a shrug.** `seaHunter`, `wight`, `hired`,
        `nettle`. A shark's tree is `not afloat -> idle`, a wight's own note says it "stands exactly
        where it was left", and both were run for an hour with nobody about and finished on the
        coordinates they started on to the last decimal. Nettle's fortnight is `nemesis.ts`'s, and a
        hired sword away from whoever hired it is a dismissal rather than a walk. **These four are
        free to freeze permanently**, not merely cheaply — which is the third tier the C1
        measurement said does not exist yet.*
      - ***`driftsInRange`.** `grazer`, `traveller`, `hopper`, `swimmer`, `prowler`, `monster`,
        `ogre`. The herd anchor's random walk, solved: `min(leash, drift * sqrt(seconds / gap))`,
        drawn evenly over the area of that disc, with the creature offset by the same law
        `somewhereNear` uses. The measurement that makes it work is that **a herd forgets where it
        started in under a minute** — the anchor's mean displacement on a twelve-tile leash is 5.0
        tiles after five seconds and flat at 7.0–8.0 from about sixty onwards — so a week and a
        minute are the same answer and nothing gets harder as the absence gets longer.*
      - ***`ridesItsCircle`, which is exact.** `flier`. `patrol` is an integration and not a
        decision, so a week of it is `angle + seconds * speed / radius` written without the loop. An
        hour of ticks at thirty a second and one call to the form land 8e-9 tiles apart.*
      - ***`keepsItsHours`, which is also exact.** The wanderer and the ten trades that have hours.
        A day of `hourBetween` guards over `goTo`s has no randomness in it at all, so at any hour the
        file says which post somebody is standing at — and the form reads it out of the same file
        rather than transcribing it. This is the one a player would notice: walking into a village
        at three in the morning after a fortnight away and finding everybody standing in the street
        is the loudest possible way of announcing that nobody was home while you were gone.*

      *The comparison tests are the deliverable as much as the forms. `LONG_RUN` is held to
      `allTrees()` in both directions, the way `world/catalogue.test.ts` holds the catalogue to the
      prop library, so a new tree with no long-run twin is a failed build with a sentence saying what
      to write; a tree filed as one that ranges with no `wander` left in it is the same. Beside that,
      the simulation is run forward and compared on what each form claims: distance from home over
      288 creatures (the form says 0.96 of what the ticks say, and no kind is out by more than a
      seventh), containment inside `leash + 0.5 + range`, the herd still standing together, the
      count unchanged, the eagle's circle to floating point, the shark and the wight not moving, and
      every trade behind its own door at three in the morning.*

      *Three things found on the way that belong to somebody else:*

      - ***A flier's altitude is a bug, and it is why `y` has no closed form.** `patrol` pulls a bird
        up towards `altitude` at `dt * 2` a tick while the ground-following at the bottom of
        `updateEntity` pulls it back down at `dt * 12`. What it settles at is the fixed point of two
        filters fighting, which means it **depends on the tick length**: an eagle with an altitude of
        9 sits at 1.85 above ground of height 1, so the eagles are not up in the air at all. The
        closed form deliberately leaves `y` alone rather than inventing a value for a quantity that
        does not have a time-independent one.*
      - ***Nothing anywhere can record that the rabbits are gone.** Wild populations being re-rolled
        per chunk is fine while the only thing that removes an animal is a player standing there, and
        it stops being fine the moment a coarse tier lets a hunter work a province for a week. If
        that is ever wanted it has to go into the live simulation first — a per-chunk or per-province
        count of what has been taken, in the leavings — and the closed form gets a second term
        afterwards. Faking it here would have been a number written into a book that does not exist.*
      - *`WANDER_RADIUS` in `entities/entity.ts` is dead: declared, never read. The radii that decide
        anything are in `behaviours/`, which is where `timetable.ts` reads them from.*
- [x] **C2a. The tiers themselves.** The half of C2 that is left, and it wants C3 first. Which
      province is live, which is coarse and which is frozen; who calls `catchUp` and when; and the
      two things the C1 measurement said about the ends of the range — that frozen has to mean off
      the separation sweep and off what every client is told rather than off one branch inside them,
      and that `Roster`'s four thousand wants to become a budget rather than a number.

      *`src/entities/tiers.ts` sorts everything the world is holding once a step and hands the lists
      to the passes that used to each build their own. That is the whole change, and the three tiers
      are what the lists are:*

      - ***Live** is `ACTIVE_RANGE` and is deliberately untouched.* The same per-creature test in
        the same order as before, so a creature a player is looking at behaves exactly as it did
        yesterday. Nothing about C2 is allowed to be visible, and this is where that is spent.
      - ***Coarse** is the band out to a new `WATCH_RANGE` of 72 tiles.* Nobody thinks for it, so it
        does not move; it is still described to whoever can see it, because a player is told about
        creatures sixty tiles off and the world only thinks for them at forty-four, and a tier that
        forgot that would blink a deer out in front of somebody watching it. **This is the tier that
        is not a slower tick.** Nothing is stepped at any rate at all.
      - ***Frozen** is past that — or, far more often, not in the world at all,* because the manager
        has let the chunk go or the whole province is a file on a disk. It is now off the separation
        sweep and off the walk that says what each player can see, which is what C1 said a third
        tier has to be. **A frozen agent went from 0.73µs a tick to 0.03µs**, which is not a
        discount any more.

      ***The catch-up does not go where the three pieces suggest, and that is the finding.***
      `catchUp`, `homelandsOf` and `SharedWorld.asleep` read as "when a province wakes, gather its
      herds and catch them all up". They cannot be wired that way. A province is read off the disk
      when somebody comes within `KEEP_READY` — 144 tiles — and its chunks are not spawned until
      they are within `SPAWN_RADIUS`, 64 tiles, **so at the moment a province wakes it has no herds
      yet**; and sweeping for them afterwards is a walk over every creature in the world on every
      tick for ever, which is precisely the standing cost C1 says a coarse tier must not have. It
      goes where a herd is *born* instead — `EntityManager.spawnAround`, one line, `sleptFor` on the
      manager answered by `SharedWorld.asleep(provinceOfHome(herd))`. That needs no memory of what
      has already been dealt with, costs nothing at all when nothing has slept, and has the property
      no sweep could have: **a herd is put where the week would have left it before a single player
      has been told it exists**, so nothing anybody could see ever moves.

      *Which is also why a creature that merely goes past `WATCH_RANGE` while somebody walks off is
      left exactly where it was rather than caught up when they walk back. It could have been done
      and it would have been wrong: the world is holding that creature the whole time and a page
      draws every creature its own manager has spawned, so putting it somewhere new is putting it
      somewhere new in front of somebody. The only absence it is safe to account for is the one
      nothing could have been drawing during, and a province file is exactly the measure of that.*

      ***A province with nothing in it was never written down, and a province's creatures are not
      among its leavings.*** `writeProvince` wrote a square only if somebody had changed something
      in it, which is right for leavings and wrong for time: animals are re-rolled from the seed
      every time a chunk is spawned, so a square of empty hills has nothing to write and a whole
      week of grazing to account for. Without a stamp on it, every deer outside a worked field would
      have been handed back standing on the spot it was founded on however long anybody had been
      gone — which is most of the world. It is stamped now, rows or no rows: a few dozen bytes
      saying when somebody was last near.

      ***The measurement, and the honest half of it is that one number in the report means anything
      and the rest measures the neighbours.*** Two pairs of `chore ticks` runs: one seventeen
      minutes apart at load averages 13.5 and 14.2, and one taken back to back with the work checked
      out and put back again, at 14.6 and 10.7.

      - **The isolated figure, which is the one this change is about, and it agrees with itself.**
        2,056 creatures put down beyond the active range on ground the world is still holding used
        to add **1.51ms to every tick and now add 0.06ms** — 0.73µs an agent against 0.03µs, with a
        live one at 3.1 to 3.5µs. Both pairs give the same two figures to the digit. It is a
        difference taken *inside* one run, with and without the frozen creatures, which is why it
        survives a machine this contended when nothing else does. **Frozen now costs about what a
        thing that is not there costs**, which is the twenty-fourfold cut C1 said was sitting in
        those two lists.
      - **The ladders say opposite things in the two pairs, and that is a finding rather than a
        failure.** One player a world, spread out: 8.3–9.8µs an agent before and 7.4–8.4 after in
        the first pair — and 6.4–7.9 before against 8.5–10.1 after in the second, whose unchanged
        run was the fastest thing this laptop produced all night and whose changed run reported 1.8x
        between its own best and worst. Holding 7,320 live agents cost 88.3ms then 81.0ms in one
        pair and 91.1ms then 94.3ms in the other. **The changed code came out both the best run and
        the worst**, exactly as C3 found for its own change and for the same reason.
      - **The crowded ladder is the one place both pairs agree on a whole-tick number, and it is
        small.** Everything there is inside `ACTIVE_RANGE`, so there is nothing to freeze and the
        only saving is the walk the sweep no longer makes to build its own list: 5 to 15 per cent
        off every rung but the topmost, in both pairs. Which is the right shape for the claim being
        made — the tiers do not make a crowd cheaper, they make the country around it free.

      ***What a player would notice, said honestly.*** Two things changed that are not strictly
      nothing. A herd nobody is thinking for no longer has its members elbowed apart or its anchor
      drifted — both were moving creatures that are otherwise motionless, forty-four tiles or more
      away, and a herd only comes to overlap while it is being thought for, so it is already apart
      by the time it stops. And a village walked into after a week away now has its people at the
      posts the hour says rather than at the doors they were founded on, which is the one thing C2's
      closed forms said a player *would* notice and is the whole point of the exercise.

      ***Left, and both deliberately.*** `Roster`'s four thousand is not touched: it is C2b below,
      with the reasoning, because this change moved what a budget would have to count rather than
      leaving it where C1 found it. And `EntityManager.within` is the third of C1's three quadratics
      and is still a scan over everything — it is called once a step per hunter rather than once a
      step per player, so it is the smallest of the three, and the reason it is hard (a creature is
      not bound to the chunk it was spawned from, and a hub villager stands seventy-six tiles from
      his) is written down in `src/entities/neighbours.ts` beside it rather than left to be found
      again.
- [x] **C2b. A budget rather than a number.** *(The question C1 left open was a question about the
      game, and it was put and answered: **how many creatures exist is the world's business, and how
      many are thought for is the machine's.** Two players standing in one field must see the same
      deer — that is the whole reason the world owns the wildlife — so nothing may depend on the
      hardware except how much of it any one machine thinks about.

      `pace.ts` times the live pass and moves a budget to fit a fifth of a tick. A share rather
      than a number of milliseconds, because a server ticks ten times a second and a page draws
      sixty and neither should have to know what the other does. `Tiers.sort` then keeps the nearest
      that fit and hands the rest to the coarse tier — by distance, so what a player is looking at
      is always what is being thought for, and a creature shed here is one that was about to be
      walked by the closed forms a few tiles further out anyway. Nothing is despawned, nothing is
      refused, and `watched` — what a player can be told about — is untouched.

      Three things the numbers had to be chosen against. It eases at eight per cent a tick in both
      directions, because a budget that drops the instant one tick runs long drops on the frame that
      meshed a chunk, and one that climbs quickly oscillates and makes the far edge of the band
      twitch between thinking and not. It never goes below sixty, which is about what stands round
      you in a busy village. And it is charged per creature rather than as a ratio of the whole
      tick, so a frame that ran long for some other reason does not shed creatures that were never
      the problem.

      The test found the fault worth keeping: a clock that reports nought was being read as a
      machine of infinite speed, so the budget climbed to its ceiling and handed the whole world to
      the live tier — which is exactly what a throttled background tab or a `Date.now` with a
      millisecond of resolution actually reports. A measurement of nought is a clock that cannot
      see, and the right thing to do with it is nothing.

      `Roster`'s four thousand stays, re-documented as what it should always have been: a ceiling
      saying a world holding that many has gone wrong, rather than a decision about how busy a world
      ought to be. Its own old complaint — that refusing a spawn part way through a herd leaves a
      flock of two where the world meant eight — is written down and not fixed, because at four
      thousand it is unreachable in play and the honest fix is for a herd to be admitted or refused
      whole.)*

- [x] **C3. Agents belong to one province.** Travel between them is a scheduled arrival, never a
      simulated walk, because that is the only thing that keeps provinces independent.

      ***The rule is one line and the whole of C3 is the line: an agent's province is
      `provinceOf(herd.homeX, herd.homeZ)`, and never `provinceOf(e.x, e.z)`.*** A herd's home is
      `readonly` on the class, set by the constructor and never assigned again, so the answer cannot
      change under anybody and there is nothing to keep in step. `provinceOfHome` in
      `src/world/provinces.ts` is that, `homelandsOf` in `src/entities/homeland.ts` gathers a
      manager's herds under it, and `SharedWorld.asleep(id)` says how long nobody was looking. Those
      three and `catchUp(herd, away)` are the four things a coarse tier needs, and none of them
      knows about the others.

      ***Nothing in this game walks between provinces, and that is structural rather than lucky.***
      Every herd has a leash, `updateHerd` refuses any step that would cross it, and `spreadAfter`
      in `unwatched.ts` saturates at the same leash — so the closed forms cannot take an agent out
      of its province either, which is what makes them writable. The audit that matters is what was
      found on the other side of the line, because three of the four things that look like agents
      turn out not to be province-resident at all:

      - **A roaming band was already a scheduled arrival, and was before C3 was written.**
        `bandAt(band, day)` is pure in the band and the day; `watch.ts` stands a pack up wherever it
        says the band is when the hero comes within `ROAM.SIGHT` and takes it away when he leaves.
        Nobody simulates the walk between stops and nobody synchronises one. The pattern C3 asks for
        is `game/roaming.ts`, and it wanted no changes.
      - **A dungeon floor is not in any province, and this is the trap worth naming.** Its
        coordinates are its own, so `provinceOf(e.x, e.z)` answers cheerfully and files a rat on the
        third floor under whatever open field shares its numbers. So the question is asked of the
        *filing* — the manager already keys what it holds by chunk or by place — and only the
        chunk-keyed lists have a province. Sea packs, mine crews and bands are excluded by the same
        rule and for the same reason: each is placed when somebody arrives and taken away when they
        leave, so none has an absence to account for.
      - **The hero is excluded because he is watched.** He genuinely walks, borders included, and
        `keepNear` deliberately holds both provinces around him while he does. Being in two at once
        is what being looked at costs, and it is affordable because there are a handful of players
        and thousands of everything else.

      ***A player crossing a border sees nothing, and the reason is one inequality:*** `ACTIVE_RANGE
      + PROVINCE_REACH <= KEEP_READY`, which today is 44 + 96 ≤ 144. `PROVINCE_REACH` is how far
      outside its own square an agent may stand, and the window it has to sit in turned out to be
      narrow at both ends. The floor is 76 — a hub villager's posts stand out to 1.9 village radii
      of 26 and he ranges another 26 about whichever one the hour left him at, measured through the
      real `postsOf` over a real country rather than copied out of it. The ceiling is 100, which is
      `KEEP_READY` less `ACTIVE_RANGE`: any creature a player can be told about may be that far the
      wrong side of its own line, and its province has to have been read before it comes into view.
      96 is six chunks, with twenty tiles of room at the bottom and four at the top. Both ends are
      tests rather than assertions, so widening a village or telling a player about creatures further
      off is a failed build.

      ***The measurement, and the machine was hopeless.*** Four `chore ticks` runs, and the honest
      finding is that they measure the neighbours rather than the change. In order: unchanged at
      load average 9.5, holding 3,644 live agents at ten a second (72.7ms p95) at 3.9–31.7µs an
      agent. Changed at load 25, *missing* at 1,803 — a qemu at 101% and somebody else's Rust build.
      Then, to get a pair worth comparing, the work was stashed and the two run back to back:
      unchanged at load 20, holding 7,322 (98.9ms) at 4.7–18.2µs, and changed at load 17, holding
      10,973 (81.4ms) at 3.7–17.7µs. **The changed code came out both the worst run and the best
      one**, and the ordering follows the load and nothing else. The rung that is least sensitive to
      neighbours — 58 agents, one player — reads 4.1, 4.2, 4.7 and 4.2µs across the four, which is
      flat.

      *Which is what should have been expected, and the reason is worth writing down rather than
      leaving to the numbers: **nothing was added to the tick at all**. `provinceOfHome` is a floor
      and a string, called when somebody asks a question and never inside a step. The only per-tick
      change is that `keepNear` moved out of the block that grows terrain, and it was already being
      called from inside it. C1 said a scheduled arrival would cost nothing because reading a
      province is single-digit milliseconds; it costs less than that, because there is no arrival to
      schedule until something moves.*

      *Two things were found and fixed on the way, and both were latent rather than theoretical.*
      *`keepNear` was called only when the host grows the ground — both hosts pass `ground: true`
      today, which is exactly how a coupling like that goes years unnoticed — so a world that held
      state without holding terrain would never have let go of a province. And a province was
      written only when its rows had changed, which meant one put away on day 9, walked through on
      day 10 and put away again still said day 9, and the next arrival would have been handed a week
      nobody was away for. It is rewritten on the way out now even when the rows are the same rows.*

      *`Register.compact` is called from `keepNear`, once, when the last province of a pass is let
      go — not inside `writeProvince`, because a register is the world's rather than a province's
      and compacting it per square walked out of is the same pass over the villages repeated. The
      register is a sixth constructor argument and is null on every path today: villagers are still
      client-derived, which is C5's to move, and this is the hook waiting for it.*

      *Left for C2a: everything about **when**. Which province is live, coarse or frozen, and who
      calls `catchUp` — the three pieces are on the table and nothing puts them together. Left for
      C5: a register to hand `SharedWorld`, at which point the compaction hook stops being a hook.
      Left alone deliberately: `Wildlife` still spawns and drops creatures by distance from a
      player and knows nothing about provinces, which is right — a province decides who accounts for
      a herd's week, not whether it is standing in the world this second.*
- [x] **C4. Memory that compacts.** Bounded per villager, decaying, and summarised on unload — ten
      slights become one opinion. Otherwise per-province state grows with the world again.
      *(`src/world/memory.ts`. The bound was already there and it was the wrong kind: a villager
      held the last two things that happened to him and the third took the first away, so ten
      slights became no opinion at all, which is a man forgetting a grudge he obviously still has.
      An opinion per name now stands beside that list — how he feels, how many things went into it,
      and the one that struck hardest kept whole — and it is formed when the thing happens rather
      than when the memory is pushed out, so nothing is lost by the list being short and nothing
      has to be marked as already counted. Eight names: the five neighbours `LIFE.KNOWS` gives him
      and three for whoever is passing through. Fading is three quarters a day on the hundred-point
      scale `standing.ts` uses, which spends the strongest feeling there is in four months and one
      kindness in a fortnight — slower than a village letting a grudge go, because that is a place
      going off the boil about a cow and this is one man's view of another. One thing does not
      fade, a death, and it is exempt from fading and from nothing else: a bound with an exception
      in it is not a bound, and it is safe not to be, since the parish already keeps sixty stones.
      The bound holds without anybody unloading anything — a hundred thousand things happening to
      one village writes the same twenty kilobytes as two thousand do — so compaction on unload is
      what makes the file shrink again rather than what stops it growing.*
      *What the audit found is worth more than the mechanism. A villager records six things — a
      death, a birth, a rescue, a robbery on the road, a gift, a bad day down a mine — and only two
      are about the player at all. There is no word in that vocabulary for "you killed my brother":
      what the player does wrong lands on `game/standing.ts` and `game/grudge.ts`, which are the
      **player's own save**, so a village's opinion of you is currently kept by you. And no villager
      has ever been written to a save anywhere, so there is nothing to migrate and no old world to
      open differently. The negative half of the weight table has one entry in it, dread of a mine,
      and that is the state of the game rather than an oversight — the shape is here for C5 to
      fill. `Register.compact(day)` is the hook a province's unload wants; `server/world.ts` has no
      register to call it with yet.)*
- [x] **C5. Villagers move to the server.** *(They were client-derived, which worked only because
      they had no private state — and that stopped being true the night they were given opinions,
      purses and memory. Two clients would have disagreed about what a villager recalls.

      A villager travels as an ordinary creature snapshot plus one optional block: register id,
      name, trade, role, village, the trades the village was founded on, and his whole mind. Sent
      once and re-sent only when it changes, and the measurement is why: identity over five seconds
      in a village is 1.4 kB, against 60.2 kB if it rode on every snapshot. Standing in a village
      costs 11.4 kB/s and 11% of a core; open country costs more, because there are more animals in
      it. Three new messages — a memory made on a client and taken by the world's register, a hired
      man leaving, an arrest by a world-owned constable.

      **The finding worth keeping: the two halves founded the same village differently.** A
      village's trades are read off the land around it, and how much land you can see depends on
      how much you have grown — the world holds seven chunks round a player and a page holds a
      hundred and twenty-one. The founding *rolls off that list*, so the same twenty-five people
      came out doing different jobs on the two machines. The world says which trades it founded on
      now, and the page re-founds from them.

      Two more fell out of measuring it: a death a client reported never reached the world's book —
      it was only ever a log row, so a man a roaming band killed was still being put out at the
      well — and a world that went quiet handed back an empty countryside, because forgetting the
      wildlife emptied the chunk lists but kept the keys, so the page believed it had already
      populated them.

      Three files came out to pay for the length cap, and all three are real seams: `wilds.ts` (what
      a square of open country has living on it — the third sibling of `street.ts` and
      `paddocks.ts`), `heard.ts` (the switch over every kind of message the world sends, which is a
      different job from carrying the words), and `folk.ts` gaining the acts that make a memory.

      Named and not fixed: a mine's crew is still client-side; band pressure is told only to the
      page's register, and sending it would be lossy by construction because it is dated to one
      day — the real answer is bands and mines crossing too; the world's register is not persisted,
      so what a villager recalls about a player is lost across a restart; and a told villager
      arrives with no posts.)*

### A — the records, which are how any of the above is checked

- [x] **A1. The books.** The roll, the stones, the charge sheet and the births, as rows first and
      sentences second, with `__records` to read them without walking anywhere.
- [x] **A2. The church reads its own stones**, and the apothecary its births: free gist, paid detail.
      *(`src/game/enquiry.ts` is the counter the books are read across, and it turned out to belong
      to the building rather than to the keeper: `booksKeptIn` is handed the kind of room the hero
      is standing in and nothing else, so a town hall and a watch house are one line each and no
      other change. The keeper does not have to be a shopkeeper — a priest is a congregation member
      stood at an altar — so the rows are built once and fitted into both a shop counter and a
      chapel greeting. The fee buys a sitting rather than a subscription: it lasts as long as the
      conversation, because remembering it would mean a save carrying "has read the stones of
      Elderton" per village per book for ever. The book is read out three lines to a page, since
      the panel types at fifty-five characters a second and does not scroll.)*
- [x] **A3. A town hall**, which does not exist yet: structure kind, geometry, placement by the
      square, interior, a clerk, and the roll.
- [x] **A4. A watch house**, the same, with the charge sheet fed by the gaol. *(Found already
      standing: the structure, its placement beside the square, the interior with its cell and its
      counter, the sergeant behind the desk and `theCharges` read across it were all built the night
      the town hall was, and the ledger simply never caught up. Verified by walking into the one at
      Crossroads Town rather than by reading the code, which is the only way that answer is worth
      anything.

      What was missing was the man. Every keeper of a building — the sergeant, the town hall's
      clerk, the priest at the altar — was drawn as a `shopkeeper`, which is a sergeant nobody can
      tell from a grocer. They are drawn as their trade now: the constable's body for the sergeant,
      the mayor's for the clerk (that body was made for a town hall), the priest's for the priest.
      `placeKeeper` works the trade out *before* it builds the entity, because `Entity.kind` is
      readonly and the renderer pools by it — the same order `spawnVillageFolk` had to be put into
      for the same reason. `clerk` and `sergeant` are in `BODIES` although no register ever hands
      them out, because they are jobs a building has rather than trades a person is born to.)*
- [x] **A3, in full: what a town hall actually cost.** *(Filed under A5's heading by mistake for a
      day, which is how a work list gets two entries with one number on them.)*
      *(A2 was right that the counter cost one `case` and nothing else; what a new building costs is
      the other eleven places a kind has to be known about, which `grep -rn Church src` lists
      exactly. The awkward one was placement. A hall wants three flat tiles on the edge of the
      square, and by the time eight cottages and their door paths are threaded round it there is
      nowhere left — held to the chapel's rule, three towns in four came out with no hall, for want
      of anywhere rather than for want of people. Laying it before the houses fixes that and breaks
      the threshold, because how many people live here is not known until they are standing there;
      it also ate house sites, so towns dropped below the threshold they had just been given the
      ground for. What works is to let it search harder than the chapel: the whole ring at fifteen
      degrees, three distances out from the cobbles tried nearest first, and one terrace of give,
      which is a stride. Eight houses, because below that the roll is a list of names you could get
      by asking anybody in the street — and the small villages are capped at six, so a hamlet
      cannot reach it however the ground falls. The buildings draw nothing from the random stream,
      which is what let the whole change be checked: set the threshold impossibly high and the
      golden hashes come back to the digit. And from the top of an isometric camera a hall is a
      cottage drawn slightly bigger, which is invisible — what makes it findable is a slate roof
      and a bell-cote deliberately too big for the building under it. `world/civic.ts` came out of
      `structures.ts` for the square's buildings, chapel included, when the file went past 700.)*
- [x] **A4. A watch house**, the same, with the charge sheet fed by the gaol.
      *(The sheet had no source: `theCharges` took rows nothing in the game wrote. It is written in
      `Jail.commit`, which is the one call every arrest in the world goes through — the constable
      taking the hero and a village putting its own villain away are the same line — so there is no
      second list to forget to add to. A cell forgets a prisoner the moment their hour comes, and
      the sheet is the half that does not; it is bounded per village for the reason the churchyard
      is. It is also the one village book that is not the register read from another angle, so
      `booksKeptIn` had to be handed it from outside along with whether the law currently wants the
      person asking — which is what makes "yours is one of them" mean anything. A village only
      raises one once it already keeps a cell, so no sergeant anywhere has nothing to write about.
      Inside, the cell is the back corner of the same room behind iron rather than behind a wall: a
      lock-up you cannot see into is a cupboard.)*
- [x] **A5. `chore economy`.** Live a village forward a hundred days and hold the books to it:
      purses move, nobody ages backwards, every death is written down, a village under pressure gets
      poorer and one left alone does not. The economy has never been checked end to end.
      *(Seven villages on three seeds, a hundred days each: 2,100 village-days and 30,337
      people-days, audited to the coin. It judges by the books and never by the simulation — it
      reads `theRoll`, `theStones` and `theBirths`, the same rows a player pays a clerk for, and
      imports nothing from `prosperity.ts` or `food.ts` — so it cannot be right by construction.
      Proved by breaking one column on purpose: 1,927 of the 2,100 days went red and named the
      village, the day and the amount. `src/game/economy.bench.ts` stands the villages up and lives
      them, `src/game/economy.test.ts` audits them, `economy-report.txt` is what it leaves behind.
      It found four things. Two were bugs and are fixed. **A pressing never lifted**: nothing in
      the world ever says a band has gone — `roaming.pressings` returns the villages one is
      standing over and says nothing about the rest — so one morning's band meant a village that
      never earned or farmed again. Thornby was empty by its fiftieth day with twenty-one of its
      twenty-seven stones reading starved, and because `settle` relives a village from its founding,
      walking into a village a band happened to be near re-lived all forty of its days under
      today's siege: sixteen graves and nobody alive, on arrival. A pressing is now dated and is
      about one day, the one the register lives next. **And the biggest outgoing in a villager's
      life was in no book anywhere**: the roll declared a farmer taking 1.5 and spending 0.8, which
      reads as a saver, and every one of them was 0.3 a day worse off, because dinner was nowhere
      in the ledger. The roll now has its own `food` and `hungry` columns, keeps purses to the coin
      instead of rounding them, and asks the register what pressure a village is under rather than
      waiting to be told. The other two are below, because they are decisions rather than
      mistakes.)*
- [x] **A6. Ten of the eleven trades in the game are paid the same subsistence floor.**
      `PROSPER.TRADERS` names shopkeeper, innkeeper, smith, apothecary and merchant; the trades a
      villager can actually hold are seller, farmer, hunter, soldier, sailor, miner, climber,
      explorer, constable, doctor and innkeeper. Four of the five higher-paid names do not exist,
      so the only villager in the world who earns above the floor is an innkeeper, and there is at
      most one of him. Either the set should name the trades that serve everybody else — seller,
      innkeeper, doctor — or the wage should stop pretending to have a shape. A balance decision,
      which is why the bench reports it and does not assert it.
      *(The set names seller, innkeeper and doctor now. The other way — one flat wage — was
      rejected because it makes every village the same place with a different name: what a village
      *has*, a market and an inn and a doctor's door, should be why one of them ends the season
      with a bath house and the one on the rock does not, and that is a reason to walk to one
      rather than another. It turns out to matter more than a wage table looks: three against two
      is half again the wage but two and a half times the *saving*, once dinner and upkeep are out,
      so who a village raises decides what it can build. And the coastal village, whose trade pool
      is half sellers and doctors because it has no fields, is now reliably the richest place per
      head and the hungriest — which nobody designed and everybody would recognise. Named as
      trades rather than as buildings, and `prosperity.test.ts` now holds every name in the set to
      the list a villager is actually drawn from, so it cannot rot this way twice.)*
- [x] **A7. A village left alone flatlines at 6.5 gold a head, and nothing it earns buys anything.**
      Not bad luck: it is a fixed point. A day pays 1.5, dinner takes 1, and upkeep takes what is
      left above `KEEPS_BACK`, so every working purse converges on 6.5 and stays there — measured,
      the middle villager in each control village held exactly 6.5 for the last 87 of a hundred
      days. A second storey costs 340 a head and the best village managed 33; a sauna costs 3,400
      and the best village between them held 528. So `storeysFor` and `luxuryFor` have never once
      returned anything but the floor, and the whole point of villagers having purses — that the
      economy should change the world and not only your pocket — has never happened. Found beside
      it, and worth fixing whatever is decided about the numbers: **the wealth-to-buildings step is
      wired inside the warband loop.** `tidings.ts` only calls `storeysFor` and `luxuryFor` for
      villages `roaming.pressings` hands back, so a village nobody is raiding is never assessed at
      all, and a village that got rich in peace could not grow a storey if it wanted to.
      *(The wiring first, on its own, because it was a plain bug: assessing a village is its own
      step now, over every village the register knows about, gated on the day and on the number of
      villages — a place is settled the moment you walk into it, and one first assessed tomorrow
      builds its houses a storey short all afternoon. Then the arithmetic. The fixed point was
      upkeep: at 0.8 against a wage of 1.5 an ordinary day cost three tenths more than it paid, so
      the only thing between a village and starvation was `KEEPS_BACK` — which stops the spending
      as a purse runs down and therefore hands the day back exactly the shortfall. The reserve that
      stopped a man starving was also the ceiling on what he could ever hold. Upkeep is 0.3 and the
      day pays 2, so a day is worth having; the rule to keep is that upkeep must stay under
      `A_DAY` minus a meal, and `prosperity.test.ts` lives a purse forward a hundred days to say so.
      The prices were quoted in a currency no villager could hold — 340 a head is most of the price
      of a whole house, and a villager earns two a day and dies inside ninety — so a storey is now
      35 a head and a bath house 800 between the village, both measured off the bench rather than
      picked. Both ends were walked into: at 30 a head, nineteen of the bench's twenty-one villages
      ended two storeys tall, and a mark every village earns is not a mark; at 40 only four crossed
      and all of them in the last five days, which is a number balanced on a knife. What a hundred
      days looks like now: the middle working villager in an untroubled village holds 16 to 18 at
      three weeks, 33 to 37 at fifty days and 24 to 45 at a hundred, never twice the same; five of
      the nine untroubled villages raise second storeys, between day 31 and day 101; five of the
      twenty-one hold enough between them for a bath house, and the plain inland control never does
      on any seed. A village under a band loses about half of itself and makes it back. The books
      still balance to the coin across 2,100 village-days, and the bench now fails if nothing in
      the world ever gets built.)*


### What the hundred days said, that nothing acts on yet

The audit passes, which means the books are honest. What it *reports* is a different thing, and two
of the notes are the game rather than the arithmetic:

- [x] **A purse no longer goes into the ground with its owner.** *(Asked, and answered: the family
      inherits, and where nobody of the name is left the village shares it out. 18,617 gold used to
      be buried over a hundred days against 30,301 spent on living — death was the largest single
      drain in this economy, and it meant a village settled for a century was no better off than one
      founded last week.

      The rule is the one a person would guess: an adult of the dead man's own surname first,
      because a household is what actually inherits; any relative at all if there is no grown one;
      and failing that, shared among everybody still living there. There is no village pot to bank
      it in — a `Settlement` holds food, houses, trades and people — and inventing a treasury would
      be inventing a thing nothing else in the game can see or spend. Sharing it puts the money
      where it can be *used*, which is what makes it show up as a second storey rather than as a
      number in a file. It goes through `remove`, which is the single place every death in this
      world passes — age, hunger and violence alike — so there is no way to die that skips it.

      A stone records it now: what they left and who has it. That is worth having for its own sake —
      "Bren Halloway, miner, 61. Of age, 4 days ago. Left 64 gold to Nell Halloway." is the kind of
      thing a player pays a priest to hear, and who a place's money went to is who a place's
      families are. It also turned out to be the only way to *audit* it: `chore economy` judges the
      world by the books a player can pay for and never by the simulation, and it guessed the
      transfer wrong three times running, because whether a man earns and whether he pays his keep
      on the day he dies depends on which of the three ways he went.

      The audit had to change twice more. The daily balance check now stands aside from burial days
      and says how many it stood aside from: a village that buries two people hands the first estate
      to the second man, who dies holding it, and the same coins appear on two stones on their way
      to whoever finally kept them — chains of three exist. In its place is the assertion that
      actually matters, over the whole run where no chain can hide: **what somebody held is still in
      the village afterwards**. The one honest leak left is written into it — when the last soul in
      a village dies there is nobody to leave anything to, and that is a village dying rather than a
      man dying in one. The memory kind `inherited` is worth twice a gift and well under a rescue: a
      bequest cannot be repaid and was the last thing that person did, and the opinion it forms is
      of somebody who is not coming back, which is how a village comes to have a past.)*

- [x] **The second storey and the bath house, re-tuned against a world with working mines.**
      *(Both numbers were measured when they were set and both had stopped being right, in the
      ordinary way a tuned number goes wrong: nobody touched them, the world got richer underneath
      them. A village with a worked mine near it mints eight hundred to a thousand gold over a
      hundred days that it did not have before the mines were fixed.

      `STOREY` 35 → 55. At 35, fifteen of the twenty-one villages the bench lives ended up two
      storeys tall and the first on day 16, which is a mark every village earns and therefore not a
      mark. Measured across the same villages: 45 gives nine, earliest day 21; 55 gives six, from
      day 29 out to day 95; 65 gives three, all of them mid-run. Six in twenty-one is the share the
      original number was aiming at, and the spread is what says a village *becomes* prosperous
      rather than being born so.

      `LUXURY` 800 → 900, and what moved it is not how many villages get a bath house — five of
      twenty-one either way — but when. At 800 all five had theirs by day 37 and nothing changed
      for the remaining nine weeks; at 900 they arrive on days 28, 32, 82, 99 and 100. That is the
      difference between a fact about a village and something that happens to it while you are
      playing. At 1,000 only two cross and at 1,200 none does.)*

## Things to make, when the country is finished

- [x] **Teleporting looks like teleporting.** Using teleport should beam the hero up rather than
      moving him between one frame and the next: he goes pixelated — the rig breaking up into its
      own blocks, which is what this world is made of anyway — and rises into a bright column of
      light standing up into the sky. The same in reverse where he arrives. It is the one move in
      the game with no animation at all, and it is the move a player makes most often while
      exploring, so it is the thing that most often looks like a bug rather than a power.
      *(`render/beam.ts`, and `Entity.apart`, which the creature pool reads to lift, turn and shrink
      each block of a rig — so what flies apart is the hero's own boxes in his own colours, wearing
      what he is wearing, and not one new triangle is cut for it. The move itself is still instant:
      what plays out is a copy of him left behind to come apart, and the man himself gathering
      together where he landed, both inside a shaft of light. A third of a second, because this is a
      thing a player does every couple of minutes. Two things had to be got right by looking rather
      than by reasoning — the block has to be turned before it is stretched into the part it is, or
      it shears as it tumbles and the cape spreads into a slab; and the light has to be added to
      what is behind it rather than mixed with it, because a mixed one came out darker than desert
      sand, which is a strange thing for a light to do. Teleport only: a doorway and a staircase
      change the whole scene, stepping off a boat is a stride, and being carried home after a
      knockout is somebody dragging your body — a beam there would claim a power at the exact
      moment the game has told you that you had none. The eagle over the range was the near miss and
      is left alone, because it already has a bird and a line of text saying what happened.)*
- [x] **A character builder, as a page.** A list of the people and animals down one side, a real 3D
      view of the one selected, and a prompt that runs `claude -p` and shows what comes back — so
      changing a rig is asking for the change and watching it happen. A page rather than a terminal
      panel: kitty's graphics protocol carries images rather than geometry, so a terminal version
      would mean rendering headlessly and streaming frames, where a page simply has three.js, orbit
      controls and a mouse. It opens inside the editor as well. `tools/turnaround.html` is most of
      the renderer already; what it needs is the list, the prompt, and a dev-server route that
      shells out and streams the reply back.
      *(`tools/character-builder.html`, with `tools/askclaude.ts` as the door it asks through. Three things
      were learned, and two of them were not about drawing. The first: the run has to belong to the
      server rather than to the page. Claude edits `animals.ts`, Vite sees the file change and
      reloads the page — which is the entire point — and the reply being streamed into that page
      dies with it, taking the process producing it along too. So the answer is kept on this side
      and the page merely follows it, from wherever it had got to; a reload then costs nothing, and
      opening the builder shows you what you last asked. The second: `host: true` means "the dev
      server is local" is not true of this machine, so the loopback check belongs on the route, on
      the socket's own address, next to a header that no cross-site form can send. The prompt goes
      to `spawn` as an argument and never through a shell, and `--permission-mode acceptEdits`
      widens nothing — whatever Claude may run here is what this machine already lets it run at a
      terminal. The third is the drawing one: every creature is shown at its own `scale`, on a grid
      of one-tile squares, with its `body` footprint drawn flat under its feet. A wireframe box
      round the whole animal was tried first and read as a cage; flat is what the world actually
      keeps anyway. Fliers are set down on the grass rather than drawn nine tiles up, because a
      speck with the ground out of shot stops the list being a way of comparing one creature with
      the next — the altitude is written in the facts instead. The walk is the game's own
      `cycleTurn` and `bodyMotion` rather than an imitation, which is what catches the arm that only
      passes through a hip at the top of a stride.)*

## The people should not all be the same person

Every villager in this game is the same sixteen boxes in different trousers. Up close that is fine —
you can read their names — and at the distance this camera watches a street from it means a village
is a crowd of one man repeated. The trades are all simulated and none of them is visible: eleven
behaviour trees, each with its own working day, and nothing on the screen says which is which.

Written down together because they are one job, and because the model files that landed tonight are
what makes it a small one — a creature is `models/creatures/<id>.json` now, so a new sort of person
is a file rather than a pull request.

- [x] **Body types.** Fat villagers, thin ones, broad ones. The `biped` generator takes a palette and
      nothing about the shape of the person wearing it, so every body is identical. This is the one
      that has to come first, because every model below is built on it.
- [x] **A miner**, with a yellow hard hat like a construction worker, and a pickaxe in his hands.
      *(Half done: `pick` now has a model and `HeroGear` can draw a tool in a hand, which it never
      could before — a tool has no equipment slot and deliberately so. What is left is the man.)*
- [x] **The seven models are in the street.** *(Not one line, in the end. Every villager spawned as
      one kind and was handed a trade afterwards, and `Entity.kind` is readonly with the renderer
      pooling by it — so a body cannot be changed after the fact, it has to be chosen before the
      entity exists. The register is asked first now and its answer picks the body. Seen in
      Stonemere: a cowboy by the stalls, a farmer beside him, ordinary villagers around them.
      `manager.ts` had to pay for it, so the paddocks moved to `paddocks.ts` — a real seam, since
      nothing about what a village keeps in its yard asks about wildlife or chunks.)*
- [x] **Swing a pickaxe.** *(Half of this was already done and the ledger had not caught up: the
      `dig` verb throws the `swing` blow, the `facework` tree calls it every 1.4 seconds, and
      `crews.test.ts` counts the strokes and refuses to let one take a heart off anybody — a man at
      a face swings all day beside you and cannot hurt you, which is the difference between working
      and fighting.

      What was actually missing was the man. `DIGGER` in `crews.ts` was `'villager'`, with a comment
      arguing that the man at the face is one — true, and not an argument for drawing him as
      somebody else. He is now drawn as a `miner`: hard hat, and a pick bound to `armR`, which is
      the arm a `swing` turns, so the tool comes over the top with the stroke without anything
      having to animate it. One word, and the difference is a man making a punching motion at a wall
      against a man cutting rock.

      The guard that had to come with it: `treeFor` asks the trade before the kind, and there is a
      tree filed under `miner` — his *surface* day, up to the high ground at first light. If that
      order were ever reversed, every man underground would set off looking for a hill. A test says
      so.

      Found on the way: `__blow` and `__entitiesFull` both read the overworld's `EntityManager`,
      so a probe standing in a mine reported an empty cave. They ask `places.crowd` now, which is
      the same fix `__entities` had already been given and the same reason — there is one manager
      per floor, and only one of them is the crowd the hero is in.)*
- [x] **A farmer**, and a cowboy for the farmer who keeps the stable.
- [x] **A priest** for the church, who already exists as a person — `places.ts` gives the chapel
      keeper `trade = 'priest'` — and is drawn as an ordinary shopkeeper.
- [x] **A doctor.**
- [x] **A constable**, so the law is recognisable before it reaches you.
- [x] **A mayor**, with a hat like Henry the Eighth's. The town hall has a clerk in it as of tonight
      and nobody the town would call its head.
- [x] **A miner has no behaviour tree at all.** `behaviours/villagers.json` has eleven — innkeeper,
      seller, farmer, hunter, constable, doctor, soldier, hired, sailor, climber, explorer — and
      `miner` is not among them, so a villager whose trade is mining does not go mining. Found while
      looking for the swing.

## Draw the simulations

> "I think we should draw the simulations as well, which would make the game more immersive"

The pattern behind the mine: a system is fully modelled, correct, tested — and invisible. It has now
happened three times in one night (the economy flatlined for want of anybody looking, the mine is
worked by nobody you can see, a villager's memories were evicted before they became an opinion), so
it is worth its own heading rather than being fixed one case at a time.

- [x] **An audit: every simulated system, and whether you can see it.** Done twice, and the second
      time honestly. The first pass asked which systems are imported by `render/`, `ui/` or `frame.ts`
      and concluded that fifteen hundred lines of simulation reach nobody. **That was wrong**, and
      the way it was wrong is worth keeping: it missed `watch.ts`, which stands things up in the
      world as you approach them; `meeting.ts`, which is what a person says to you; and the whole of
      `game/interact/`, which is the player's own verbs. A system reaching those is a system you can
      meet, and I had counted them as dark.

      What the second pass says:

      | system | lines | how a player meets it |
      |---|---|---|
      | nemesis | 653 | `watch.ts` stands him up, `interact/nemesis.ts` is what you do about him |
      | rescue | 475 | `interact/rescue.ts` — a village asks and you answer |
      | gifts | 363 | `meeting.ts` and `interact/gifts.ts` — you hand somebody a thing |
      | sailing | 217 | eleven readers, `ui/readouts.ts` among them: the best-served system here |
      | brewing | 193 | **one reader**, `interact/herbs.ts` |
      | digging | 127 | **one reader**, `interact/wild.ts` |
      | warband | 403 | not the roaming bands at all — a player-versus-player contest with hired men |

      *Two real findings survive. `brewing` and `digging` have exactly one way in each: stand in the
      right place holding the right tool. Nothing in the world advertises either — no hillside looks
      worth digging, no patch of herbs looks like a draught — so they are not invisible so much as
      undiscoverable, and a player could finish the game without learning they exist.*

      *And the method is the lesson. "What draws it" is the wrong question in a game where most of
      what you meet is stood up by a watcher or spoken by a person. The right one is "what path does
      a player have to it", and it has to be asked of the verbs as well as of the renderer. The mine
      was a true finding — `crews.ts` did not exist and nothing put anybody underground — but it was
      found by walking into a mine, not by grepping, and that is the difference.*
- [x] **Advertise brewing and digging.** A tile that grows nothing of its own now shows what it is
      hiding: a flower or a mushroom where herbs grow, a stone at the surface where there is metal
      under it. *(Two things had to happen first. The ground half of both systems moved down to
      `world/seams.ts` — what a piece of ground holds is a fact about the world, exactly like whether
      it grows a tree, and `digging.ts` had said so in its own opening comment for as long as it has
      existed; the spade, the mortar and the recipes stayed in `game/`. Then the threshold, which was
      walked into from both ends: at 0.3 nothing qualifies and the sign silently does nothing — the
      stones left are the ones the biome grows as scenery, which is how the first attempt looked as
      though it worked — and at 0.05 every tile that takes a spade is marked, 901 stones in eleven
      thousand tiles, which is a scree slope. In between it is very nearly a yes-or-no question about
      the country, because `rise` is `level - base` and those are equal on anything that is not a
      slope.)*
## The mine, with people in it — September 10th

- [x] **Nobody is ever digging.** `mines.ts` has worked every village's hole every day since it was
      written: a crew off the register goes down, the gold comes up and is shared among them to the
      coin, somebody is frightened off, and now and again somebody does not come back and what he
      was carrying is left on the floor where he fell. All of it true, all of it written down, and
      none of it ever drawn — `places.enterDungeon` spawns what makes a mine dangerous and has never
      once spawned what makes it a mine. So you can walk into the workings a village is being made
      rich and poor by and find the tunnels empty. It is the same fault as an economy with no
      source: the model was right and nothing showed it to anybody.
      *(`src/game/crews.ts`, and `Mines.whoIsDown` beside the ledger that pays them. Three questions
      and an answer to each. **Who**: the miners the register lists as living in the village that
      claims this hole — literally the same expression the day's takings are shared by, which is now
      `crewOf` and called from both places, because a crew worked out twice is a crew that will one
      day be two different sets of men. No day is passed in and none should be: the register is
      already at today, so a man the mine swallowed last week is not in the list, and a second
      opinion about who is alive is how a game ends up burying somebody who is still talking to you.
      A hole no village works has nobody in it, and neither has one the village is too frightened
      to go near — the same `DREAD_SHUT` the place is *described* by, so walking into a mine you
      were told nobody would go down and finding it empty is the village turning out to be right.
      That is a rule about what is seen and not about what is earned; the economy's own brake on a
      frightened village is still the willingness roll inside `dayUnderground`, untouched.
      **Where**: at the faces, not at the room centres monsters get. A room centre is where you
      meet something; a man at a room centre is a man standing about. So floor tiles are scored by
      how many of their four sides are rock, corners and dead ends first, kept clear of the steps
      you arrive on and spread five tiles apart — and if a cramped cave cannot satisfy that the
      spacing relaxes rather than dropping men, because a missing miner is invisible and that is
      the worst kind of wrong. He is turned to face one wall squarely, the one with the most rock
      behind it. Facing the bisector of a corner was tried first: it reads perfectly in a built
      room and turns a man to face open floor in a cave, because an inside corner there is a notch
      rather than a corner. Checked across 399 cave seeds and 300 vault seeds — 2,394 faces, every
      one of them plain floor with rock in front of it, and not one hole that could not seat six.
      **What digging looks like**: there is no pick swing in `animations/motion.json` and there
      never has been. What a body knows is a walk, an idle, a flinch, a death and five shapes of
      blow, and every one of them was written for getting somewhere or hurting something — nothing
      in the file is work. Rather than invent a sixth motion that nothing else would ever use, the
      new `dig` verb throws the blow already called `swing`: an arm over the top and down, which is
      what the hero's sword does and is also exactly what a pick does. It is the nearest honest
      thing. Nothing is struck — a blow only hurts through `strike` and `dig` never calls it — so a
      man swings beside you all afternoon and cannot take a heart off anybody. The day itself is
      `facework` in `behaviours/villagers.json`, filed under a name no village trade uses on
      purpose: his trade is `miner` and that is what he is called and what he talks about, but
      giving this day to the trade would put every miner in the country outside his own front door
      swinging a pick at the grass. It has no hour in it either, because a shift underground does
      not know what the sky is doing.
      Talking to one needs nothing new: the entity carries the person's id, so `talk.ts` reads him
      back off the register and he already has a family, a purse, and — through `saidOfMine` — a
      line about how the seam has been going. What he has not got is a way to be asked: underground,
      `interact/index.ts` answers Enter with a chest, a door or the stairs and never looks for a
      person, and the click path picks against the overworld renderer rather than the floor's. One
      line in `talkNearest`'s `places.underground` branch would do it, and that file was not this
      week's to touch.
      One correction fell out of it and is in: `felled` in `blows.ts` counted every body killed in a
      mine as one less thing living down there, which with people in the tunnels would have let a
      player make a hole safe by murdering the crew that works it. Anybody on the register is not
      what was living down there, and is no longer counted.)*
- [x] **The one line nobody has added yet.** `src/game/crews.ts` is proved by `crews.test.ts`
      calling it directly against a real cave and a real register, but nothing in the running game
      calls it, because `places.ts` belongs to the castle this week. One import, one field, one
      call, and one line in `main.ts`:
      1. `src/game/places.ts`, with the other imports —
         `import { putTheCrewToWork, type Digger } from './crews';`
      2. `src/game/places.ts`, one field on `PlaceContext` —
         `crewIn: (anchorId: string) => readonly Digger[];`
      3. `src/game/places.ts`, in `enterDungeon`, after `const monsters = new EntityManager(…)` and
         **outside** the `if (!told)` block, for the reason villagers are not the server's — the
         people of a village are the seed and the register, and every client has both —
         `putTheCrewToWork(monsters, world.map, this.ctx.crewIn(anchorId), anchor.seed);`
      4. `src/main.ts`, in the `new Places({ … })` block —
         `crewIn: (anchorId) => mines.whoIsDown(anchorId, minesWorked(), (v) => register.living(v)),`
         `minesWorked` is declared further down the file than `Places` is built; the closure is only
         ever called on the way into a hole in the ground, so there is nothing to hoist.
- [x] **A miner killed underground is written down now.** *(Two faults, and the second was the
      worse one because it was a day old.

      The floor's `EntityManager` was built with no register and no `onFallen`, so an ogre that
      killed one of the crew in front of you changed nothing and the man was back at his face the
      next time you walked in. It is handed the same two things the country's own crowd has —
      `[]` villages, because a floor is not a street and `spawnVillageFolk` walks that list, but
      the register and the same `fallen`. Nothing invents a second answer about who is alive; the
      tunnels can simply reach the one there is.

      The second fault is what made the first one invisible. `PEOPLE` in `quarry.ts` — what a
      predator prefers, what a constable comes running about, and what it is murder rather than
      hunting to kill — was a hand-written set of four names, and the night the trades were given
      bodies of their own it silently stopped being true. Seven new sorts of person appeared in
      `properties/people.json` and none of them in that set, so a miner's death was not a death
      worth reporting **and a hunter looking for something to shoot would have taken aim at the
      priest**: `nearestQuarry` asks for anything with hit points that is not a person and is not
      dangerous. It is read off the file now — a person is not a property a creature carries, it is
      which file it was written into — and `quarry.test.ts` holds it there, because a list of names
      beside a directory of names is a list that falls out of step and this one managed it inside a
      day.

      And what a death down there does to the village, which the item asked for: the same thing a
      death it never saw does. `restOvernight` has always added `DREAD_A_DEATH` when a crew loses
      somebody in a day nobody watched, so `Mines.aDeathBelow` adds exactly that constant when it
      happens in front of you. Two numbers for one thing is how the seen and unseen halves of this
      world start telling different stories. It only ever raises: fear arrives on its own, and the
      only thing that brings it down quickly is somebody walking up out of the hole and saying so.

      Not covered end to end: the wiring from a blow underground to the register is typed and not
      tested. A test for it turned into a test of whether a wolf can be persuaded to kill a man in
      a bare harness, which is a test of the wolf. What is covered is the rule the wiring depends
      on — who counts as a person — and what a death does to a mine.)*

## Found while wiring the miners in

- [x] **The mesh world had no caves at all, so no mine was ever worked.** Seeds 1, 3, 5 and 7 of the
      world the game actually plays: signposts, piers and wrecks all present, **caves zero**, and a
      cave is what a village claims as its mine. So no crew went down, and the seam where every coin
      in this world is minted was never cut. *(The same fault was found and fixed in the endless
      country earlier the same night, and the fix was made in only one of the two places: a cave was
      "the first tile drawn as high ground", and a polygon world raises the base its tiles are
      measured from rather than a tile's own rise, so nothing ever reads as `High`. Ten caves a world
      now, four to eight of them claimed as mines.)*
- [x] **The `__entities` probe could not see underground.** It was bound to the overworld's manager
      when the game was built, so standing in a mine and asking what was there answered about the
      fields overhead — which is why the mine crew could not be checked by hand the night it was
      wired in. It asks `places.crowd` now, which is the manager of the floor the hero is actually
      standing on. *Confirmed by walking into Ashstead's mine: `villager:Dirk Elzen` among the rats
      and the bats, a named man off that village's own register, at the face.*
- [x] **A crew is one or two people, so the tunnels read as empty.** *(Not fixed by adding miners —
      the register was tuned the other way on purpose, and its own comment records why: a version
      that gave Fernreach five miners out of twelve adults made it "a mine with a village". The
      fault was where the one man stood. Faces were ranked by seam alone, so he took whichever wall
      had the most rock behind it anywhere on the map — measured, 16, 12 and 21 tiles into a 56-tile
      cave on three seeds, which is a man a player never meets. Ranked by ring first and seam
      within a ring, he is 11, 12 and 7 tiles in: still at a face worth cutting, and now on the way
      past.)*
- [x] **Snow country stands above the rest, and there are hills between the two.** *(Two numbers and
      one new idea. `LEVEL_RANGE` from three terraces to ten, so the ground rises and falls by five
      world units over a hundred and sixty tiles rather than a barely visible one and a half; and
      `BIOME_BASE[Snow]` from two to eighteen, so the cold is at the top of something you walked up.
      Both are done to the road web's own levels rather than to a field of their own, because every
      height in this world is measured from the road it is nearest — a tile's base, a village
      square, the floor of a house, the terrace a river rises at — so a hill added anywhere else is
      a hill something gets left behind by. The first attempt did add it elsewhere, and sank every
      village square in the world three terraces into the ground while the houses round it stayed
      up.

      The new idea is `Uplands`, at the foot of `highland.ts`. A country cannot stand eighteen
      terraces above its neighbour across the line the biome pie draws, and that was measured rather
      than argued: with snow put straight to eighteen, the ground beside one road read 18, 17, 16
      and beside the next road along 6, 5, 5 — a thirteen-terrace step in open country with nothing
      to see. So the map is asked on a lattice of eighty tiles, each post averaged over its own
      nine, and eased between them, which turns the border into a climb some two hundred tiles wide.
      That is inside what the roads can follow: a crossroads stays within a terrace of its parent,
      so no road climbs faster than a terrace every seven tiles, and the smoothing asks for one
      every eleven.

      Two things this broke, both found by measuring rather than by looking.

      **The tiers test had been growing nothing but vultures.** `tiers.test.ts` failed with "no
      creature was checked", and the ground was blamed first. It was not the ground. The harness
      builds a `GroundWorld` and never calls `reach` on it, so no chunk of it is ever made — and
      `canStand` asks `heightAt`, which answers out of the chunks that have been made and nothing
      else. Every walking creature offered a spot in that harness could not stand on it and was
      quietly never born; the only things that ever spawned were fliers, for which `canStand`
      returns true without asking the ground at all. Every test in the file had been passing on a
      country of birds. The hills merely moved the country under the test's spot from desert to
      marsh, and frogs cannot fly. One line — `ground.reach(STOOD, STOOD, MADE_AROUND)` — and the
      file tests what it claims to. With the ground actually made, a hilly world grows fifty-six
      creatures where a flat one grew sixty-seven, which is a world rather than a regression.

      **The hills nearly took the castles away.** A castle wants a rim of nineteen tiles within one
      terrace of itself, and that stopped being common the moment the ground had relief in it:
      fifteen castles across twelve seeds became ten, with four of those worlds holding none at all.
      `CASTLE.SLACK` is two now, and the plinth that two used to build is paid for by a doorstep —
      `stampWard` sets the outermost ring of the apron one terrace towards the country instead of
      flush with the ward, so two terraces of difference are met as two strides with a tile of
      standing room between them rather than as one wall nobody can climb from the uphill side.
      Twelve seeds out of twelve have a castle again. Deliberately a terrace and not a ramp: this
      world is built of terraces and reads as terraces, and a smooth slope would be the one piece of
      ground in the country that was not.

      The golden fingerprint moves all five hashes, which is the first time anything has, and is
      what changing the field every height is measured from is supposed to do. The crossroads
      themselves have not moved — hashing the web without `n.level` reproduces the old figure to the
      digit — and what does move in the web is eleven loop roads that are no longer built, because
      `addLoops` has always refused to join two crossroads more than a terrace apart and now has
      cause to.)*

## The castle

A fourth kind of place underground, which is not underground: a keep of four floors standing on
the map, walked into through its gate, and from every angle but its own an ordinary dungeon. The
inside of it is `src/dungeon/castle.ts`; the building that stands in the world is somebody else's
half and is not described here.

- [x] **A castle is a plan, not a warren.** *(`castle.ts`. The three older places underground are
      one algorithm — scatter rooms, join each to the nearest — and a keep is the opposite: one
      rectangle divided, so its rooms share walls and its corridors run the length of a wing. Every
      division reserves a band of floor along the line it cuts on, and that band is a gallery; the
      split axis strictly alternates, which is not a stylistic choice but the reason the plan comes
      out connected with no joining pass at all — a child's gallery spans its own rectangle end to
      end in the direction its parent's runs, so the two always touch. Round the divided block runs
      a curtain walk two tiles wide, and off it hang four corner towers and a gatehouse, which is
      the silhouette that says castle at a glance. Seventy-six tiles a side against a vault's
      fifty-six; twenty rooms a floor and fifteen stretches of gallery; four floors, because
      `dungeonMonsters` runs out of bands at three and a fifth floor would be a floor with nothing
      new to fight on it.)*
- [x] **Three things to solve on every floor, none of which needed a new verb.** *(There is no hint
      system in this game and there is not going to be one, so a room has to say what it wants by
      being looked at — which rules out anything remembered, a lever pulled two rooms ago or a
      sequence of plates, and leaves the two things a player can always see: where the floor is and
      how high it is. **The barred stair**: the way up is in a chamber whose doorways are
      portcullises and the warden's key is in a chest you can reach without passing one — the
      vault's own lock and key, moved off the treasure and onto the stair, which is what makes four
      floors a climb. **The drowned undercroft**: a chamber flooded to the sills with the prize on
      an island, crossed on a laid line of stepping stones with false ones scattered either side;
      the false ones are placed only where every neighbour is water, so they lead nowhere and can
      never accidentally bridge, and the whole pattern is visible from directly above, which is
      where this camera is. **The minstrels' gallery**: a walk along one wall of the great hall
      three terraces up, with one stair to it. Three terraces is the load-bearing number — the
      hero's `climb` of 0.56 clears one, a climbing rope's 1.06 clears two, and three is a wall to
      everybody, so the stair is the answer rather than a suggestion. The gallery and the island
      take turns holding the key, by whether the floor number is odd, so which puzzle you have to
      finish changes as you climb.)*
- [x] **Ghosts and monsters.** *(Monsters are the floor's own table, as a vault's are: a spot in
      `map.monsterSpots` with nothing else said about it is rolled against `dungeonMonsters` for
      the depth. A ghost is the same list saying what stands there — the spot names `wight` — so a
      wight is a fact about a room rather than a roll, the way `game/haunts.ts` argues a keeper of
      a ruin should be, and the chapel, the drowned undercroft and the throne room always hold one
      while everything else is rolled higher the further up you have climbed. Note the hour: a
      wight's own behaviour tree has it abroad only between 0.82 and 0.27, so a keep walked at noon
      is a keep full of things standing perfectly still, and the same keep after dark is not. Capped
      at one plus the floor, because a wight has no hit points — a blade goes through one — and
      five of them on a floor is not frightening, it is a floor you cannot afford to be on.)*
- [x] **A dungeon's walls had no height at all.** *(Found while building the castle's gallery and
      fixed in `dungeon/world.ts`. `buildChunkMesh` cuts every quad from a chunk's `corners` and
      never reads `height`; `DungeonWorld.chunkData` filled in `height` and left `corners` at
      nought, so every vertex of every dungeon sat at y = 0. The rock was still solid to walk into
      and the minimap still drew it, so nothing failed — there was simply no wall standing up
      anywhere underground, in any hole in the game. Measured rather than argued: meshing a vault
      off `main` gives every land vertex a y of exactly nought, and off this branch a span from
      nought to `WALL_Y`. How long it had been so is not known and is not claimed — `corners` has
      been the geometry the mesher cuts since long before the mountains became a layer of their
      own, which is as far back as it was worth digging. `src/dungeon/world.test.ts` is the
      guard.)*

- [x] **A dungeon's furniture is solid now, and the floor is still walkable.** *(`DungeonWorld` was
      the only world in the game whose furniture had never been measured: `blocked` knew about
      chests and nothing else, so a castle's tables, barrels, weapon racks and cell bars were walked
      straight through while the identical table indoors stopped you. It measures them the way
      `InteriorWorld` does now — the same boxes, at the same walking band — so a barrel takes up a
      barrel's worth of floor rather than the whole square metre the map happens to be stored in.

      `FURNITURE_BLOCKS` moved to `world/footprints.ts` on the way, because whether a barrel stops
      you is a fact about barrels and must not depend on which side of a door the barrel is on.

      The hard half was the one the item predicted: the moment furniture fills tiles it can seal a
      room, and it did — seed 3 lost a hundred and forty-eight tiles on its first floor. `castlefit.ts`
      is about everything that fills a tile now rather than only chests, and three things had to be
      right about it:

      **A cell is meant to be shut.** Bars are counted as part of the plan rather than as furniture,
      so the floor behind them was never on offer and nothing tries to nudge a gaol open. The rule
      is exported as `floorThePlanOffers` and the castle's own test asks *that* rather than working
      it out again, because two answers to "what is this floor meant to offer" is how a check and
      the thing it checks end up disagreeing about whether a castle is broken.

      **Only what is in the way is on trial.** The settle used to try everything on the floor and
      take the first move that helped. With three chests that was fine; with a hundred and thirty
      sticks of furniture the first improvement is almost never the one that matters, and forty
      passes were spent shuffling barrels in other rooms while the sealed wing stayed sealed.

      **A line of furniture is one obstacle.** The case that proved it is the drowned undercroft:
      an island of floor reached by stepping stones one tile wide, with two barrels standing on the
      line. Neither can be nudged, because every neighbour is water, and removing either alone
      changes nothing because the other still seals it — so nothing was ever removed and seed 11
      lost its undercroft, its chest and eight tiles. Blame travels along touching furniture now, up
      to a causeway's length, and the last resort takes the whole line out at once.

      Signed off by the collision bench, which is where this belongs: a hero walked into the
      furniture of six dressed castle floors carrying seven hundred and fifty-two solid sticks
      between them, a hundred and thirty-three walks, nothing through anything. The second half of
      that pair is in the same file — every one of those floors can still be walked end to end.

      And then the density, which was the reason the item was written. A chamber was nine per cent
      furniture *because* you walked through it; that argument is spent, so `CLUTTER` is eighteen.
      At nine, the great hall of Saltmarch is a bare floor with a bench in it; at eighteen it is a
      hall with tables, barrels and benches you walk between. A hundred and eighty-four solid sticks
      a floor becomes two hundred and thirty-four, and across twenty-four dressed floors not one
      tile is shut off. What holds it there rather than higher is the camera: past about a quarter
      the floor stops reading as floor.

      The bench caught something on the way up, and it was the bench being wrong rather than the
      game. A crowded hall means the run-up to one table can have a weapon rack and a barrel
      standing in it — seed 11 floor 1 — so the hero met those, slid off one, and clipped the corner
      of a table he never walked at. Reported as "walked through the table", which it was not. An
      approach is only used now when the subject is the only thing on the line.

      `__enterCastle` was added to the probes to do any of this, because a castle is entered by
      standing on one tile and pressing a key, which a person does easily and a headless probe does
      badly. There was no way to look at the inside of a castle from outside the browser at all,
      which is a fair part of why a week went by with the furniture walk-through.)*

### Wanted for the castle — made, September 10th

All fourteen, in `entities/keep.ts`, which is its own file for the reason `castle.ts` is: `props.ts`
is already six hundred lines of every prop in the world, and a hall's furniture is a thing somebody
will want to open on its own and work through. They also share one idea, which is why they are one
file — **a hall is bigger than a room, and what stands in it is bigger than a room's things**. A
`Table` in a great hall reads as a canteen; a `Hearth` in one reads as a fireplace somebody has
mislaid. Everything a castle was dressed out of came from a village or a chapel, and each was the
right silhouette from above and the wrong object up close.

- **Throne** — a high seat on a dais, and what makes it a throne rather than a chair is that it is
  too big for a person: a back twice the height of the man in it, arms he could not reach across,
  a step up to it, and the one piece of gold in the room.
- **LongTable** — one plank on trestles with a bench down each side, three tiles of it. No legs at
  the corners, because that is what tells a board from a table at a glance.
- **GreatHearth** — jambs, a lintel at head height and a fire, two tiles wide. Built against a wall,
  everything at negative z, so the prop's own rotation puts its back to whichever wall the room has.
- **Banner** / **Tapestry** / **StainedWindow** — fixed to rock the way a torch is, and placed by a
  pass of their own (`hangTheWalls`) rather than by the scatter that puts barrels about. A banner
  lying in the middle of a floor reads as a dropped rug. The window is lit from behind, so it goes
  on glowing when the room round it is dark — the one thing a castle interior has that a cave never
  can, which is an outside.
- **SuitOfArmour** — built to the game's own proportions on purpose: a head at 1.5, shoulders at
  1.25, a polearm held out to break the silhouette. From the top of a stair you cannot tell it from
  something that is going to move, and only when you have walked up to it and nothing has happened
  is it furniture.
- **Brazier** and **Chandelier** — the lighting problem a great hall has. Torches are brackets and
  brackets are on walls, so the middle of a room forty feet across is dark whatever you do to the
  walls. The chandelier hangs at 3.5, which is above where the ceiling would be: nothing in this
  game draws a ceiling, and a light at head height reads as a lamp on a pole.
- **Portcullis** — halfway down rather than shut, because a grid resting on the floor is a wall. At
  half height you can see the room beyond it, which makes it something to deal with rather than a
  dead end.
- **Statue**, **TowerStair**, **Cobweb**, **Sarcophagus** — a figure for the turn of a corridor; a
  spiral of eleven steps going up into the dark, instead of the flat `Stairs` plate; the tell that a
  wing is the haunted one, read from the doorway rather than after the fight; and a lid shoved a
  hand's breadth off square, which is the entire story that object has to tell.

Two things that had to change with them. The floor-standing nine are in `FURNITURE_BLOCKS`, so a
throne stops you like a table does — the hangings and the chandelier are not, because there is
already a wall behind one and a walker never meets the other. And `CENTREPIECE` puts the piece a
room is *for* on the tile the room was laid out around, before the scatter fills in the rest: a high
seat that turned up three tiles off-centre with a rug over it would be a chair somebody had left out.

The collision bench signs it off at a hundred and fifty walks into sixteen hundred solid sticks
across six floors. Its own guard had to widen on the way: a long table is three tiles across, so one
standing a tile off a run-up still has its box in it, and the bench was reporting that as the hero
walking through a table he never walked at.

### Asked of `game/places.ts`, which is not this half's to edit

- **A castle is a `kind`.** `enterDungeon(poi, kind, …)` takes `'dungeon' | 'cave' | 'thicket'`;
  it needs `'castle'`, which then flows through as the style unchanged, since `generateDungeon`,
  `DungeonWorld` and `DungeonScene` all already know the word. Nothing else in that function has to
  change.
- ~~**Somebody has to raise the ghosts.**~~ Done without it, and deliberately so. A castle's
  haunted rooms are ordinary entries in `map.monsterSpots` that name their occupant — a third
  element, `'wight'` — and `EntityManager.spawnMonsters` gives a named spot what it names instead
  of rolling for it. `enterDungeon` already passes `world.map.monsterSpots` straight through, so
  the ghosts arrive with no change to that function at all, and none is wanted. A named spot also
  takes nothing out of the random stream, which is what keeps every vault, cave and thicket in
  every existing world holding exactly what it held before.
- ~~**Unlocking a vault does not survive leaving it.**~~ Fixed. `openChest` filed the key under
  `visit.world.anchorId`, which carries the floor — `dungeon:Name:2` — and `enterDungeon` read it
  back as `state.keys.has(anchor.id)`, which does not, so every vault in the game barred itself
  again the moment you left. Both ends now say `lockFor(anchorId, floor)`, which keeps each floor
  its own lock rather than opening all four of a keep's stairs at once; saves already hold the
  floor-qualified spelling, so a key found before this starts working. Found with it: `openChest`
  asked the manifest for `world.anchorId`'s seed, which has never been an entry, so every chest in
  the country was rolling off the world seed and giving the same gold and the same prize for the
  same index.

## Found by the castle, fixed the same night

- [x] **The page and the world grew different countries.** `attachIslands` was called in
      `game/country.ts` and not in `server/sim.ts`, so a road-tree world had islands on one side and
      not the other — seed 1's third village is Elderholm without them and Brambleholm with them —
      and whichever half filled a chunk first won. Found as a hero standing in a named village in an
      empty field: the people from one world, the ground from the other. *(Both halves call
      `roadTreeWorld(seed)` now. The manifest still has the last word on the page, because a world
      saved before this may have its islands elsewhere and moving them would move the ground out
      from under a house.)*
- [x] **And `chore halves` could not have caught it.** Every test in that bench builds
      `generateWebGraph` on both sides, so it was comparing two copies of the same half; the one
      test that looked at the road world checked the *source text* of `sim.ts` for a particular
      expression. It grows a road world each way and compares the villages now, which is the check
      that would have found this.

## The mountains, and why the road world will not simply be raised — September 10th

One generator now: the polygon world went in 0.37.0, and with it the only thing in this game that
could grow a cliff. What replaces it has to be relief in the road world itself, and the first
attempt at that is worth writing down because it failed in a specific and instructive way.

**What was tried.** `BIOME_BASE[Mountain]` from 3 terraces to 44, which is exactly the knob the
snow lands already use to stand eighteen terraces above the plain. The world duly went from eleven
units tall to twenty-five.

**What it cost.** Walls. Measured across six hundred tiles of seed 1: the worst step between two
neighbouring tiles of land went from 2.0 units — which is a cliff you walk round, and there are a
few of those in the shipping world — to 10.4, which is a wall you cannot get on or off. And the
worst of them were *along the roads*: at 34,-263 the road stands at 19 and the ground a tile away
is at 14.5.

**Why.** A tile's height is `roadLevel + country + rise`, where `roadLevel` is interpolated along
the nearest road edge, `country` is the smoothed biome standing (`Uplands`), and `rise` grows with
distance from the road. Two things follow. The tree clamps a crossroads to within one terrace of
its *parent* and says nothing about a crossroads on another branch a dozen tiles away, so raising
the country multiplies the difference between two roads that pass each other. And a tile takes its
level from *one* edge — the nearest — so where the nearest edge changes from one road to another,
the height jumps by whatever those two roads disagree about.

**What was tried next and also failed.** A relaxation pass over the graph pulling any two
crossroads within ninety tiles to within a terrace per three tiles of each other. It made the worst
step *worse* (15.5), which says the cliff is not primarily between node levels — it is in the
`rise` term and in the seam where the nearest edge changes hands.

**Where this actually goes.** The height of a tile needs to stop being a function of the single
nearest road and start being a blend of the roads near it, weighted by distance — which is what
would make a seam impossible rather than merely rarer. That is a change to the middle of the
generator, it changes every world, and it wants its own day. Nothing about the mountains is
tuneable until it is done.

### The blend was built, measured, and reverted — September 11th

The prescription above was followed and it is **wrong for the world as it stands now**. Written down
because the wrong half of it is the useful half.

**What was built.** `levelNear`: a tile's road level as the inverse-square-distance weighted mean of
every candidate edge instead of the nearest one. On a road the nearest edge is at nothing, so its
weight runs away and a road keeps its own level exactly; between two roads both weigh the same and
the seam gets a gradient. The corners took the same blend, or a corner could sit the far side of a
seam from the middle of its own tile.

**What it did.** Nothing to the case it was for. Worst road-to-road step, 600 tiles square, sampled
either side of the change: seed 1 **6.55 both ways**, seed 7 **6.01 both ways** — identical to two
decimal places. Worst step anywhere was a wash: seed 1 improved 9.50 → 8.00 and seed 7 worsened
7.50 → 8.00. A change to the middle of the generator that alters every world in the game, for that,
is not a change worth shipping.

**Why the prescription missed.** The numbers it was written from are stale. The note above measured
2.0 as the worst step in the shipping world; today it is 9.50, because mountains-as-polygons went in
afterwards and are *meant* to be steep. And the walls that are left are not seams:

- Two neighbouring tiles at 158,-158 on seed 1, **both of them road**, at terraces 41.1 and 28.0.
  Instrumented: the nearest edge is the same edge for both, at 0.1 and 0.4 tiles, agreeing on 22.7
  and 22.4. The blend was already smooth there. The thirteen terraces are `cutForWater` — the bank
  a river cuts into the country — landing in one tile.
- The worst steps that are not banks are mountain faces, which `ranges.ts` builds on purpose and
  holds down at the territory border so roads thread the passes.
- A road at 15 beside seabed at 0 is a coast, and the first measurement counted those as walls until
  `Seabed` was excluded. Worth saying: a careless measurement here reads 16.00 and sends somebody
  off to fix a cliff into the sea.

**Where it actually went, and it was one line.** The cut was taken from the *nearest* water body, and
the thirteen terraces at 158,-158 were the nearest one changing hands: a surface at terrace 38 on one
tile, 22 on the next, both bodies near both tiles the whole time. Every water near a point constrains
the ground independently, so the binding constraint is the **lowest** of them and not the closest.
`cutForWater` is folded over every candidate now instead of being handed one.

Measured over 600 tiles square, before and after:

| | worst step, land to land | worst step, road to road |
|---|---|---|
| seed 1 | 9.50 → **8.09** | 6.55 → **4.91** |
| seed 7 | 7.50 → 7.50 | 6.01 → **3.16** |

`banks.test.ts` holds it there: no stair over five units between two road tiles, and nothing over
nine in open country. Both are bounds set above what was measured, so they fail when somebody puts a
stair back and not when a road climbs a little harder than it used to.

**And the mountains are unblocked.** The note above said nothing about them was tuneable until the
walls were understood. They are: the walls were water banks, they are most of the way gone, and what
is left at eight units is `ranges.ts` doing mountains on purpose.

**Also found, and shelved with it:** a spiral ledge cut into a massif so it can be walked up
(`upliftRawAt`). It works and it is dead code — `TerrainSampler.massifs` is empty in this world,
because the road world takes its height from `highlandAt` instead. It goes back in the day the
relief does.

## The list, September 10th — the village economy and what stands in its way

Eight things, in the order they are being done. The first two are faults; the rest build on each
other, and the order is chosen so that each one can be *seen* working before the next is started.

- [x] **1. Teleporting to a castle drops you inside it, and climbing out puts you under the ground.**
      `teleport <castle>` aims at the gate tile, which is now a doorstep, so the jump is answered by
      going in. Coming back out leaves the hero below the terrain and the next step snaps him back to
      where he teleported from — which says the world and the page disagree about where he is
      standing. Reported: "it puts me directly into the castle and when I climb back out, it appears
      I'm below the ground".
- [x] **2. A ferry has no pier where you board it.** The boat ties up at a spot with nothing drawn
      under it, so the one place in the world that reaches out over the water is invisible.
- [x] **3. What a body leaves behind should look like what it is.** A kill drops a brown sphere
      whatever it was: meat, hide and gold are all the same lump. What is on the ground has to match
      what goes into the pack.
- [x] **4. A village should hold as many people as it has room for.** Twenty villagers around two
      houses. The population is drawn from the village's size in the graph rather than from what it
      has actually built, so a hamlet gets a crowd.
- [x] **5. A roster: every inhabitant, with their health, their name, their family and their purse.**
      A tool rather than a panel — the family tree taught that a page you can drag and read beats a
      list, and this is the same kind of question asked of everybody at once.
- [x] **6. Villagers get hungry.** Health that falls with the day and is restored by eating, which is
      the engine under everything below: a villager who must eat is a villager who must earn.
- [x] **7. Four ways to earn: dig gold, keep cattle, sell a service, or hunt.** `world/livelihoods.ts`,
      and the thing that actually changed is that money now *moves*. It used to be minted for every
      villager every morning out of nowhere and burnt again at dinner, so no coin ever passed between
      two people. Now: what the village pays for its dinner goes to whoever grew it (the fields, the
      woods, the byre); what everybody spends on their keep goes to the seller, the innkeeper and the
      doctor they spent it with; a farmer's herd calves, the surplus goes to the butcher and what the
      village cannot eat is sold to the next valley. Money enters in three places — the mine, the meat,
      and what a trade earns beyond the valley — and leaves in one: a village with no market spends its
      keep on a passing pedlar. `chore test economy` audits a hundred days of it to the coin. Two tuned
      numbers moved with the world underneath them: `STOREY` 85 → 195 and `LUXURY` 1,800 → 3,500, both
      re-measured across the same twenty-one villages to the same shape they always held.
- [x] **8. And all of it done where it can be watched.** The miners walk to the face and swing; the
      farmer must walk to the paddock, the hunter into the woods, the seller to the stall. Nothing in
      this economy may happen as a number moving in the dark.
      - [x] **8a. The cattle are in the field**, as many as the register says, and gone when the last
            farmer is. `entities/paddocks.ts`.
      - [x] **8b. The farmer works them.** The three trades whose day goes somewhere — farmer, hunter,
            seller — are put out before anybody else, and `tendStock` walks him beast to beast.
            Measured: he ends the morning a tile from the middle of the herd, against twenty-one
            before.
      - [x] **8c. A watched sale is a sale.** `verbs.ts` credited a hunter the price of his meat out
            of nowhere while an unwatched one was paid his neighbours' money.
      - [x] **8d. Buying happens where you can see it.** `spend` took money out of the body in the
            street — which is destroyed the moment you walk away, so it never reached the register —
            and gave it to nobody. It is a transfer now, to the trade that sells the thing, and the
            eight trades whose day already ended at the inn now buy their drink instead of merely
            attending. `boughtInTheVillage` is the mirror of `soldAtMarket`.
      - [~] **8e. The meat leaving the valley — declined.** A drover and a cart on the road, for one
            convoy an hour, to illustrate money the player can already read off the herd staying the
            same size while the farmer gets richer. A day's modelling and animation for a thing that
            is legible without it. Recorded as a decision rather than left as an oversight.

- [x] **10. A trade has to clear what it costs.** Asked for on 2026-09-11: if a villager pays for a
      market pitch they have to make more than the pitch back, or hunting and farming are a way of
      getting poorer — and if they hunt to eat instead, the food has to beat the day. Either way
      there is a profit in it. Measured, and the game failed it outright: a **hunter cleared 0.19 a
      day** against a soldier's 1.35, while his own tree had him spend 40 gold on gear — two hundred
      days of hunting to afford kit, in a life of ninety. The farmer failed it from the other side,
      clearing 6.45 and charged nothing whatever for turning what he grew into money.

      One line was the cause. A village grows 46 meals a day and eats 26, and the cellar simply
      capped — twenty meals a day went on the ground, in every village, every day, for the life of
      the game. Hunting did not pay because a hunter's product was free. The surplus is sold to the
      next valley now (`FOOD.ABROAD`), and taking a pitch costs something (`LIVELIHOOD.SELLING`).
      Hunter 0.19 → 5.87 gross. `livelihoods.test.ts` holds every trade in the game to clearing its
      own day, both ways: in coin if it sells, in food if it eats what it catches.

      Two things fell out of it. The bench's "no village holds more than its books say came in"
      check had been quietly incomplete for its whole life — `resettle` walks people between
      villages **carrying their purses**, and 2,630 gold had walked into Blackmarsh that no roll
      ever earned; the bound was slack enough to hide it until food producers started being paid
      properly. And `STOREY` 195 → 210, `LUXURY` 3,500 → 3,950, re-measured to the same shape.

      **Open, and surfaced rather than tuned away:** the spread is now farmer 18.2 a day against a
      sailor's 3.0. Every trade profits, which is what was asked for, but food is six times the best
      living in the game and two farmers hold much of a village's worth. Whether that is right —
      food *is* the base of the whole economy — or wants flattening is a design call, not a bug.

- [x] **9. One vocabulary for everybody** — done. The hero acts on the world through the same named
      verbs the villagers and creatures do. Asked for on 2026-09-11: if the player acts on the world
      through the same named verbs the villagers and creatures do, there is one thing to test, one
      thing to automate, and a villager can do anything the hero can. Three layers were found and
      only the third is worth unifying — what an act *does*, apart from who ordered it and how it
      was drawn.
      - [x] **9a. The deeds themselves.** `world/deeds.ts`: `Holder`, `transfer`, `buy`, `sell`,
            `give`, and `AWAY` for the rest of the world, which is a source as well as a sink.
      - [x] **9b. Who the player pays.** `game/tills.ts`. The hero had been buying horses, ferries,
            beds, bath houses, houses and hired swords by subtracting from a number at fifteen sites,
            and every coin of it left the world — the one actor exempt from an economy the villagers
            had already been made to obey. All fifteen now name a payee.
      - [x] **9c-1. Things changing hands.** `world/goods.ts`: `Pack`, so a rucksack, a strongbox
            and a hunter's shoulder are one shape; `handOver`, which moves what was *taken* and never
            what was asked for, because those differing by one is how a game mints goods; and `GONE`
            for the ground, the fire and the river. The strongbox and the hunter's shoulder are
            converted. A shoulder holds one kind of thing and drops what it had, which is what a man
            with two hands does.
      - [x] **9c-2a. Gold for work.** `world/works.ts`. Went in as "gold for work rather than gold
            for an object" and came out sharper: **a house is very much an object, it just is not
            there yet.** So `commission`/`settle` are a purchase with a lead time, and hiring is the
            genuinely different one — no object, no balance, no delivery, only a claim on somebody's
            days. Converting the builder found a real miss: the balance site had never been moved
            onto a deed, because `houses.pay` sat between the two halves of the edit and no assert
            guarded it.
      - [x] **9c-2. The list itself.** `world/vocabulary.ts` names every deed and every place a deed
            can act on, and `vocabulary.test.ts` holds the two to each other in both directions — a
            deed exported and unnamed fails, a name with nothing behind it fails. Same rule
            `catalogue.test.ts` holds the prop library to, and here for the same reason: `TRADERS`
            spent a long time naming four jobs nobody in this world can hold.
      - [x] **9c-3. The acts that are not money or goods — looked at, and mostly they should not be
            deeds.** The test for whether an act wants one is whether two systems are doing it twice
            and free to disagree. `skin`, `craft` and picking herbs *create* things, and dressing a
            creation as a transfer from a fictional pack is ceremony: `state.give('herb', n)` is
            clearer than `handOver(GROWING, packOf(...), 'herb', n)` and has no second expression to
            disagree with. `enter`, `ride` and `arrest` change where somebody is, not what they hold.

            **One of them was real, and it was the last money leaking out of the world.** Paying to
            be mended existed twice — `beHealed` for a villager and `mending.take` for the hero —
            and *both* burnt the fee. Converting them turned up two more in the same file: the bed at
            an inn and a clerk's charge for looking something up. All three were missed by the sweep
            that converted fifteen sites, because they live in `meeting.ts` rather than in
            `game/interact/` — a sweep aimed at a directory is a sweep with an edge.

            There is now no `state.inventory.gold -=` anywhere in the game, and no `purse -=` outside
            the deeds, the meal charge and inheritance — all three of which have a named counterpart.
      - [x] **9c-4. `verbs.ts` split when it grew.** Done at the time: the trade verbs came out into
            `entities/living.ts` when the file hit 705 lines. `architecture.test.ts` is what will say
            when it needs doing again, and `vocabulary.test.ts` keeps the split invisible from
            `behaviours/` — a tree naming `sell` gets `sell`. Nothing to do until the cap fires.
      - [x] **9d. The hero driven by the same decisions as everybody else.** Note the hero is
            *already* an `Entity` — `Player.entity`, kind `hero` — so the question was never about
            the body. It is about the choosing. Framed by the person who asked for it: **the
            decisions are the same, they are just made manually, and each step goes through the
            player to decide the outcome.**

            Which makes the two systems the same shape rather than merely similar. A behaviour tree
            is a selector: walk the branches, take the first whose condition holds.
            `createInteractions` is *also* a selector — fifteen things tried in order, first that
            answers wins. The only difference is who picks: a villager's tree picks for itself, the
            hero's passing branches are offered as a menu. So the work is not new machinery, it is
            recognising that the machinery exists twice and making one of them.

            What it buys: a scripted playtest driving a real hero through real verbs rather than
            synthesised keypresses; "walk to Frostgard" becoming the `goTo` a villager already uses;
            a disconnected player's hero standing down sensibly instead of freezing; and any act the
            hero can do becoming available to a villager, which is the whole point of the exercise.

            **Built as a seam rather than a machine.** `Player.autopilot` is one line in `update`:
            when nothing at all is held down, whatever else is driving him is asked for a steer, and
            that steer goes through the same `stride`, the same collision and the same crowd a
            person's would. Input wins outright — a hero who argued with the keyboard for a frame
            would be unplayable — and a nudge of a key does not cancel where he was sent.

            `walkTo(x, z)` is the first thing built on it and the one that makes an automated game
            possible: a script says where the hero should be rather than which keys a person would
            have held to get him there. It clears itself on arrival, because a driver that has to be
            told to stop keeps walking when the thing that set it has gone away, and a hero pressed
            against a wall for ever is the failure nobody would think to look for. `__walkTo` on the
            page hands it to a browser probe. Deliberately not a teleport: `__teleport` drags a
            hired company along with it, so it can never answer a question about walking.

      - [x] **9f. A hire is a contract with a life.** Asked for on 2026-09-11: paying for a contract
            with a time limit; while it runs he follows whoever owns it; when it runs out he offers
            an extension for a price, or he leaves. A bargain had no end at all — you paid once and
            he walked with you until a bear got him, which made the fee a one-off purchase *of a
            person* rather than a wage. `Bargain.until` now, `HIRE.TERM` days, `nearlyUp` so he
            brings it up before the morning he would go, `askingAgain` (dearer than the first, never
            cheaper, or the way to hire a man for a season would be to hire him for a day eight
            times), and `ranOut` which hands back whoever has served their days so somebody can be
            *told* — a man who leaves without a word is indistinguishable from one who fell down a
            hole. The following-and-fighting half already existed in the `hired` tree.
      - [x] **9g. Issuing verbs to a hireling.** `ORDERS` — follow, hold, fight — kept on the
            contract rather than on the body, because the body is despawned when you walk off and an
            order kept on it would be forgotten by walking round a corner; `muster` presses it back
            on the way it already does his trade. A `told` ask in the vocabulary is the one word in
            it about being *instructed* rather than about what a creature wants or notices, which is
            the whole difference between a villager and a man in your pay. `markFoe` went in because
            `markTrouble` waits for the teeth to be on somebody — a guard waits, a man told to go in
            does not — and `markPrey` hunts people, which is not what ordering a sword arm means.

            **It found a bug with teeth.** `forget` was its own branch in the `hired` tree, `act`
            returns success, and `first` is a selector — so a standing `forget` swallowed every
            quiet tick and the follow branch below it was unreachable. **A hired man had never once
            walked after anybody.** It read as working because a hero who teleports drags his
            company with him and `muster` re-seats them every half second, so the only way to see it
            was to walk. Measured after the fix: unbidden they are in `walk` and move with you;
            told to hold they go `idle` and stay where they were put.
      - [x] **9g-2. An order is a sentence.** Put as `<somebody> told <somebody else> <something>`,
            which is the right shape and changed the code: `Told { by, to, what, at? }`. `by` is
            checked — nobody gives orders to another man's sword, which `Bargain.side` has always
            known about the bargain itself — and `at` is the half a bare word had no room for.
            "Wait" and "wait *there*" are different instructions and the second is the one anybody
            means: `waitAt` walks him back to the spot when the separation sweep shoves him off it.
      - [~] **9g-3. Orders beyond three — considered and declined, for now.** Looked at properly and
            each candidate is either already covered or costs more than it buys.

            *Guard a place* is `hold` with `at`, which exists. *Guard a person* needs a person-picker
            in the dialogue, and a company is at most `HIRE.MOST` two — so the only person to pick is
            the other sword, which is a rear-guard nobody asked for. *Fetch* and *carry* need an item
            or a pack to aim at, which means targeting things on the ground through a menu: real
            plumbing for an order that, with a man who already follows you everywhere, saves a walk
            of a few paces.

            The shape is ready if a need turns up. `Told` is a sentence — `by`, `to`, `what`, `at` —
            and `whom` is one field beside `at`. Declining is cheaper than building a fourth order
            nobody has wanted and then owning it.

- [x] **11. Hunger is hearts.** Asked for on 2026-09-11: hearts are the unit, a villager loses one
      every so many days without food, dies at nought, and below three goes looking for something to
      eat. `FOOD.HEARTS` is six — the `villager` body's own hit points, so the bar over his head and
      the line in the register are one number — and `HEART_EVERY` is five days. A heart a *day* was
      tried and is wrong: hunger is the pressure under this economy, not an emergency, and something
      that kills in six days either never happens or ends the village. A month of not eating is
      fatal; a bad week is visible and survivable, which is what sends a man down a mine.
      `street.ts` stands a villager up with the hearts he actually has left, so a starving man looks
      starving; `eatSomething` is the verb that spends on a meal and clears it.

- [x] **12. Villagers buy and sell between each other.** A hunter's deer used to go to whoever in the
      village had the deepest purse, which meant he walked it past a man who had not eaten in a
      fortnight and sold it to the shopkeeper. Hunger outranks trade when what is carried is dinner,
      the buyer is fed by it, and nobody keeps a week of dinners back against the dinner in front of
      him. `DINNER` names what counts, held to the item catalogue in both directions.

- [x] **13. Every creature says what it is doing.** Asked for as "an action property defined by their
      state". Built as `doing` on a *branch* of a behaviour tree rather than as a field anybody sets:
      the branch that claimed the tick writes it, so it cannot say a man is at the face while his
      legs are carrying him to the inn. An answer derived from a trade and the hour would be a second
      opinion about which branch ran, free to disagree with the branch that actually did; this **is**
      the branch. Every villager tree is labelled — "with the cattle", "selling a kill", "buying a
      drink", "waiting where he was put".
      - [x] **13a. It reaches a page now.** `VillagerSnap.doing`, beside `trade` and `role` — the one
            field on a villager's snapshot a page could not work out for itself, because his tree
            runs on the world. Sent whole every time for the same reason `mind` is: one short string
            out of a list written in `behaviours/`, and a difference against a copy the far end may
            not have is a second thing to keep in step for no saving. The roster has the column, and
            asks the crowd for it itself rather than being handed it. A withdrawn answer blanks
            rather than sticking — a stale sentence is worse than a blank, because a blank is honest.

- [x] **15. Health on one scale, and the hearts retired.** Asked for on 2026-09-11: a wider scale for
      resolution and for power scaling, because an experienced hero being killed by a wolf in five
      or six bites is ridiculous. Measured before touching anything: it was **four** bites.

      The cause was the hearts, and not as a metaphor. Ten of them can say ten things, so the
      smallest expressible blow *was* a tenth of the hero — nothing could hit for less, and nothing
      could be tougher than ten bites without being tougher than everything. Everything alive is on
      one scale now where `HEALTH.FULL` is a hundred: villager 60, wolf 30, bear 200, troll 280, Old
      Nettle 480, hero 100 and room above it. Forty data values and every coupled constant moved
      with it — `PROWESS.PER_DANGER` 3 → 0.3 so a fight teaches exactly what it did, `GIFT.PHYSIC`
      3 → 30 so an apple is a snack rather than medicine, the blow floors, the warband's numbers.

      **`dangerous` is `damage` now**, which is the rename that mattered most: it was the number a
      creature hits for *and* read as a boolean, and that ambiguity is precisely why a rescale that
      searched for "damage" found none of the creatures. The behaviour-tree *question* keeps the
      name `dangerous`, because as a question it is the right word.

      `Living` is the third trait beside `Holder` and `Pack` — one shape for a wolf, a villager and
      the hero — and `share` is what a bar draws, uniform whatever the maximum. The HUD is a bar and
      a number where it was a row of hearts: the bar keeps what hearts were good at, and the number
      says the thing hearts never could, which is how tough you have become. A percentage alone
      would throw that away, which is why the number underneath is a number.
      - [x] **15a. Power scaling.** `PROWESS.TOUGHER` — forty more of you per level, against a
            hundred to start with, so a man at the top of the table has three times the health he
            set out with before he puts anything on. The bestiary does not move: a wolf hits for what
            a wolf has always hit for and the hero grows past it, which is the difference between
            power scaling and inflation. Derived from `practice` rather than saved, or it would be a
            second copy free to disagree with the first.

            **A level heals you**, which was found by the test rather than designed: a level adds
            capacity and without this it adds an *empty bar*, so you arrive at a new level on
            whatever the fight left you and the reward for getting better at fighting is looking
            worse. Yes, that makes a level-up in a fight a free heal. Five levels in a career, each
            dearer than the last — handing that moment over quietly while the bar does not move is
            the worse bug.

- [x] **18. The suite stopped being believable under load.** Three failures in one morning, a
      different server file each time, always "waited for welcome and got nothing", every one of them
      passing alone. Four files bind a real socket and grow a real world, and `chore release` runs the
      suite — so a flake there is a release that fails for no reason. `retry: 1` in the vitest config,
      deliberately not two: a test that needs three goes is a test nobody believes, and something
      actually broken still fails twice.

- [x] **16. The Domesday Book.** Asked for on 2026-09-11: a tool like the character builder showing
      every villager in the world, live, so the economy and the world operating system can be
      watched rather than guessed at. `server/domesday.ts`, `GET /registry`, `tools/registry.html`
      — the book keeps its name on the page and answers to `registry` everywhere a machine reads it,
      because a name worth having in a heading is not a name worth typing into an address bar.

      **It had to be on the server and that is the whole point of it.** A page holds villagers as
      guests: the world owns them, runs their trees, keeps their register. So the server can say
      what every soul in the country is presently *doing* — the branch of a behaviour tree that
      claimed the last tick — and a page cannot, because `doing` is not on the wire. The same goes
      for scope: a page knows the chunks near its hero, the world knows every village it has
      founded.

      A window rather than a door: behind the same tokens as `/operate`, happy with the read-only
      one, and it changes nothing. It surveys what the world has actually founded rather than
      founding villages to look at them — founding needs grown ground under it, and a village
      founded from a half-grown world gets the wrong trades *permanently*, which is the same hazard
      `VillagerSnap.trades` exists to prevent.

      - [x] **16a. Births and deaths as a stream.** `server/chronicle.ts`. `Register.advance` has
            always handed back every birth, death, emptied village and resettlement, and every caller
            in the game threw the list away after acting on it. A ring of the last thousand, in
            memory, per world — not a log, because a world that runs for a month has tens of
            thousands of these and there is no version of "keep them all" that ends well. Read by
            number rather than by time: a world lives a day in a second and two deaths in one
            millisecond are ordinary, so a reader polling on a clock would see one and never the
            other. The book shows it and keeps its own history, because the server only sends the
            part that is new.

            **Worth knowing about how it behaves:** a world day is `DAY_LENGTH` 7,200 seconds — two
            hours. So in a short session the panel is empty and correct, and it earns its keep on a
            world that has been running for days, which is the homelab case it was asked for.
      - [x] **16b. A child was out hunting.** The book found it within a minute of first rendering:
            Kees Bakker, nine years old, trade "—", `doing` "out hunting". A body is given a rolled
            trade so a stranger has a day to follow, and the line meant to overwrite it read
            `if (resident.trade !== '')` — which looks like care and is the opposite of it. Fixed in
            0.54.2; the test asserts the rule rather than the symptom, because a test that went
            looking for a child specifically found none out at all in four villages.

- [x] **14. The risk-and-reward of a living.** Mining easy and poorly paid, a hired sword dear
      because his life is on the line. Going to tune it found a plain bug instead: `asking` is
      documented as *a day's* fighting, and when contracts gained a term the fee did not move — so
      one day's price bought six days of sword, and the most dangerous work in the game was also the
      cheapest thing in it. Nothing in the dialogue said so either way.

      A contract is `asking × TERM` now: ninety gold in the poorest village, three hundred and sixty
      in the richest, against a miner's three and a half a day. Four to seventeen times a miner's
      wage for the same days, paid up front, which is the shape that was asked for. The price stays
      quoted by the day because that is how a man thinks about what he is worth, and because the
      term can move without every price in the world being re-reckoned.

- [x] **17. A commission takes an object.** Raised as "build doesn't just apply to a house — the
      build verb requires a *what*". `Work.what` and `Commission.what` carry it, and `BUILDS` is the
      list it comes from, one entry long today. The list being short is the point rather than an
      excuse: a second storey, a bath house and a paddock all already exist in this world — a village
      raises them out of what it has earned — and none can be *ordered*, which is the gap the list is
      there to be filled from. Optional on the record because every commission written down before
      there was a choice was a house, and a save from last week is not wrong, it is old.
      - [x] **17a. The rest of a specification — the catalogue has four lines in it now.**
            Looked at properly. The argument exists and now survives the whole way: `place` was
            dropping it and writing `house:` into the id, so `Commission.what` was a field nothing
            read — fixed, and the id names what was ordered so two different things on one tile are
            two buildings rather than one that changed its mind.

            What cannot be done yet is *offer* anything else. A commissioned building is drawn by
            `render/site.ts` at four stages — pegs, frame, roof, house — and each is one piece of
            geometry. A second entry in `BUILDS` needs a second set of it, plus its collision, plus
            a price and a number of days. That is modelling work, not deed work, and inventing what
            an ordered bath house looks like is exactly the kind of guess this list exists to avoid.

            Size is deliberately fixed and should stay so: `BUILD.PLOT` is pinned at one because the
            ground check is the world's own, and a house asking for more ground than a village house
            could not be put anywhere a village house can. Facing is already chosen — it comes off
            the way the hero was standing.

            So the gap is a building, and the day there is one the catalogue grows by a line.

            **Unblocked on 2026-09-11 by the person who asked for it**, with a design rather than a
            model: a base cost per thing to start with, until builders are given prices of their
            own; you tell the builder where; and — the part that was not in the system at all —
            *some things depend on a piece of land and some depend on their parent building*. A
            swimming pool, a fountain and a second storey all belong to the house they are attached
            to.

            **And the geometry turned out to be here already.** `house()` has taken a number of
            storeys since villagers started spending an inheritance on one, and `PropKind.Sauna`
            and `PropKind.Pool` were modelled and used by nothing at all. Three of the four entries
            in the catalogue are geometry that was already in the game; only the fountain and the
            two-storey chimney are new. The blocker was a day of modelling that had mostly been
            done and not looked for.

            What went in:

            - `CATALOGUE` — a house (420g, 6 days), a second storey (260g, 4), a bathing pool
              (150g, 3) and a fountain (90g, 2). Each carries `on: 'land' | 'house'`, whether
              finishing it `changes` the thing it was added to, how much ground it is a wall to, and
              what the builder says when it is done. `BUILD.PRICE` and `BUILD.DAYS` stay as the
              house's numbers and the catalogue reads them, so there is one home for each.
            - `Commission.to` — what an addition was added to, carried through `place`, the save,
              and the wire. Without the last of those somebody else's bathing pool is drawn on your
              screen as a cottage, which is how the field was found to be missing.
            - `beside` — an addition stands on the side of the house its owner was standing on,
              which is the same statement of intent the house's own facing comes from. A storey is
              the exception and sits on the house, because it *is* the house.
            - `canAttachTo` — four refusals, each a sentence somebody would say: nothing to put it
              on, the house is still a frame, the house is not paid for ("I do not start the next on
              credit"), and it has a storey already.
            - `storeysOf` — counted from the commissions rather than written down when the work
              ends, like everything else here. A world reopened after a fortnight finds the storey
              on the house because it always was.
            - `onOffer` — what the builder will take on, given what you own. It is his rule and not
              the pub's; the pub is only where he drinks.
            - `propOf` in `render/site.ts` — per kind, per stage. A pool and a fountain are pegs and
              string until the last day. A storey draws nothing at any stage: it is not a thing
              beside a house, so while it goes up the house looks as it did and on the last day it
              is a floor taller. A frame drawn for it would be a timber skeleton inside a finished
              cottage that a player can walk through, which is a worse lie than nothing.

            Twenty-four tests, and a browser was walked into the yard to check: a two-storey house
            with a pool beside it and a fountain in front of it. `chore shots -- estate` is the
            picture, in the README.

## Found while playing it on the homelab — September 11th

- [x] **20. A fixed jetty that stayed broken.** Reported three times, and the first two answers were
      wrong because they were measured on freshly generated ground, which was never the problem. The
      pier was drawn down at the seabed with the sea over it while the hero walked the deck in
      mid-air above — and the build on the screen *had* the fix.

      A page keeps every chunk the world sends it for ever. The guard against staleness is
      `worldStamp`, and it had two holes a jetty falls straight through: the hash is of chunk
      nought, so anything rare — a jetty, a bridge, a cave mouth — never moves it, and it hashed
      `height` but not `corners`, so "walkable but drawn somewhere else" was invisible to the one
      mechanism meant to catch exactly that. Corners and slopes are hashed now, and the build's
      version is in the key: **every release drops kept country**, which is the decision, taken
      knowingly.

      What it costs, measured: a packed chunk is **11.4 KB** (16 tiles square, typed arrays,
      uncompressed), so an afternoon's walk of about 1,600 chunks is ~18 MB re-fetched once per
      release, and the 8,000-chunk cap is ~89 MB in a browser. Worth absorbing. If it ever stops
      being worth absorbing, the parcel is raw arrays and would compress hard — that is the lever,
      and it has not been pulled because nobody has felt this yet.

- [x] **21. The ferry, the fare and the missing 404.** `tryBoat` ran before `tryFerry`, so a jetty
      with a ferry tied up at it answered as a boatwright selling hulls. The ferry answers first and
      a crossing costs `fareFor` — six gold plus a tenth a tile, capped near a tenth of a boat — paid
      to the village the pier belongs to. Separately: every missing file was answered with the
      plain-text status page and a 200, which is why a missing web app manifest arrived in the
      console as `Manifest: Line: 1, column: 1, Syntax error.` A path that names a file and has none
      is a 404 now, and `.webmanifest` has a content type.

- [x] **22. Kills that left nothing.** Only in a shared world, which is every world with anybody
      else in it: `spoils` both worked out what a body was worth and banked it, so the online caller
      banked it twice and the co-op caller not at all; and no carcass was left, so there was nothing
      to take a hide off. Both have tests now — `authority.test.ts` is the seam between the two
      halves, and unplugging either fix fails it.

## Still to do, at the end — September 11th

- [x] **19. The screenshots are out of date.** Twenty of them in `README.md`, all taken on or before
      September 4th, and the game has moved a long way since: hearts are a bar and a number now, the
      cattle stand in the fields, villagers buy their drink at the inn, the roster has a column for
      what everybody is doing, and the Domesday Book did not exist. Some of them are showing a game
      nobody can play any more.

      Asked for explicitly, to be done at the end rather than alongside: a screenshot taken in the
      middle of a run of changes is a screenshot that is out of date by the time the run finishes.
      `docs/screenshots/` has the list; the borrowed-playwright recipe in
      [[headless-probe-recipe]] is how they are taken, and `?seed&x&z` puts the camera where it
      needs to be.

      Worth adding as well as replacing: the Domesday Book, a field with cattle and the farmer
      working them, and the health bar — none of which any existing shot shows.

      **Done, and the fix is a tool rather than twenty new pictures.** `tools/shots.cjs`, run as
      `chore shots` (or `chore shots -- town night` for one or two), takes each picture by driving
      the game through the probes: it names the world, the seed, where the camera goes and what has
      to happen first. Nobody has to rediscover where a shot was taken from, and a stale picture is
      now one command from being current rather than an afternoon.

      Retaken on 0.61.0: town, night, autumn, winter, farming, horse, interior, dungeon, rucksack,
      map and phone. Added: **cattle** (the herd and the farmer whose day they are), **health**
      (health, breath and the sword arm, all out of a hundred) and **domesday** (the book itself,
      against a world server with a player in it).

      Three things it found on the way, which is the argument for taking pictures with a script:

      - **Autumn was green.** A season is `SEASON_LENGTH` — seven — days, so days 200 and 290 are
        spring and summer. The first pair of numbers picked looked like late in a long year.
      - **The graphics were turned down in every shot.** A headless browser draws at ten frames a
        second, so auto-quality steps to `low` — no shadows — within seconds. The tool now writes
        `high` as the *player's* choice, which is the one thing auto-quality will not argue with.
      - **Breath was still ten dots.** Health became a bar and a number out of a hundred in the
        rescale and breath did not, so two readouts an inch apart disagreed about what a full meter
        looks like. Both are bars out of a hundred now.

      What was **not** retaken, and why: the sea and the shared-world shots — whales, sharks,
      sailing, island, multiplayer, market, stall, players, partymap, duel, emote, woodland. The
      first group needs a boat put under the hero and a pod that happens to be breaching; the
      second needs two browsers in one world. Both are shots the tool could learn — the shape is a
      row in `SHOTS` — and neither is stale in the way the eleven above were.

## What we talked about on the night of the 11th — September 12th

Six ideas, most of them from the person who plays it, written down before they evaporate. They are
in the order they would sensibly be built, which is not the order they arrived in.

- [ ] **23. A jetty you can commission.** `BUILDS` already takes `on: 'land' | 'house'`, so a jetty
      is a fifth entry in the catalogue. It has a reason to exist that the others do not: since
      **22** a coast that is all cliff gets no ferry at all, so an island can be cut off — and a
      player who wants one pays for the harbour. The pier tiles, the stepping-down and the dock are
      all built; what is missing is the order, the price and the ground check ("is this a coast at
      all, and is it low enough").

- [ ] **24. The town hall, the mayor, and what a village does with its money.** Asked for whole, and
      it answers an objection the code has been carrying since inheritance went in:

      > *"Shared out rather than banked, because there is no village pot to bank it in. A
      > `Settlement` holds food, houses, trades and people, and inventing a treasury for this would
      > be inventing a thing nothing else in the game can see or spend."* — `world/inheritance.ts`

      A mayor is somebody who can see it; a vote is something to spend it on. Both objections
      answered by the same feature.

      - The **hall** already exists — six biome variants — and is raised where a village has
        `CIVIC_HOUSES` (eight) or more. Keep that rule rather than giving every hamlet one: a town
        hall is what a village grows into, which is what makes **25** matter.
      - The **mayor's body** already exists and is already worn — by the clerk, because it was the
        body made for a town hall. Nobody has been elected to it.
      - The **purse**: `Settlement` gains one, filled by a tax each villager pays out of what they
        hold. It must obey the deed layer's one rule — a coin leaving one purse arrives in another —
        which `livelihoods.test.ts` already enforces by summing both sides.
      - The **vote**: a short list of things a village can want, each with a price. A harbour (23), a
        bridge, a well, a bath house, a granary. What they choose should follow from what they lack,
        which the register already knows: a village with no ferry, a village that went hungry.
      - And the part that closes the circle: **the village commissions the hero.** The builder verb
        goes one way today — you pay a man. A village with a purse and a vote can pay *you*.

- [ ] **25. Villages that grow, and a builder who eats.** The observation that makes 24 work: if a
      hall needs eight houses, houses have to be able to arrive. Today a village's house count is
      fixed the moment it is settled.

      Every piece is already here. `prosperity.ts` decides what a village can afford and already
      spends it on a second storey; a `Commission` already carries a village and a price; and the
      player's own houses are drawn by `BuildingSite` from commissions rather than from the world's
      structure list — *precisely because they were not there when the terrain was generated*. So a
      village's new house is the same object, drawn by the same code, on the same plot rules.

      The part worth arguing about: **the builder is not on the register today and that was
      deliberate** — "a builder who can be carried off by a wolf half way through the job is a house
      that dangles". The way to have both is the one the shops already use: the *voice* in the pub
      stays a regular who cannot die mid-job, and the *earnings* go to whoever in the village holds
      the builder's trade, falling back to the village the way `personTill` already falls back to
      `villageTill`. Then building is a living: he earns, he eats, and a village that builds keeps
      its own tradesmen fed.

- [ ] **26. The seam audit's one fix.** Five holes found on the 12th, all of the same shape: the
      world resolved a kill and the client's half of the consequence never ran. No deed judged (so
      murder online does not blacken your name), no rustling (kill a cow, nobody minds), no mine
      cleared, no trouble credited, no band told it had lost one. The fix is not five patches:
      `authority.onCreatureKilled` is a second, thinner copy of `blows.felled()`, and what a kill
      *means* should be one function both call, in `consequences.ts` where the rest of "what follows"
      already lives. `authority.test.ts` has the fake to hold it.

- [ ] **27. Zarch, the rest of it.** `game/craft.ts` flies and `PropKind.Derelict` is drawn. What is
      left: where it crashes (one to a world, on open ground, well away from the villages), climbing
      in and out, and the gun — which is `archery.ts`'s height-aware shot with a different noise,
      because that is already the one thing in the game that can reach something which is not
      standing on the ground.

- [ ] **28. The remaining screenshots, and the hunting loop walked end to end.** The sea and
      shared-world shots need a boat under the hero and two browsers in one world — both of which
      `shots.cjs` can now do, since the Domesday shot already opens a second page and joins a real
      server. And nobody has yet played kill → skin with a knife → carry the pelt to a country that
      pays for it, which is the loop **22** was supposed to make possible again.

## The economy as a simulation — September 12th

Talked through at length on the morning of the 12th. Numbered so a decision can be given as "29:
yes" rather than re-argued. Numbers are never reused, here or in chat.

- [~] **24a. The mayor enrols the trades.** *The enrolment is built* — `world/vacancies.ts`,
      `shortOf(trades, held)`, called first by `tradeTakenUp`. What a village is short of is decided
      without a list of important jobs: `TRADES` already says how common each trade should be
      against the others, so a village's establishment is that weighting applied to however many
      people work, and a vacancy is a trade a whole person short — or one nobody is doing at all
      whose establishment rounds to one. That threshold is what keeps it from swallowing inheritance
      whole: in a village of nine working people it fills the fields and the market and leaves the
      doctor, the innkeeper and the climber to families and to the tenth who strike out. Villages
      now hold five to ten of the trades their ground supports at day 450, against two to four
      before it. Still to do: the hall as a **directory** — where the doctor is, where the builder
      drinks — and vacancies as something a player can read and answer.

      The original note follows. Today a grown child takes `village.trades[random]` —
      `register.ts:638`, a coin toss. Instead the mayor looks at what the village is missing and
      enrols the next adult into it: no doctor, next adult is a doctor. A mayor exists from day one
      and is just a villager with the job; the hall is a building they eventually get, and until
      then the paperwork is magic — assumed, never counted. Enrolment is **not** a wage: nothing
      leaves the treasury, which is what keeps the hall's money free for building. The hall doubles
      as a directory — where the doctor is, where the builder drinks — which is the beginning of a
      job market, and vacancies are a thing a player can read and answer.

- [ ] **29. Provinces with a character of their own.** Asked for as "a variety of danger and
      different terrains and frontiers". A province's seed is `hash(rootSeed, px, pz)` — derived
      from where it is, never from how you got there — and from it: what lives there, how dangerous
      it is, which landscape dominates. Big structures (a range, a desert belt) come from
      low-frequency noise, which is how biomes already work; per-province flavour comes from the
      hash. No precomputation: both are evaluated where the player is standing, one hash per chunk
      against the dozens of noise samples already taken. This is the answer to the rings question,
      and it keeps the one rule the endless country rests on.

- [x] **30. A trade is inherited, not rolled.** A farmer's child takes the farm — `tradeTakenUp` in
      `world/people.ts`, called from `growUp`. Both parents are looked at and one of them followed,
      so a farmer who marries a miner raises one of each over time, and one in ten
      (`LIFE.STRIKES_OUT`) follows neither. That last tenth is not a flourish: without it a village
      whose only doctor dies childless can never have a doctor again, and every village converges on
      whichever trades happened to breed best. The churchyard is searched when the living do not know
      the name, because a farm handed on at a funeral is the ordinary case rather than the exception
      — `Burial` has kept a trade all along for exactly this sort of question. Six tests in
      `register.test.ts`, the last of which holds a village at 90 days to more than half of its
      people doing what a parent did.

- [x] **31. The sanity bench.** Built as `src/game/sanity.test.ts` and `chore sanity`: the same
      villages `chore economy` audits, lived four hundred and fifty days instead of a hundred —
      five or six generations, which is long enough for drift to show — and judged on whether they
      are still places anybody would believe in rather than on whether the books add up. Nothing in
      it is added up; every number it reads is a fact about the simulation, which is exactly what
      the audit is forbidden to touch.

      It found four things the morning it was written, and two of them were real faults.

      1. **Villages had drifted down to two trades between sixteen people**, with no farmer in the
         fields and no seller at the market — caused by **30** the day before, because inheritance
         on its own is drift: every funeral is a chance to lose a trade and no funeral is ever a
         chance to gain one back. Fixed by building the enrolment half of **24a** (below).
      2. **A herd over its cap came down by sixteen hundredths of a percent a day.** An over-full
         paddock calved while it was being sold down and the two all but cancelled, so a village
         that had buried two of its three farmers went on selling beasts nobody was keeping for a
         hundred and ninety days at a stretch. A full paddock does not calve now, and a dead man's
         beasts are worked off in about a month, which is what the comment had claimed all along.
      3. **Sixty-two per cent of all the money in the world sits in the halls**, because the tax
         went in before anything a village could vote to spend it on. Reported as a NOTE with the
         number, and it is the argument for **24b**.
      4. **One purse holds half or more of its village** in eleven of eighteen villages. Also a
         NOTE: somebody has to be the richest, but it is the shape a village takes when the money
         has stopped moving.

      And it moved one expectation. `chore economy` used to require that some village afford a bath
      house inside a hundred days; exactly one ever did, and what had been paying for it was the
      herd bug. A hundred days is one generation and that bench audits a generation's books —
      whether a village ever *grows* is a four-hundred-and-fifty-day question, and it is asked here
      now.

- [ ] **31a. The sanity bench, the rest of it.** Three of the bounds the original note asked for are
      not in it yet, because nothing they judge exists: **no village holding more buildings than
      people** (buildings are not counted per village until **44**), the herd and the fields against
      *what the land could carry* rather than against what the farmers can keep (**33** and **50**
      are what make land a quantity at all), and the upper half of the population band, which
      guards nothing until houses can lift the ceiling. Each one goes in the day its feature does.

- [ ] **32. A map of one province, priced like a week's work.** *Asked for again, harder: the map
      should be dear, or small, and the whole country dearer still — the point is that nobody gets
      hold of it easily.* A twenty-five gold trinket that lifts the fog off everything is the
      cheapest thing in the game removing the most expensive thing in it, which is the reason to
      walk anywhere.

      The original note follows. The fog and the Region Map already
      exist: `state.explored` fills in as you walk and a 25-gold trinket lifts it. Twenty-five gold
      is a tenth of a boat for the removal of every reason to explore, and in an endless world one
      map cannot cover "the region" anyway. One map per province, sold where that province is, dear
      enough to be a decision — and a thing worth carrying to the next valley, where they have never
      seen this one.

- [ ] **33. A farm you can improve.** A farmer pays a builder for a bigger stable —
      `LIVELIHOOD.HERD_PER_FARMER` becomes a number per farm rather than a constant for the world —
      or clears trees to widen the fields (`FOOD.PER_FARMER`). The first money in the game that buys
      *capacity* rather than a thing, and it gives the builder a third customer after the player and
      the village. Clearing land is the expensive half: it is a permanent difference between the
      world as generated and the world as it is, so it wants a bound — a farm may clear only so far
      from its own buildings, or a village deforests a county over a century.

- [x] **34. Households — sex on the register: agreed.** Sex on the register, so the family tree the clerk already draws reads
      properly — today `fillTheGaps` picks any two adults as mother and father. Pairs form, one or
      two children arrive, and the mechanics of neither are simulated. Population stops being capped
      at `founded` and becomes a floor: gold buys a house, a house holds a family. What must be
      measured before it ships is the doubling — the only brakes are age, hunger, wolves and
      dragons, and **31** is how we would find out. (Ticked only for the decision: sex on the
      register is agreed, and **46** and **49** are what it unlocks. The building of it is still to
      do.)

- [ ] **46. A woman looks like a woman.** The other half of **34**: sex goes on the register so the
      family tree reads properly, and the moment it is there it should be *visible* — long hair and
      a dress, which is what a medieval village looked like and what makes a street readable at the
      distance this camera watches one from. The machinery is already built and already used for
      exactly this kind of thing: `BODIES` in `entities/trades.ts` gives a miner, a farmer, a doctor,
      a constable and a priest a silhouette of their own, and the rule it follows is the one to
      follow here — the shape carries it, never the colour. Two more bodies in
      `models/creatures/`, chosen by sex rather than by trade, and a woman with a trade takes the
      trade's hat over the dress the way a real one would.

- [ ] **35. Capabilities, and holdings that outlive a person.** Two ideas that compose. A person
      carries what they can do — `can_farm`, `can_build`, `can_mine`, `can_fish` — granted by
      inheritance, by being hired and taught, or by the mayor enrolling them. A *trade* separately
      says whether the work leaves a **holding** standing when the worker dies: a farm with beasts,
      a builder's yard with jobs registered at the hall, a boat. A doctor has none, so losing one
      costs a village differently. `can_fish` is the one capability that does not exist yet and must
      be unlocked by infrastructure — no harbour, no fishermen — which is what makes **23** the
      first thing in this economy that pays for itself.

- [ ] **36. A villager who can be hurt.** A builder met by a wolf can run, fight back, or be hurt —
      and then go to the doctor, take a bed, buy medicine, or be treated for nothing. Another
      dimension for the register's people, and the first use the doctor has ever had.

- [ ] **37. The hall holds the money until the work is done.** You pay the mayor, not the builder;
      the builder registers the job at the hall; the money is handed over when the thing is
      standing. That is what lets another builder take over a half-built house when the first one is
      killed — and it answers the objection that kept builders off the register in the first place,
      that "a builder who can be carried off by a wolf half way through the job is a house that
      dangles".

- [ ] **38. A dragon takes the herd.** What a dragon is *for*, economically. It flies a round of four
      stops across a quarter of the country (`ROAM`), and a village it passes over loses beasts —
      `Settlement.herd`, the number the farmers' whole living is made of. A village does not merely
      fear it, it gets poorer, the Domesday Book shows the herd falling, and killing the thing is
      worth doing for reasons anybody in the village could explain. Better than a dragon that eats
      people, because bands already do that and because a herd is a thing the economy can feel.

- [ ] **39. A farmer hires men to keep the cows safe.** The natural answer to 38, and the machinery
      is already built: `hires.ts` has contracts with a term, a price that follows the danger, an
      extension offered before they lapse and orders you can give — all of it aimed at the player
      hiring swords. Pointing it at a villager is the same bargain with a different signatory.

      What it buys the economy is the thing it is short of: a *reason* for money to move from a
      farmer to a soldier. Soldiers earn from beyond the village today, which is the polite way of
      saying their wage is invented. A farmer paying two men to stand in a field through a dragon's
      week is money moving inside the valley for a service somebody actually needed — and if he
      does not pay, he loses beasts, which is the same decision the player makes about a warband.

- [ ] **24b. The mayor offers to build a hall.** *The argument for building it sooner rather than
      later, stated plainly: a treasury that never spends will always out-accumulate every person in
      the village, because a person has to buy dinner and a treasury does not. That is not a tax
      rate problem and lowering the rate would only slow it down — `chore sanity` measures it at
      sixty-two per cent of all the money in the world after four hundred and fifty days.* When the treasury reaches the price, the mayor puts
      it to the village and a builder raises it — the same `Commission` the player's house uses, with
      the village as the customer and the hall's purse paying. It needs a price (a hall is the most a
      village ever spends, so it wants to be a year or two of taxes rather than a season) and it is
      the first thing the treasury is *for*, which is the answer to the bench's finding that a hall
      which only collects is a drain.

- [ ] **40. Every building looks unfinished before it is finished.** `CATALOGUE` already gives each
      kind its own number of days — a house six, a storey four, a pool three, a fountain two — but
      only the house has the four stages that make waiting worth watching: pegs, frame, rafters,
      roof. A pool and a fountain are pegs and string until the last morning, and a storey draws
      nothing at all. Each kind wants its own under-construction geometry, and the day it has one is
      the day riding past a site twice is worth doing for every kind of building rather than one.

- [ ] **45. The builder builds boats.** A boat is a thing a builder makes, which gives the yard a
      customer that is not a house and gives **23** a reason beyond the ferry. It is gated by the
      ground the way every other trade is: water within reach, and a jetty to tie up at — so the
      order is harbour first (**23**), then boats, then the fishermen who work off them (**41**).
      The hulls already exist (the ferry's, the fishing boat **41** wants), and `BUILDS` already
      takes a site kind, so the new part is the water check and a mooring that belongs to whoever
      paid for it. It is also the first thing a village can build that *moves*, which is what makes
      a coastal village different from an inland one in a way a player can see from the shore.

- [ ] **41. Fishermen, and what a coast eats.** `can_fish` from **35** needs somewhere to come from
      and something to bring back. A coastal village lives partly off the water: shellfish as a
      staple — gathered rather than hunted, so it is a floor under a coastal larder the way
      `PROSPER.A_DAY` is a floor under a wage — and fish from boats, which is the paid half.
      Wants a fishing boat, a net, and the fish landed on the deck where somebody can see them;
      the boat is a model the game does not have, the net is an animation, and the catch is a
      number in `livelihoods.ts` beside the herd. The reason to build it: a harbour (**23**) that
      creates a livelihood is the first thing in this economy that pays for itself.


## What the economy is for — September 12th

Three things said while 30 was being built, which between them are the shape of the whole
simulation rather than any one feature in it.

- [ ] **42. `can_form`: a trade that can found another of itself.** A typo — `can_form` for
      `can_farm` — that turned out to name something the design was missing, and is worth keeping
      under some name. `can_farm` is a *capability*: this person knows how to work a field. `can_form`
      is the thing above it: a farmer who has earned enough can **form another farm** — buy the
      beasts, raise the shed, and put somebody in it — and a builder who has earned enough can take
      on a second yard. It is the difference between a person who does the work and a holding that
      can reproduce, and it is the engine under **25**: the money a trade earns does not only feed
      its holder, it buys the next one of itself.

      Which trades can do it follows from **35**: a trade that leaves a holding standing when its
      holder dies (a farm with beasts, a yard with jobs at the hall, a boat) is a trade that can
      found another. A doctor cannot — there is no second surgery to buy — so a village gets more
      doctors only by enrolment (**24a**), never by multiplication. That asymmetry is worth having:
      it is why a village fills up with farmers and still has exactly one doctor.

      **And it is not a property that gates people.** Every villager has it: anybody may decide to
      take up a trade, because everybody has to eat and mining, hunting and farming are how eating
      is paid for. So there is no class of villager who is barred from becoming something — what
      varies is the *trade*, not the person. Three things decide what somebody can actually be, and
      none of them is a licence: what the place supports (`Trade.needs` in `entities/trades.ts` —
      no shore, no sailor), what they were taught (inheritance, **30**), and what the village is
      short of (the mayor's enrolment, **24a**). That keeps the capability list honest: `can_farm`
      and the rest describe what somebody has *learned to do*, and are never a permission to learn
      it.

- [ ] **51. When a town grows too big, the world pushes back.** The answer to "what stops it running
      away", and a better one than a constant. A village that has outgrown what is around it is a
      village worth attacking: an ogre comes down out of the hills, a band camps on the road, wolves
      take the outlying herds. The machinery is there — `leanedOn` already makes a village poorer
      while something is standing over it, and `chore sanity` is what would tell us a place had got
      too big in the first place. The rule to hold on to: a brake the player can *see and fight* is
      worth ten brakes in a constants file.

- [ ] **52. A world that has crashed is repopulated, not restarted.** How the simulation is tuned
      once people are playing in it. A running world cannot be reset when the economy is found to be
      wrong — that is a world nobody can live in — so the honest move is to let it fail, change the
      rules, and *magic people back*: the same act that founded the world in the first place
      (**43**), used again on a village that has emptied. `resettle` already does exactly this for a
      ruin somebody's neighbour walks over to. What it needs is to be a deliberate, recorded act
      rather than a quiet one, so the Domesday Book can say a village was refounded under new rules
      on such a day.

- [ ] **53. The shrine that raises a villager.** The player's version of **52**, and the thing that
      gives a dead valley a way back. A magic shrine, a fee big enough to be a decision — the price
      of a house rather than the price of a meal — and a new soul on the register. It answers a
      question the endless world will otherwise keep asking: you walk into a village where everybody
      starved and there is nothing whatever to do about it. Shrines already exist, already take
      money and already do something when you enter one, so this is a use for a building rather than
      a building.

- [ ] **49. Houses come in sizes, and a house is what limits a family.** The other half of **44**,
      and the thing that makes the population cap a *place* rather than a number. A small, medium,
      large and huge house, each with its own model, its own building stages (**40**) and its own
      maximum occupancy. A couple has children when there is food in the store and room under the
      roof, and not otherwise — so a family that wants more children has to pay a builder for a
      bigger house, which is another customer for the yard and another reason for money to move.
      And if the food runs short they go hungry and die, which the register already does properly:
      `hungry` is on the roll, `cause: 'hunger'` is on the stone, and nothing about starving has to
      be invented for this.

      It also gives `founded` an honest definition at last: a village holds as many people as its
      houses have room for, so growing is building and nothing else.

- [ ] **50. A logger, and wood as the first material.** Every price in this world is paid in coin
      and nothing is ever short of anything — which is why a builder can, in principle, build until
      the money runs out. Wood is the answer: a logger fells trees and brings the timber to market,
      the builder buys it, and a house cannot be built out of an empty yard however much gold is on
      the table.

      What it buys is a *limit that is not arithmetic*. A village on a plain with a wood behind it
      builds; one on a rock does not, whatever it earns. It gives the farmer a second reason to
      hire (**39** is guards, this is clearing — and **33**'s wider fields produce the timber as a
      by-product, so clearing land and having wood to build with are the same act). It gives the
      market something to actually trade that is not meat. And it is the first thing in this
      economy where two trades need each other rather than both needing the player.

      The trees are already there and already felled by the player's axe, so the ground truth
      exists: what is missing is a stock of timber somewhere a builder can be short of it.

- [ ] **47. A holding has an owner, and the owner need not be the worker.** A farm belongs to
      whoever paid to build it. Normally that is the farmer, and when he dies it passes down the
      family the way his purse does. But the hall can pay for one too — the same `Commission`, with
      the village as the customer — and then the village owns the farm and *hires* somebody to work
      it. The inheritance is the hall's: the worker dies, the farm does not change hands, and the
      mayor enrols the next pair of arms into it (**24a**).

      That is the piece that makes a treasury do something no individual can. A village that has
      lost its farms to a bad decade cannot wait for a rich farmer to appear; it can vote to buy
      one back. And it gives the wage a reason to exist — a hired hand on the village's farm is
      paid by the hall out of what the farm earns, which is money moving inside the valley for work
      somebody actually needed, the same shape as **39**.

- [ ] **48. A village becomes a town becomes a city.** Falls out of **44** for free: if buildings
      are what a village's population is capped by, then buildings are also what a village *is*.
      Count them and a place has a rank — hamlet, village, town, city — reached by nothing but the
      economy growing, never by a rule saying "this seed places a city here". The hall already
      works this way at one threshold (`CIVIC_HOUSES`, eight, is what earns a village its town
      hall), so this is that idea taken the whole distance.

      What a rank should *do* is the part to get right, and the answer that keeps it honest is: it
      unlocks buildings and trades rather than making numbers bigger. A town can hold a market and
      a watch house; a city can hold things no village has ever had. The player would see it
      without being told — arriving at the same valley a year later and finding a skyline is worth
      more than any label — and it gives the Domesday Book something it has never had, which is a
      village that is *going somewhere*.

- [ ] **43. The world starts established, and the economy's job is to keep it that way.** Stated
      plainly, because it changes what the bench is measuring: the first villages are *put* there.
      They are not bootstrapped from one family with an axe — a world that had to grow itself from
      nothing before anything was interesting would be a boring world to arrive in. The seed places
      villages of the size they would have reached, with a food store, a herd and a spread of ages,
      and the assumption is that they have been standing for years.

      So the economy is never asked to *create* a civilisation; it is asked to **sustain** one and
      then to grow it. That makes the sanity bench (**31**) a test of survival before it is a test of
      growth: run the villages the seed actually places, for 400 days, and the first question is
      whether they are still there. A model that cannot hold what it was handed has failed before
      any question about expansion is worth asking.

- [ ] **44. Houses are the cap, and tax is how a village lifts it.** The loop that makes the whole
      thing drive itself, and every piece of it exists except the joins:

      1. `register.ts` will not let a village grow past the size it was founded at — births only
         backfill the dead (`const missing = village.founded - village.people.length`). Houses are
         what that ceiling should be made of: a house holds a household, so `founded` rises when a
         house is raised and never otherwise.
      2. A house is decided on by whoever can pay for it — a villager with enough gold, or the hall
         with enough tax (**24b**). Wealth is already tracked per person and `prosperity.ts` already
         spends it on a second storey.
      3. The mayor knows where the builder is (**24a**, the hall as a directory), the builder takes
         the job (**37**, the hall holding the money until it is finished), and the house goes up
         the way the player's own house does — a `Commission` drawn by `BuildingSite`.
      4. More people means more earners, which means more tax, which means the next house.

      The brake has to be ground rather than arithmetic: a new house needs a plot that passes the
      same footprint check the player's does, so a village in a narrow valley simply runs out of
      room while one on a plain keeps going. That is also what makes two villages in one world
      different from each other without anybody writing a rule saying so.

## The wreck, and what is under a hull — September 12th

- [x] **54. A shipwreck you can go aboard, and the drowned hold under it.** A hull on a beach was a
      chest with a boat drawn round it: press Enter, take the salvage, and be told forever
      afterwards that it was picked clean. It is a way in now — "Go below" at any wreck — and below
      the waterline she is flooded.

      Almost all of it was already built. The `sunken` floor style has existed since the whirlpools
      went in (green-black light, water underfoot), and a wreck already had an anchor of its own,
      `wreck:<id>`, which is what remembers whether the hold has been picked over. What was missing
      was the door, a roster, and a word.

      - **The roster.** A drowned hold is not a cave with water in it, so it does not draw from the
        depth table: `properties/spawning.json` has a `drowned` group — fish-folk 6, squid 3, shark
        2 — and `dungeonMonsters(floor, style)` hands it back for anything flooded. Fish-folk are
        most of it because a fight in waist-deep water wants numbers; the squid is what makes a room
        cost you something to cross; the shark is there because it is the one creature in the game
        that belongs both out in the open sea and in the dark under a hull.
      - **Two new creatures**, `models/creatures/squid.json` and `fishfolk.json`, with properties in
        `properties/sea.json`. Both use behaviour trees that already existed.
      - **And the word.** This is the part worth remembering. A floor's *style* decides its rooms —
        `generateDungeon(seed, style, floor)` grows a flooded hold differently from a vault — and the
        style was never sent over the wire: the world grew every floor from the anchor kind alone.
        So a shared-world wreck would have been a hold on the page and a vault on the server, with
        every creature in it standing inside a wall. `floor` carries a `style` now (PROTOCOL_VERSION
        18), and the same fix quietly corrects two places that were already wrong this way: a
        whirlpool's cavern and a castle.

- [ ] **55. What else is down there.** The hold is a fight and a few chests today. What it wants, in
      the order it would be built: something to *find* that is worth the swim (a wreck is where a
      cargo went down, so the salvage should be better than a cave's), a reason the fish-folk are
      there rather than a spawn table, and the flooding itself doing something — deep water you
      swim rather than walk, which `breath.ts` already has the machinery for.

## The tower, and the rest of the morning's list — September 12th

- [x] **56. A watchtower with a man on it.** A watchtower has stood in this country since the first
      landmarks went in and has never been anything but a shape on a hill. A hired sword can be told
      to take one now: he walks to the foot of it, stands on the fighting platform, and puts arrows
      into whatever comes near enough to be worth one.

      Four pieces, and the interesting one is the last.

      - **`Entity.perch`** — the height somebody is standing at when it is not the ground's. A prop
        is something to walk round rather than something to stand on, so without this a man on a
        platform is dragged down to the grass a few frames later.
      - **`takePost` and `loose`** (`entities/posted.ts`). `loose` is its own verb rather than a
        bite with a long reach: it measures the *flight* of the arrow the way `archery.ts` does, so
        a man twenty feet up reaches things a man beside the tower cannot, and it never closes the
        distance — a bowman who walks toward what he is shooting at has thrown away the only thing a
        bow is for.
      - **The `watch` order**, above the trouble branch in the `hired` tree so that a posted man does
        not climb down to hit a wolf with his sword, and wrapped so a *quiet* watch still claims the
        tick — without that the first wolf a mile off empties the tower.
      - **And coming down is a property of walking, not a verb.** A man knocked off a tower has to
        come down just as surely as one told to go somewhere else, so the climb-down is in the walk
        case in `entity.ts`: it must happen *before* the step, because `slide` refuses a step that
        drops twenty feet and he would otherwise stand in the air for ever with his legs going.

      Seven tests drive the real compiled tree. What has **not** been done is walking it in a
      browser: the villages near a tower on the seeds tried had no soldier standing in the street to
      hire. `__entitiesFull` now reports height, trade and what somebody is doing, which is what that
      check needs when a soldier is to hand.

- [ ] **56a. Who else can post a guard.** The order today is the player's, which is the smallest
      version of the idea and not the one that matters. A farmer should be able to hire a man to
      stand over his herd (**39**) and a village should be able to post one on its own tower out of
      the treasury (**24b**) — `hires.ts` already names the side every bargain is fought for, so
      neither is a new kind of bargain. And a tower should be something a village can *build*
      (**44**, **50**): a tower that has to be paid for and manned is the first building in this
      economy whose worth is obvious from the road.

- [ ] **57. Where new people come from, when a valley has emptied.** Three ideas that are one idea.
      The shrine that raises a villager (**53**) must be **expensive and rare** — it is magic, and
      magic that is affordable is a tap. The ordinary way should be **people walking in**: an
      explorer or a hiker from another village finds an empty place and, if there is more food and
      more money in it than where they came from, they move. `resettle` already does exactly this
      for a ruin whose neighbour walks over, so the machinery is there and what is missing is the
      *reason* — a comparison between two villages that anybody could make.

      And it buys something neither of the other two do: **families that are not from here**. A
      village left alone marries its own children to each other for four hundred days; somebody
      arriving from three valleys away is new blood, and the day the register knows that is the day
      **inherited features** become worth having — a face, a build, a colouring passed down the way
      a trade is (**30**), so that a stranger's children look like the stranger. The faces are
      already generated per person; what they are not yet is *inherited*.

- [ ] **58. A hero who can swim.** Deep water is a wall today: you wade to your chest and stop. If
      you could swim, the map changes shape — every island you can see becomes somewhere you could
      *try* to reach, and the things already in the water become the reason not to. The pieces are
      there: `breath.ts` holds a lungful and counts it down, sharks and orcas already hunt anything
      afloat, and `swallows.ts` knows what to do with somebody who goes under. What it needs is a
      stroke that is slower than walking, a shore you can always climb back onto, and the honest
      answer to being caught out in deep water with a fin behind you.

## Retiring the bounded world — September 12th

Asked for outright: *"I want the endless world, this is the future of the map, we should retire the
bounded world."* What follows is what actually stands between here and that, found by reading rather
than by remembering — and the first thing found was that the gap is not where the code says it is.

- [ ] **59. The endless country becomes the country.** `EDGE_OF_THE_WORLD = 480` is the world today.
      The endless one is built, proved and wired to nothing: `src/world/endless.ts` is imported by
      its own tests and by nothing else in the game.

- [x] **59a. What the generator still owes — nothing, as it turns out.** `samplerIn(seed, within)`
      already answers with roads, water, villages, signposts, caves, wrecks, ferries *and rock*:
      `localrock.ts` stands mountains on the high country and `endless.test.ts` holds two
      overlapping patches to identical summits in the ground they share. The comment at the top of
      `endless.ts` still says the rock is the one thing missing, and it is stale — that was true when
      it was written and has not been true since B6.

- [x] **59b. A patchwork, so the game can hold a country with no edge.** `src/world/patchwork.ts`.
      The endless world answers for *a patch*; everything in this game hangs off one sampler grown
      once. A `Patchwork` holds a bounded number of patch samplers, routes a question to the patch it
      falls in, grows one when it is first asked for and drops the least recently wanted. Squares are
      512 tiles — a province's own number, so "load the province I am walking into" and "grow the
      ground I am walking into" are one boundary crossing rather than two out of step — and no chunk
      ever straddles two. Eleven tests, the load-bearing one being that a chunk fetched through the
      patchwork is tile-for-tile what that patch's own sampler paints.

- [x] **59c. The chunk workers can be handed a patch instead of a world.** There is a `patch`
      message now: the same three things `init` carries — roads, water, buildings — plus the name of
      the square they belong to. A worker keeps `PATCHES_PER_WORKER` of them and paints a chunk from
      the one it names; a chunk that names none is painted from `whole`, exactly as before, so a
      bounded world and an endless one can both be true without anything having to decide.

      Two decisions worth keeping. The patches are grown on the *main thread* and sent, rather than
      grown in each worker: the other way is three times the work and, worse, three separately-grown
      countries that then have to agree. And there is no acknowledgement — messages arrive in order,
      so a `patch` followed by a `gen` is a chunk painted by that patch, and an ack would only put a
      worker that is about to be busy back on the idle pile.

      The bookkeeping is `Tellings`, in `patchwork.ts` beside the thing it mirrors, because it is
      one rule with two ends: the main thread only sends a patch it believes a worker has not got,
      and a worker that quietly dropped one the main thread still thinks it holds is a chunk request
      that paints nothing and never answers. Both ends keep the same number and drop in the same
      order, and four tests hold them to it.

- [~] **59d. `growCountry` grows one of everything.** *It grows an endless one now, and the endless
      one is playable.* `?world=endless` boots: a `PatchCountry` round the origin, the patch's own
      sampler, the chunk manager handed the patchwork so each chunk is painted by the patch it falls
      in. Walked in a browser on seed 7 — ground, roads, a river, terraced cliffs, farmland, eighty
      creatures, a hero standing on it, and the minimap drawn. It is a country.

      What it is not yet is *endless*: nothing calls `moveTo`, so the sampler never changes and the
      hero would walk off the edge of the first patch into nothing. That is the next thing, and the
      screenshot is the reason it is worth doing rather than an argument that it might be.

      One known complaint, and it is the right one: *"This world does not match the one you joined"*.
      The page grew an endless country and the world it joined grew a road one. That is **59f**, and
      the fingerprint catching it on the first run is the two-halves bench doing exactly what it was
      built for.

      *Started earlier:* `PatchCountry` is the shape the
      game will hold instead of a sampler: there is a *current* sampler, it is the one for the patch
      the hero is standing in, and it changes when he walks into another. Everything that already
      asks the sampler about the ground *under it* keeps working unchanged, because the ground under
      it is exactly what the current patch answers for. A crossing is announced rather than silent —
      `moveTo` returns the patch walked into — because the mountains in the scene, the eyries and
      what the workers have been told all belong to the patch that was left, and something has to
      rebuild them once, then, rather than every frame or never. It follows a position rather than
      holding the player, because the world server wants the same object and has no player.

      The original note follows.

- [~] **59d-i. What is left of it.** *The mountains are done.* Three things held the world's rock
      and each would have failed differently on a patch crossing: the mesh in the scene (a range
      dragged along behind the hero until the sky is a wall), `ChunkManager.ranges` (which is what
      `heightAt` and the walking checks read, so a stale one is a hero standing on the memory of a
      mountain in the next province), and `Skyline` (a camera making room for peaks a province
      behind him). All three can be told now — `Mountains.show`, `chunks.standOn`,
      `skyline.standingBefore` — and the live path already goes through the first of them, so there
      is one way of standing rock up rather than two. `Mountains` owns the three things that have to
      happen together on a swap: the old mesh leaves, its geometry is disposed, the new one is built.
      Handed the same ranges twice it does nothing, which is what makes it safe to call on every
      crossing. Six tests.

      Left: the eyries, planned across the whole world; the sky islands, planned from the whole
      world's islands; and whatever else turns out to hold a list with no end in it.

- [ ] **59e. Ten places in the game layer ask for `sampler.structures`.** The villages list, the
      nearest village, what is standing near a point. In a patchwork the honest version of each is
      "within so many tiles of here", which is what they all actually mean.

- [ ] **59f. Both halves have to switch together.** `server/sim.ts` grows its world the same way, and
      `growworld.ts` exists precisely so that neither half can grow a country the other cannot see.
      An endless world needs the same treatment: one call, both halves, and `twohalves.test.ts`
      pointed at it.

- [x] **59g. A save says which world it is.** `WorldKind` is `'road' | 'endless'` again, `kindOf`
      answers `endless` when a save says so, and `?world=endless` on a link asks for one — but only
      where there is no save to contradict it, so a shared link can never open somebody's own world
      as the wrong country.

      Done early, and deliberately before the game can grow one on purpose, because it is the one
      mistake in this whole list that cannot be undone afterwards: a world written as endless and
      read back as a road world puts a house, a sown field and every anchor in the manifest
      somewhere that is now open sea, and there is nothing left in the save that says which of the
      two it meant.

- [ ] **59g-i. And the title screen offers it.** The kind is readable and writable now; what nobody
      can do yet is *choose* one without editing a link. That waits until an endless world is worth
      choosing.

- [x] **59g-old. The original note, kept for why it mattered.** `WorldKind` had been `'road'` alone since the polygon
      world was retired, and `kindOf` quietly answers `'road'` to anything. The same seed grows a
      completely different country as an endless one, so opening an old save as the new kind would
      move the ground out from under every house, field and anchor in it. The kind comes back, and
      it travels with the join.

- [ ] **59h. And then the edge comes out.** `EDGE_OF_THE_WORLD`, the island plan, the road tree and
      everything that reads them. Last, not first: the bounded world is what everybody is playing
      until the day the endless one is better, and it is also the reference the endless one is
      checked against.

- [ ] **60. Country grown off the main thread.** Measured today and it is the number that decides the
      whole shape of an endless world: **a patch takes about five seconds to grow and a hundred and
      thirty milliseconds to rebuild from its parts.** Growing one on the main thread is a five second
      freeze; warming the eight neighbours is three quarters of a minute, which is what the first
      walk across an endless world actually did — the game stopped and never came back.

      So a worker grows patches and hands back `PatchParts` — roads, water, buildings and the cut
      rock — and both sides put them together with `rebuildPatch`. What does *not* cross is the land
      itself, a pair of functions over noise, and it does not have to: it is a pure function of the
      seed and costs nothing to make again on the far side.

      What is left to build is the worker itself and what asks it: grow the patch you are in first,
      the one you are walking toward next, and the rest when nothing is waiting. Until then a
      crossing is a five second stall, which is playable and is not shippable.

## Seeing what is in front of you — September 12th

- [x] **62. The see-through circle, on demand — and on a key.** `2`, because every letter on the
      keyboard is already a verb, a panel or a spell and `q`/`e` turn the camera; `1` opens the
      roster and this is the next digit along. A key rather than only a switch in Options because it
      is wanted *now*: you are behind a wall, you cannot see yourself, and walking to a menu to fix
      that is the same problem twice. It says which way it has gone, because a hole you cannot see
      through a clear doorway is indistinguishable from one that did not turn on. The key and the
      switch are the same switch — pressing it moves the tick in Options — and both remember. It existed once and was taken out, and the reason is
      worth keeping: it was hiding a collision fault rather than a sight problem — things you could
      walk into were being quietly made transparent, so nobody could see they should not have been.
      It comes back as a switch in Options, off until asked for and remembered afterwards, which is
      the honest shape for an aid: one you can turn off is one nobody is being fooled by.

      The switch is a **uniform, not a recompile**. `three` caches programs by a key and a material
      patched differently is a different program, so rebuilding shaders as somebody ticks a box is a
      stutter they would blame on the game. The shader is always there; what changes is nought or one.

      Two things it gets right that the first attempt did not. It is a *named* patch — the season
      tint edits the same prop material from somewhere else entirely, and `three` gives a material
      exactly one `onBeforeCompile`, which is how this feature was silently erased the first time.
      And the vertex half is guarded with `#ifdef USE_INSTANCING`, because the same material draws
      instanced props and plain meshes and an unguarded `instanceMatrix` is a shader that will not
      compile — a world with no trees in it.

      Numbers measured by looking rather than reasoned: the hole opens over four units rather than
      nine, because at nine it was under two units wide at the distance a cottage actually stands
      from somebody walking past, which is a hole you cannot see through.

- [ ] **61. The endless country's high ground is not terraced.** Found in the first endless
      screenshot and worth chasing: a big pale slab reading as a smooth gradient where the bounded
      world steps everything. `__peaks()` says there are no mountains in that patch, so it is not the
      rock mesh — it is the land itself, coming out of `localland.ts` as a ramp where the road world
      terraces. Two countries that do not look like the same game.

- [x] **63. Somebody you talk to turns to face you.** `turnToFace` in `entities/entity.ts`, which
      is a function rather than a line because the line existed in exactly one place and was missing
      from four others. A keeper behind a counter now watches whoever is standing at it — not only
      from the moment Enter is pressed, because a shopkeeper who snaps round at the keystroke and
      stares at the wall the rest of the time is worse than one who never moves. He is put facing
      the door when the room is built and has nothing else to do all day; following a customer is
      the whole of the life he has. Measured rather than eyeballed: before this, the storekeeper's
      yaw was π/2 with the hero standing due south of him, and it is −π/2 now, which is him.

      The landlord turns too. Still to do: stall holders, and anybody talked to through a path that
      does not go by `startTalk`.

      *The original note:* A shopkeeper carries on looking at the wall
      while he sells you a knife, which is funny once. Turning to face whoever is talking is the
      smallest thing that makes a conversation read as one — and the machinery is there: `yawFor` is
      what every creature already uses to face what it is doing, and a conversation knows both who
      is talking and where the hero is standing. What wants care is turning *back*: a man interrupted
      at his work should return to it rather than standing at ninety degrees to his own bench for the
      rest of the day.


## Who owns a house, and where everybody is at midnight — September 12th

- [ ] **64. Every building belongs to somebody, and the ones that do not are free houses.** A house
      you walk into is nobody's today: it has a keeper standing in it because the room needed one,
      and no owner at all. Ownership is the missing half of a village that has an economy — it is
      what **47** means by a holding, what **49** means by a household, and what **44** means when
      it says a house holds a family.

      And the interesting part is the exception. Some houses are *old* and nobody's — a village that
      shrank, a family that died out — and a free house with a bed in it is somewhere anybody may
      sleep for nothing. **Anybody**: the rule is the same for the hero and for a villager, which is
      what stops it being a player convenience. So a free house is vacant or occupied, it shows
      which, and walking into an occupied one finds somebody asleep in the bed.

      What it buys beyond a free night: villagers who travel. A hunter a day's walk from home, a
      traveller between towns, somebody who has left a village that is dying — all of them need
      somewhere to be at night that is not their own bed, and a country with free houses in it has
      an answer. That is the layer this adds: the map stops being a thing villagers are *placed on*
      and starts being a thing they *cross*.

- [ ] **65. At midnight, a village should look like it is asleep.** There are as many people on the
      street at two in the morning as at noon, which is the single loudest thing wrong with a
      village as a picture. Everybody should be somewhere by then: their own house, an inn, or a
      free house (**64**) if they are away from home. The ones still out should be out *for a
      reason* — a constable on his round, somebody walking home from the pub, a hunter who has been
      caught out by the dark — and being few is what makes them worth looking at.

      The machinery is nearly all there. `behaviours/villagers.json` already runs a day with hours
      in it (`time` is a fraction of the day and every trade's tree reads it), the houses exist, and
      `waitAt` already holds somebody somewhere. What is missing is the hour that sends them in, and
      a bed to be in rather than a spot on the floor to stand at.

- [x] **66. The panels are a row, not seven scattered letters.** They are a *set* — roster, journal,
      rucksack, map, party, who is here, photo, options — and a set reads better as a row than as
      whatever letter happened to be free on the day each was written. `1`–`9`, with the letters
      kept because they are in a good many fingers by now and taking them away is a change nobody
      asked for. The line between the two halves of the keyboard is worth stating: **a digit opens
      something to look at, a letter does something to the world.**

      And the map lost its button: the little map opens the big one when you press it. A picture of
      where you are is the obvious thing to press when you want a bigger picture of where you are.

- [ ] **67. The phone's button row, done properly.** The awkward set across the top middle can go
      now that the minimap opens the map and the panels have numbers. What replaces it is a design
      question rather than a plumbing one — and there is a design already in the repo (`design/`,
      `HudPhone.dc.html` and `TitlePhone.dc.html`) which is the right place to start rather than
      inventing a second answer beside it. Worth checking those against what the HUD has grown since
      September 8th: the shared meter, the registry page, the hall's rows on the roll.

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
- [ ] Nothing in the sweep test covers a mounted hero, who is the case that made stepping over things
      visible: `tools/playtest.cjs` walks on foot only. *(Half of this is already done and nobody
      had noticed: `SPEEDS` in `src/world/collisions.test.ts` walks the hero at a courser's pace of
      three and a half for a quarter of a second, which is the mounted case as the arithmetic sees
      it — a horse does not carry the hero, it multiplies his pace. What is missing is the played
      one, and it needs a way onto a horse from a script: mounting is only reachable through a
      stable's dialogue, so the playtest wants a probe of its own before it can ride.)*
- [ ] The playtest needs a dev server and a borrowed playwright. It should be possible to run it in
      CI on the way in, which is where all of this would have been caught.
      visible: `tools/playtest.cjs` walks on foot only.
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
- [ ] And the last of it: `grown` should be nought on a warm world and is not on a cold one. The
      world generates a first view on demand, which takes longer than a page can stand still for —
      so the first minute in a new country is spent on ground that is right by luck rather than by
      agreement. A world that had its first province ready before anybody asked would close it.
- [ ] Structures too: villages, doors, eyries and the rest are derived from the same graph on both
      sides. Either the graph travels at the join or the structures do. Until then, the halves bench
      is what stands between a player and being walked about a country he cannot see.
- [ ] And then the generator has one caller. A world grown in one place cannot be grown differently
      in another, and `twohalves.test.ts` becomes a test of a thing that cannot happen — which is
      the right time to read it again and decide what it is still for.

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

- [ ] **A web world's first village is not at its hub.** `roadweb` roots its spanning tree at the
      crossroads nearest the middle, and `generateStructures` founds Crossroads Town on node nought,
      which is the lowest-numbered corner on dry land. The two are different places. Nothing is
      visibly broken — the player starts where the village is — but the tree is grown outward from
      somewhere nobody ever stands. Fixing it moves the first village of every saved world, so it
      wants doing deliberately or not at all.

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
- [ ] **C2b. A budget rather than a number.** `Roster`'s four thousand, which C1 called the
      threshold that is obviously wrong: it is a per-world cap, and this laptop happens to run out
      of tick budget at about the same population, so today the cap and the hardware agree by
      coincidence. On a Pi the hardware will say four hundred while the cap goes on saying four
      thousand.

      *Deliberately not done alongside C2a, and the reason is that C2a moved the target rather than
      leaving it where it was. The cap counts everything a world is holding, and after the tiers
      most of what a world is holding costs nothing — a frozen agent measures 0.03µs a tick against
      3.5 for a live one — so the machine can now hold a great deal more than it can think for, and
      the coincidence C1 found is broken rather than fixed. **A budget has to count live agents, and
      how many of those there are is not something a spawn cap can decide:** it is how thickly they
      stand around whoever is playing, and the cap has no opinion about that. So it wants three
      things this change did not — a clock inside the tick, a policy for what to shed when the
      budget is gone (refusing a spawn part way through a herd is what `Roster.add` does today, and
      it is the wrong answer), and a decision about whether a world's population may legitimately
      depend on the machine it is running on, which is a question about the game rather than about
      the code.*
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
- [ ] **C5. Villagers move to the server.** They are client-derived today, which works only because
      they have no private state. Memory and ownership end that: two clients would disagree about
      what a villager recalls.

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
- [ ] **A4. A watch house**, the same, with the charge sheet fed by the gaol.
- [x] **A5. `chore test economy`.** Live a village forward a hundred days and hold the books to it:
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
- [ ] **A5. `chore test economy`.** Live a village forward a hundred days and hold the books to it:
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

- [ ] **Nothing in a dungeon is solid except a chest.** *(`DungeonWorld.blocked` knows about chests
      and nothing else, so a castle's tables, barrels and cell bars are walked straight through —
      indoors the same props stop you, because `InteriorWorld` measures their footprints. It is why
      a chamber is only nine per cent furniture: a room packed with things you walk through looks
      worse than an empty one. Making them solid is not a small change, because the moment
      furniture fills tiles it can seal a room, and the only thing that presently checks for that
      is `castlefit.ts`, which was written for chests. Whatever does it should do both.)*

### Wanted for the castle, and not made

Everything in the keep is currently dressed out of props a village and a chapel already own: an
`Altar` standing in for a throne, a `WeaponRack` for a wall of arms, a `Forge` for a kitchen range.
Each is the right silhouette from above and the wrong object up close. `dungeon/castlerooms.ts` is
where the substitution happens, so making these is a second pass and not a redesign. Sizes are in
tiles across by world units tall.

- **Throne** — 1×1, 1.6 tall. A high seat on the dais at the head of the throne room: the thing the
  fourth floor exists to be. Stands in for nothing; there is no seat in the game.
- **Banner** — hangs on a wall face like a `Torch`, 0.9 wide × 2.2 long. Tinted per castle, four to
  a great hall. What tells you whose keep this is.
- **Tapestry** — the same idea two tiles wide, for the long wall of a gallery. A cold stone wall
  with nothing on it is what makes a corridor read as a mine.
- **SuitOfArmour** — 1×1, 1.9 tall, a standing figure holding a polearm. Lines the state galleries.
  At the distance this camera looks from you cannot tell one from a monster, which is the point.
- **LongTable** — 3×1, 0.8 tall. The board down the middle of a great hall. `Table` is a small one
  and a row of them reads as a canteen.
- **Brazier** — 1×1, 1.1 tall: a bowl of fire on a tripod, glowing like a `Torch` does. Lights the
  middle of a hall, where no wall bracket reaches.
- **Chandelier** — hangs at 3.5, 1.5 across. The one light a great hall should have that a cellar
  cannot.
- **Portcullis** — 1×1 spanning a doorway, a grid dropping from the head of the arch. Distinct from
  `Door`, which is a hinged plank and reads as a cottage. What a castle bars a stair with.
- **Statue** — 1×1, 2.2 tall, plinth and figure. Marks the corners of a gallery and the head of a
  stair.
- **GreatHearth** — 2×1, 2.0 tall. `Hearth` is a cottage fire; a hall wants one you could stand in.
- **TowerStair** — 1×1, 2.5 tall, a spiral turning up out of sight. What should be standing in a
  corner tower, instead of the flat `Stairs` plate.
- **Cobweb** — 1×1, low and pale. The tell that a wing is the haunted one, from the top of the
  stair rather than after the fight.
- **Sarcophagus** — 2×1, 0.7 tall. The crypt under the chapel, and where a wight is.
- **StainedWindow** — a wall face, 1 wide × 2.4 tall, lit from behind. The one thing a castle
  interior has that a cave never can: an outside.

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
- **Unlocking a vault does not survive leaving it.** Found while reading that function, and it is
  not the castle's: `openChest` files the key under `visit.world.anchorId`, which carries the floor
  — `dungeon:Name:2` — and `enterDungeon` reads it back as `state.keys.has(anchor.id)`, which does
  not. So the doors shut again every time you come back, on every vault in the game. Which of the
  two ends is corrected matters to the castle: reading `state.keys.has(world.anchorId)` fixes it
  and leaves each floor its own lock, and filing the key under the unqualified anchor instead fixes
  it by opening the barred stair on all four floors of a keep at once, which is three puzzles
  thrown away.

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

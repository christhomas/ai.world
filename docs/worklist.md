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

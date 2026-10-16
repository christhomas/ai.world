# Gameplay content catalogue

Status: #624 is complete for the server and browser clients. The bundled JSON in `models/`,
`properties/`, `behaviours/` and `animations/` seeds a SQLite catalogue the first time a server
opens its durable database. **The server's simulation runs on the catalogue's published revision**,
every edit or rollback published through the tools is installed into the running game as it
commits, and **every client in every world is sent it** and installs it too. Solo play in a
page's own worker runs the bundled JSON; see "Solo and offline play".

## Records

`src/core/content.ts` splits the bundled files into records with stable IDs:

| Kind | ID | Seeded from |
|---|---|---|
| `model` | `model:wolf` | `models/creatures/wolf.json`, the whole file |
| `creature` | `creature:wolf` | one key of `properties/{beasts,birds,sea,people,monsters,villain}.json` |
| `tuning` | `tuning:fleeing` | one group of `properties/behaviour.json` |
| `spawning` | `spawning:biomes` | one group of `properties/spawning.json` |
| `behaviour` | `behaviour:grazer` | one tree in `behaviours/*.json` |
| `motion` | `motion:blows` | one group of `animations/motion.json` |
| `note` | `note:properties/beasts.json` | a file's own top-level `note` |

Each record keeps its source file, its key there and its position, so the records reassemble into
the original files byte for byte. Order is content: `spawns.ts` walks a weighted table in written
order. A record's references are worked out from its body: a creature names its model, and a
spawning table names every creature its weight tables and `night` lists mention. A revision whose
records name something that does not exist is refused. `CONTENT_SCHEMA` versions the shape of a
body; it is not raised for a change of value.

The JSON files remain the reproducible defaults and the test fixtures. `src/core/contentDefaults.ts`
lists them, and a test fails if a file is added to those directories without being listed.

## Seed once, then the database decides

`server/content.ts` keeps the catalogue in `ai-world.sqlite`, in the `content` schema domain:

- **First open:** one transaction writes revision 1 (`seed`) from the bundled records.
- **Every later open:** nothing changes, whatever the bundled JSON now says. A restart or a
  redeploy cannot put an operator's edit back to a default.
- **Explicit upgrade:** raising `CONTENT_DEFAULTS_VERSION` makes the next open write one `upgrade`
  revision. It adds new default records, and updates records that still hold a default. It never
  changes a record somebody edited, and it never revives a record somebody deleted.
- **Edits:** `ContentCatalogue.edit(base, changes, author, note)` must name the current head;
  anything else is refused as stale. A null body deletes a record and leaves a tombstone.

Every write is checked before it is committed, and committed whole or not at all, so a failed
import, upgrade, edit or rollback leaves the previous revision published.

## What is checked before a revision is published

First, every reference has to resolve. Then the server runs `checkContent`
(`src/entities/contentCheck.ts`), which reads the whole proposed revision with the game's own
load-time readers:

- `readModels`
- `readProperties`, checked against the proposed motion file's blows
- `readBehaviourTuning`
- `compileBehaviours`, against the verbs the game declares
- `readMotion`
- `readSpawning` and `readSpawns`

It also requires that every model draws a known creature, and that some behaviour tree drives every
creature. A model part with two shapes, a misspelt verb, a blow over four seconds or a spawn weight
written as a word is refused with the message the game would have failed with at load. Nothing in
a record is executed: a behaviour tree is data compiled against a fixed vocabulary.

## Rollback and history

- `rollback(base, to, author, note)` publishes revision `to` again as a new `rollback` revision on
  top of `base`, which must be the head. Each record returns to its value, existence and origin at
  `to`. A record that did not exist then is deleted. The revisions in between are kept.
- `history(id)` lists every revision that wrote a record, oldest first, with its author, note and
  time, and whether it deleted the record. Revisions and record rows are
immutable: SQLite triggers abort any UPDATE or DELETE on them. Each revision records its parent,
reason, author, note, time, the defaults version in force and a SHA-256 of the bundled defaults
the writing build carried.

## Installed into the running server

`installContent` (`src/entities/contentInstall.ts`) reads a whole revision with the game's own
readers first, and refuses it with nothing changed if any of them fails. Only then does it replace
each content table **in place**: `KINDS`, `PROPERTIES`, `MODELS`, the behaviour trees, the motion
tables and the spawn tables. The objects stay the same ones the rest of the game already holds,
so a wolf already in the world walks at its new speed from its next step and decides with its new
tree from its next tick. The scalar dials (`STEP_LIMIT`, `SPAWN_RADIUS`, `ACTIVE_RANGE`,
`WATCH_RANGE`, `FLINCH_LASTS`, `DYING_LASTS`) are live `export let` bindings for the same reason.
Bodies are copied before they are read, so nothing installed shares an object with the bundled
JSON.

The server installs the catalogue's head when it starts, and refuses to start if it cannot. It
never quietly falls back to the bundled JSON. Every committed revision is then installed as it
commits. JavaScript runs one thing at a time, so that is always between two simulation ticks.

## Sent to clients

A browser joining a world sends the fingerprint of the content it was built with (`bundledContent`,
64 bits of FNV-1a over its bundled records). Before the welcome, the server answers with a
`content` message: the head revision, its own bundle's fingerprint, and only the records that
differ from that bundle, which is usually none. It sends the same message to everyone whenever a
revision is published. Protocol version 26 carries it.

A page whose bundle matches lays the changes over its own copy and installs the result in place,
as the server does. It then rebuilds the creature meshes whose models changed, keeping every
creature drawn with them. A page whose bundle differs is a different build from its server; it
is told to reload rather than given a third set of content that neither end runs.

## The editor

**Content Catalogue** in the tools sidebar (`/tools/content-editor`) lists every record by kind, with a
filter. Choose one to see its JSON body, where it came from and its history. Publish a change with
a note, or delete the record. Any revision in the recent list can be rolled back to. The page says
which revision the game is running. When an edit is refused, it shows the game's own reason: a
stale base (somebody published first; the page reloads), a dangling reference, or anything the
readers would fail on.

`tools/content-proof.cjs` runs in the "Tools database and shell proof" workflow, against the
production server bundle and a fresh database. Through this page it:
- edits the wolf;
- checks that a player already in a world is sent the revision;
- has a second operator publish over the first, and checks the first's stale edit is refused;
- refuses a spawn table naming a creature that does not exist;
- restarts the server on the same database and checks the edits are what it runs;
- rolls back to the seed, and checks the player is sent that too;
- opens the production game page joined to the server, publishes a hero with a magenta block above
  his head, and checks the page draws it, then rolls back and checks the page draws him as he was.
  The page's debug probes exist only in development builds, so it counts magenta pixels in a
  screenshot.

## Through the tools portal

`/tools/content/data` answers a signed-in tools account only. Anybody else is sent to the login
page, and the session cookie is `SameSite=Strict`. The account becomes the author of every revision
it writes.

- `GET` returns the head, the last 50 revisions and every record's ID, kind, source and key.
- `GET ?id=creature:wolf` returns that record and its history (404 if there is no such record).
- `POST` with `application/json` and `{ "base": 2, "note": "…", "changes": [{ "id": "creature:wolf",
  "body": { … } }] }` edits up to 64 records. A null body deletes one. `{ "base": 3, "rollback": 1 }`
  rolls back instead. The answer is `{ "head": n }`.

Status codes:

| Code | Meaning |
|---|---|
| 409 | `base` is no longer the head; reload and try again |
| 400 | A malformed request, or content the game would not load, with the game's message |
| 413 | A body over 256 KiB |
| 415 | A body that is not JSON |

## Backup and restore

The catalogue lives in the same `ai-world.sqlite` as worlds, accounts and chronicles, so the volume
backup and restore in [self-hosting](self-hosting.md#data-backups-and-restore) covers it. Restoring
a backup restores its catalogue history with it. Deleting the database, or starting a server
against a new one, seeds a fresh catalogue from whatever JSON that build carries.

## Solo and offline play

Solo play in a page's own worker, and the installed apps offline, run the content bundled with the
build they shipped in. They keep no catalogue of their own, by decision (#624):

- nothing can edit solo content, so a local catalogue would only ever hold old defaults;
- a seed-once copy would stop a release's balance changes from reaching an existing solo player
  until `CONTENT_DEFAULTS_VERSION` was raised, and would hide edits to `models/` or `properties/`
  in development behind the cached copy.

Online play runs the server's catalogue, as above. Keeping a joined server's published revision for
offline play in that server's world belongs with the installed apps' storage (#577).

A room or floor that is open when a revision lands rebuilds its changed creature bodies along with
the overworld's.

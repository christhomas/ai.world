# Gameplay content catalogue

Status: slices 1–3 of #624, without the HTTP API. The bundled JSON in `models/`, `properties/`, `behaviours/` and
`animations/` now seeds a SQLite catalogue the first time a server opens its durable database.
**Nothing in the game reads the catalogue yet**: the simulation, the browser and the native hosts
still run on the bundled JSON. Edits through the catalogue therefore change no gameplay. Live
editing is not claimed until a production reader consumes a published revision.

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

## Backup and restore

The catalogue lives in the same `ai-world.sqlite` as worlds, accounts and chronicles, so the volume
backup and restore in [self-hosting](self-hosting.md#data-backups-and-restore) covers it. Restoring
a backup restores its catalogue history with it. Deleting the database, or starting a server
against a new one, seeds a fresh catalogue from whatever JSON that build carries.

## Not done yet

The remaining slices of #624 are not in this change:

- the authenticated tools API: bounded, revision-checked edits, history and rollback over HTTP;
- the runtime readers that load the published revision in the server simulation and the
  browser/native hosts, and the offline cache;
- live revision delivery, and the tools editor;
- the end-to-end proof on GitHub.

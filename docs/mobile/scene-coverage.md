# What the phone's world shows, and what it does not yet (#561)

The installed app draws the world from the game's own frame graph (`src/core/scene.ts`), produced by
the same `composeGame` the page runs and sent a step at a time by `ScenePackets`
(`docs/mobile/game-engine.md`). Nothing about the world is rebuilt in Dart; the native renderers draw
the nodes the graph holds. So the question for each part of the world is only whether it is in the
graph, and whether the phones draw that kind of node the way the web does.

## Node kinds

| kind | on the phone |
|---|---|
| `mesh` | drawn, with its material, season tint, water and coast attributes |
| `instances` | drawn per instance matrix and colour |
| `prop-batch` | expanded into instances before sending (`expandForFlutter`) |
| `points` | expanded into quads (`_expandPoints`), as weather is |
| `group` | carries transforms; nothing to draw |
| `ambient`, `hemisphere`, `directional`, `point` | lights; ambient and hemisphere summed on the host, up to 4 directional and 16 point lights, one shadow caster (`docs/mobile-hosted-verification.md`) |

The camera is orthographic, as the game's is. Fog, the coast field, the season, the cutaway and
the shared render time travel with every frame.

## Parts of the world

Each part is in the graph, and is checked natively against the web picture of the same frame where a
parity scene exists. The parity scenes are listed in `.github/workflows/mobile-playtests.yml`, with
limits in `tools/mobile/parity-thresholds.json`.

| part | in the graph | parity scene |
|---|---|---|
| terrain, roads, coast, water | chunk meshes | `town`, `autumn`, `winter`, `sea` |
| mountains | rock meshes | `mountain` |
| trees, rocks, props | prop batches | `town`, `autumn`, `cattle` |
| villagers, animals, monsters, gear, animation | rig frames at the shared render time | `town`, `cattle`, `dungeon` |
| mounts | rig frames | `horse` |
| other players in a shared world | rig frames, with their names hung over their heads in the app as on the page (`render/other-bodies.ts`) | none yet: a shared world's capture needs a server |
| boats and ferries | meshes | `sea`, `night-sea` |
| crops | meshes | `farming` |
| buildings, the hero's estate | meshes | `town`, `estate` |
| rooms and shops | the interior's own graph | `interior` |
| dungeons, caves, wrecks | the floor's own graph | `dungeon` |
| night, lamps, torches | lights | `night`, `night-sea`, `interior`, `dungeon` |
| seasons | the season tint | `autumn`, `winter` |
| weather | points | none yet |
| shadows | one directional caster | `autumn` |
| see-through walls | the cutaway | none yet |
| sky islands, flying | meshes | none yet: no web reference shot of a sky island exists |

## Not yet on the phone

These are tracked rather than left out:

- **The subject in reach, ringed in the world.** The handoff (`design/mobile/README.md`, "In reach")
  rings the subject at their feet. The game has no such node yet; the action card names the
  subject instead. Tracked by #571.
- **Parity scenes for weather, see-through walls and sky islands.** These need web reference shots in
  `tools/shots.cjs` first.

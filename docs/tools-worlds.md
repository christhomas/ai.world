# Worlds in the tools

Every tool uses the same application navigation, sign-in session and world selector. The selector
reads the server catalogue from its SQLite-backed world vault and local worlds from the same
IndexedDB records used by the game. Source is part of a world's identity: identical numeric seeds
on a server and in a browser remain two different worlds. Selection follows navigation between
tools. A single available world is selected on opening the tools.

Local records are available only in the browser profile and origin that holds them. Playing at
the public hostname and opening tools at a different homelab hostname does not share IndexedDB.
Tools do not upload local worlds, claim server names, or change saved progress when reading them.
Database failures are shown beside the selector rather than described as an empty catalogue.

The local Domesday Book runs the actual simulation in a worker against a detached saved snapshot,
including the authority's clock, manifest and province records. It does not advance the live game.
Its history stream is unavailable because local worlds do not keep the server's durable chronicle.
Old hero slots without an authority checkpoint are identified explicitly; their survey uses the
saved seed and manifest rather than claiming to have a complete world checkpoint.

World Editor shows saved endless-world maps from either source. Local maps are read-only; use
Shape on the game's title screen to edit the local save. Server terrain edits retain their existing
revision and connected-player guards. Road worlds remain in the common selector and can be surveyed
in Domesday; the terrain authoring tool explains that it supports endless worlds.

GitHub's `Tools database and shell proof` workflow builds the deployed frontend and server, opens
a real Chromium browser, writes a named road world to the game's IndexedDB stores, then loads its
Domesday Book through the authenticated tools. It verifies the saved day, actual population,
selection across navigation, source isolation, and desktop/mobile layouts, retaining screenshots.

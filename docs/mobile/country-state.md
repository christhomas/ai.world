# Portable production country boot

Refs #560, #561, #563, #579. This is a partial delivery.

`growCountryState` owns the production manifest, generator choice, terrain sampler, nearby-place
queries, live patch view and country fingerprint. The browser's existing `growCountry` calls it
before attaching visuals and background workers. Installed hosts can call the same CPU entry
without a browser scene, renderer, worker constructor or browser storage.

A saved manifest pins island positions/seeds, authored elevations and ordered terrain edits. An
installed host can supply the saved starting position to build the patch under the player directly.
The view remains live after a crossing; the whole-country fingerprint remains the same across
patches. The existing measured home-patch reuse path is retained.

GitHub regressions compare populated bounded terrain and structures with the original production
generator, restore pinned manifests, traverse real endless patches and rebuild an authored home
patch. A bundled bare-host proof creates and continues a road country and crosses a saved endless
starting patch. Required captures/playtest check the browser's mounted game.

This does not create a complete installed session. Hero/UI/actions, renderer composition,
background generation scheduling, durable save ownership and both-OS installed acceptance still
need production wiring. Saved-country CPU reconstruction is not full save/terminate/continue proof.

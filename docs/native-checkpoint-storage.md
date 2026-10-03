# Native checkpoint adapter

`CheckpointStore.open(appPrivateDirectory, scope)` adapts host-contract structured JSON to
`dart:io`. The production host supplies the Android/iOS app-private directory; this change does
not add a directory plugin, alter the app entrypoint or connect the game session.

Scopes separate player progress, world simulation records, settings and stable identity. World
name, unsigned seed, player identity and world kind are included in the namespace and every
record. Slots/record keys accept only ASCII letters, digits, underscores and hyphens, at most 80
characters. Scope world/player strings currently accept printable ASCII up to 48 characters.
Do not use a player-progress scope as the shared-server Vault. The native host still needs an
explicit bridge to the simulation's synchronous string-shaped Vault API; this async adapter
does not pretend that asynchronous disk writes implement that API directly.

The adapter treats `SessionSave`, `GameStateJson`, manifest, mounts, boat cargo, sky, underground
and future fields as opaque JSON. It preserves every field and does not apply `kindOf`, invent
missing player positions, fill defaults or migrate gameplay data. Existing shared engine code
owns these decisions. Exports contain the original payload; explicit imports validate structured
JSON and require the current checkpoint revision before replacing an occupied destination.
Validation of a browser export as a supported `SessionSave` remains the shared session's job.

Native envelope schema 1 / host contract 1 stores scope, key, monotonically increasing revision,
payload and a corruption checksum. Unsupported envelope/contract versions are rejected without
fallback or overwriting. There are no older native envelopes to migrate; unwrapped browser saves
enter through explicit import. Future storage migrations must preserve the original envelope
and be tested against exported fixtures. FNV-1a detects accidental corruption and is not an
authentication mechanism.

Each commit snapshots JSON immediately, then serializes writes on the owning adapter. A per-slot
advisory OS lock detects competing processes. Use one adapter per namespace: POSIX advisory locks
are not a substitute for in-process serialization between independently constructed adapters.
The staged payload is flushed before renaming; the previous committed file is copied into a
flushed backup stage and renamed before the new checkpoint replaces current. Interrupted stages
are never loaded as committed data. Corrupt current data recovers the previous committed file
with `Checkpoint.recovered == true`; two corrupt files prevent overwrite. Quota and I/O errors
reject the write and flush. A subsequent successful commit clears the remembered write error.
Abandoning an awaiting caller does not cancel queued writes.

File and namespace symlinks are rejected. Root ancestors are resolved once to a canonical
directory. The caller must own a private namespace; `dart:io` path checks do not provide an
`openat(O_NOFOLLOW)` defence against a malicious process replacing files between checks.
Atomic rename and flushed file data protect application/process interruption; directory fsync
and arbitrary device power-loss guarantees are not provided by this portable Dart API.

`storage_checkpoint_test.dart` uses actual temporary directories, restarts adapters and injects
interruption at each write boundary. It covers corruption/recovery, full-disk error propagation,
concurrent writes, immutable snapshots, world/seed/player/domain isolation, schema downgrade
rejection, path/symlink attacks and export/import replacement confirmation. The payload is a
documented shared-shaped fixture, not falsely described as a save recorded from installed gameplay.
Actual exported shared-save fixtures and installed upgrade/resume proof remain pending.

All tests run on GitHub. Both the required Flutter check and hosted mobile workflow
now discover the complete Flutter suite, including these checkpoint regressions.
Invalid UTF-8 bytes are decoded inside the corruption handler, so a valid previous
checkpoint can recover while real file-read errors retain their I/O classification.
No local tests, builds or dependencies were run.
Production list/rename/delete confirmation UI, stable identity creation, settings integration,
app-private directory lookup, lifecycle flush hookup and both-platform installed resume/update
journeys remain #577 acceptance work. This change deliberately does not close that issue.

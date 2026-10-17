# Exporting and importing a kept game

Refs #577. A player can export a game kept on the phone to one file and import it back, so the game
survives a reinstall or moves to another phone. An installed-app update tested on both OSes is
still open under #577.

## On the title

Each row of the saved games list has **EXPORT** beside PLAY and DELETE, a 44 px target like them.
It reads the slot's hero and world out of app-private storage, writes them as one file, and hands
the file to the OS share sheet (`share_plus`: `ACTION_SEND` on Android, `UIActivityViewController`
on iOS, pointed at the button on an iPad). The player chooses where it goes; until then it is only in
the app's temporary directory. The list then says it was exported, or why not.

**Import a game** on the title opens the OS document picker (`file_picker`: the Storage Access
Framework on Android, the Files picker on iOS). Neither needs a permission, and any file may be
picked, because a file passed through a messenger or a cloud drive may come back with any name; the
contents are what is judged. A good file becomes a new kept game at the top of the list, where
Continue finds it. A bad one is refused on the title with the reason, and nothing on the phone
changes.

## The file

The file is UTF-8 JSON in two layers, like the checkpoint store's own records:

```json
{
  "format": "ai-world-game",
  "version": 1,
  "checksum": "1a2b3c4d",
  "body": "{\"slot\":{…},\"hero\":{…},\"world\":{…},\"exported\":1760000000000}"
}
```

- `format` names the file, so some other JSON file is refused as "not an AI World game".
- `version` is the format's version. This app writes 1 and reads 1. It is read before anything else,
  so a file from a newer app is refused as newer ("Update the app to import it") and not as damaged.
  A newer format may change everything below the version, the checksum included.
- `checksum` is FNV-1a over the UTF-8 of `body`, as eight lowercase hex digits: the checkpoint
  store's own corruption check. It finds a file that was changed or damaged on its way between
  phones. It is not a signature, and nothing is trusted because of it.
- `body` is the game, as one JSON string with exactly four fields:
  - `slot`: the slot as the settings keep it (`GameSlot.json`: `slot`, `seed`, `kind`, `name`, and
    `server` and `world` for a shared world);
  - `hero`: the hero's save, exactly as the player store keeps it under `save`;
  - `world`: the world's records, name to text, exactly as the world store keeps them under
    `records`;
  - `exported`: when the file was written, in milliseconds since the epoch. It is for the player:
    nothing reads the game by it.

The exported file is named `ai-world-<hero>-<yyyy>-<mm>-<dd>.json`.

## What is refused

`GameFile.decode` (`client/flutter/lib/src/storage/game_file.dart`) refuses, with a message the title
shows:

- an empty file, or one over 64 MiB;
- bytes that are not UTF-8 JSON, which is how a file cut short reads ("damaged or incomplete");
- JSON without the right `format`;
- a `version` that is not a positive whole number;
- a newer `version`;
- an envelope with fields missing or extra, or a `body` that does not match its `checksum`;
- a `body` of the wrong shape: fields missing or extra, no hero, a record that is not text;
- a slot the app cannot keep (`GameSlot.fromJson` or the storage scope refuses it), and a hero or
  world deeper than the host contract allows.

## Never over a kept game

`importGame` (`client/flutter/lib/src/game_transfer.dart`) always commits into a new slot, named
`imported-<milliseconds>`, with `-1`, `-2`… added while that name is listed, holds a hero, or holds
world records. It writes the world first and the hero last. The hero is what makes a slot a kept
game (`GameSession.kept`), so an import cut off half way is never listed. Both writes go through
`CheckpointStore.importData`, which refuses to replace a record it finds. A failed import erases what
it wrote, except when somebody else wrote there first. Then the slot is theirs and left alone. Only
then is the slot added to `KeptGames`.

The format and the transfer are plain Dart with no plugins; the share sheet and the picker are
`lib/src/game_file_ports.dart`, and `AppShell` takes replacements for both, which the widget tests
use.

## Tests

- `test/game_file_test.dart`: a round trip, the envelope's fields, and every refusal, including a
  truncated, changed, wrongly versioned and newer file.
- `test/game_transfer_test.dart`: a round trip through real files into a new slot at the top of the
  list; a shared world's slot; a file imported twice is two games, and no file of the original
  changes; a slot holding anything is passed over; a refused file changes no file on the phone.
- `test/saved_games_test.dart` and `test/app_shell_test.dart`: EXPORT and Import a game are 44 px;
  the export is handed to the share sheet as a file that decodes to the kept game; an import
  confirms and is offered to Continue; a damaged or newer file is refused on the title with its
  reason; a cancelled picker changes nothing.

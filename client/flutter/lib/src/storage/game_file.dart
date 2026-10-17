import 'dart:convert';

/// What a game file says it is, so that some other JSON file is refused by name and not by shape.
const gameFileFormat = 'ai-world-game';

/// The format this app writes, and the newest it can read.
const gameFileVersion = 1;

/// The largest file read as a game. A long-played world is a few megabytes of records; anything
/// far past that is not a game, and reading it whole could take the phone's memory with it.
const gameFileLimit = 64 * 1024 * 1024;

/// A game file the app will not import, and what to tell the player about it.
class GameFileRefused implements Exception {
  const GameFileRefused(this.message);
  final String message;
  @override
  String toString() => 'GameFileRefused: $message';
}

const _damaged = GameFileRefused('This file is damaged or incomplete, so the game in it cannot be imported.');

/// One kept game as a single file, to keep it through a reinstall or take it to another phone (#577).
///
/// The file is JSON in two layers, as the checkpoint store's own records are: an envelope naming the
/// format and its version, and the game itself as one string `body` with a checksum of that string.
/// The version is read before anything else, so a file from a newer app is refused as newer rather
/// than as damaged; the checksum catches a file changed or cut short on its way between phones.
///
/// This is plain Dart with no storage and no plugins in it, so it is tested on its own; reading a
/// game out of the store and committing one into a new slot is `game_transfer.dart`.
class GameFile {
  const GameFile({required this.slot, required this.hero, required this.world, required this.exported});

  /// The slot as the settings keep it (`GameSlot.json`). An import gives the game a slot of its own.
  final Map<String, Object?> slot;

  /// The hero's save, exactly as the player store keeps it under `save`.
  final Object hero;

  /// The world's records by name, exactly as the world store keeps them under `records`.
  final Map<String, String> world;

  /// When the file was written, for the player's sake: nothing reads the game by it.
  final DateTime exported;

  /// The file's text.
  String encode() {
    final body = jsonEncode({'slot': slot, 'hero': hero, 'world': world, 'exported': exported.millisecondsSinceEpoch});
    return jsonEncode({'format': gameFileFormat, 'version': gameFileVersion, 'checksum': gameFileChecksum(body), 'body': body});
  }

  /// Read a file's bytes as a game, or refuse it with a message the player can read.
  static GameFile decode(List<int> bytes) {
    if (bytes.isEmpty) throw const GameFileRefused('This file is empty.');
    if (bytes.length > gameFileLimit) throw const GameFileRefused('This file is too large to be an AI World game.');
    final Object? envelope;
    try {
      envelope = jsonDecode(utf8.decode(bytes));
    } on FormatException {
      throw _damaged;
    }
    if (envelope is! Map || envelope['format'] != gameFileFormat) {
      throw const GameFileRefused('This file is not an AI World game.');
    }
    final version = envelope['version'];
    if (version is! int || version < 1) throw _damaged;
    // a newer app may have changed anything below the version, the checksum included
    if (version > gameFileVersion) {
      throw GameFileRefused('This game was exported by a newer AI World (format $version). Update the app to import it.');
    }
    final body = envelope['body'], checksum = envelope['checksum'];
    if (envelope.length != 4 || body is! String || checksum is! String) throw _damaged;
    if (gameFileChecksum(body) != checksum) {
      throw const GameFileRefused('This file is damaged: what it holds does not match its checksum.');
    }
    final Object? game;
    try {
      game = jsonDecode(body);
    } on FormatException {
      throw _damaged;
    }
    if (game is! Map || game.length != 4) throw _damaged;
    final slot = game['slot'], hero = game['hero'], world = game['world'], exported = game['exported'];
    if (slot is! Map || hero == null || world is! Map || exported is! int ||
        slot.keys.any((key) => key is! String) || world.entries.any((e) => e.key is! String || e.value is! String)) {
      throw _damaged;
    }
    return GameFile(slot: Map<String, Object?>.from(slot), hero: hero as Object, world: Map<String, String>.from(world),
      exported: DateTime.fromMillisecondsSinceEpoch(exported));
  }
}

/// FNV-1a over the body's UTF-8, as eight hex digits: the checkpoint store's own corruption check.
/// It finds a damaged or altered file; it is not a signature, and nothing is trusted because of it.
String gameFileChecksum(String body) {
  var hash = 0x811c9dc5;
  for (final byte in utf8.encode(body)) { hash = ((hash ^ byte) * 0x01000193) & 0xffffffff; }
  return hash.toRadixString(16).padLeft(8, '0');
}

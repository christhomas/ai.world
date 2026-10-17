import 'dart:convert';
import 'dart:io';

import 'game_session.dart';
import 'kept_games.dart';
import 'storage/checkpoint_store.dart';
import 'storage/game_file.dart';

// A kept game out of the phone's storage and into a file, and back into a slot of its own (#577).
//
// The file itself is `GameFile`; this is the part that reads the hero and the world out of their
// namespaces, and commits an imported game into new ones without touching any game already kept.

/// The game in a kept slot, as a file. A slot with no hero saved has nothing in it to keep.
Future<GameFile> exportGame(GameSlot slot, {required Directory root, DateTime? at}) async {
  final hero = await (await CheckpointStore.open(root, slot.scope('player'))).load('save');
  if (hero == null) throw const GameFileRefused('That game has nothing saved in it yet, so there is nothing to export.');
  final records = await (await CheckpointStore.open(root, slot.scope('world'))).load('records');
  return GameFile(slot: slot.json, hero: hero,
    world: {if (records is Map) for (final entry in records.entries) '${entry.key}': '${entry.value}'},
    exported: at ?? DateTime.now());
}

/// What the exported file is called where the player keeps it: the hero's name and the day, so two
/// exports of the same game are told apart, in characters any phone's files allow.
String gameFileName(GameSlot slot, DateTime at) {
  final name = slot.name.toLowerCase().replaceAll(RegExp('[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
  String two(int n) => '$n'.padLeft(2, '0');
  return 'ai-world-${name.isEmpty ? 'game' : name}-${at.year}-${two(at.month)}-${two(at.day)}.json';
}

/// Import a game file into a new slot and add it to the kept games, at the top, where Continue finds
/// it. The game is never put in a slot that holds anything: an import is a game the player did not
/// have on this phone a moment ago, and must not cost them one they did.
Future<GameSlot> importGame(List<int> bytes, KeptGames games, {DateTime? at}) async {
  final file = GameFile.decode(bytes);
  final kept = GameSlot.fromJson(file.slot);
  if (kept == null || !['road', 'endless'].contains(kept.kind) || kept.seed < 0 || kept.seed > 0xffffffff) {
    throw const GameFileRefused('This file is damaged or incomplete, so the game in it cannot be imported.');
  }
  final server = kept.server;
  if (server != null) {
    final address = Uri.tryParse(server);
    if (address == null || (address.scheme != 'ws' && address.scheme != 'wss') || address.host.isEmpty || RegExp(r'\s').hasMatch(server)) {
      throw const GameFileRefused('This file is damaged or incomplete, so the game in it cannot be imported.');
    }
  }
  if (kept.world != null && kept.world!.trim().isEmpty) {
    throw const GameFileRefused('This file is damaged or incomplete, so the game in it cannot be imported.');
  }
  // Finish both encodings before opening a slot or writing either record.
  final worldText = jsonEncode(file.world), heroText = jsonEncode(file.hero);
  final when = at ?? DateTime.now();
  final root = games.root;
  final GameSlot slot;
  try {
    slot = await _freshSlot(kept, games, when);
  } on StorageFailure catch (error) {
    if (error.code == StorageError.invalid) throw const GameFileRefused('This file holds a game this app cannot keep.');
    rethrow;
  }
  try {
    // the world first: the hero is what makes a slot a kept game (`GameSession.kept`), so a game
    // cut off half way is never listed as one. `importData` refuses to replace a record it finds.
    await (await CheckpointStore.open(root, slot.scope('world'))).importData('records', worldText);
    await (await CheckpointStore.open(root, slot.scope('player'))).importData('save', heroText);
  } on StorageFailure catch (error) {
    // the slot was empty before this began, so what was written of it is this import's alone, except
    // when somebody else wrote there first: then it is theirs, and left alone
    if (error.code != StorageError.conflict) await GameSession.forget(slot, root: root).catchError((Object _) {});
    if (error.code == StorageError.invalid) throw const GameFileRefused('This file holds a game this app cannot keep.');
    rethrow;
  }
  final previous = games.games;
  try {
    await games.played(slot, at: when);
  } catch (_) {
    games.games = previous;
    await GameSession.forget(slot, root: root).catchError((Object _) {});
    rethrow;
  }
  return slot;
}

/// A slot named for when the game came in, not listed and with nothing kept under it.
Future<GameSlot> _freshSlot(GameSlot kept, KeptGames games, DateTime at) async {
  for (var n = 0; ; n++) {
    final name = 'imported-${at.millisecondsSinceEpoch}${n == 0 ? '' : '-$n'}';
    final slot = GameSlot(slot: name, seed: kept.seed, kind: kept.kind, name: _heroName(kept.name), server: kept.server, world: kept.world);
    if (games.games.any((g) => g.slot.slot == name)) continue;
    if (await GameSession.kept(slot, root: games.root)) continue;
    if (await (await CheckpointStore.open(games.root, slot.scope('world'))).inspect('records') != null) continue;
    return slot;
  }
}

String _heroName(String name) {
  // Keep names readable in the title and saved games, including when a file came from elsewhere.
  final clean = name.replaceAll(RegExp(r'[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]'), '').trim();
  return clean.isEmpty ? 'Traveller' : String.fromCharCodes(clean.runes.take(40));
}

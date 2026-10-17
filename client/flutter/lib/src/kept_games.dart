import 'dart:io';

import 'game_session.dart';
import 'storage/checkpoint_store.dart';

/// A game kept on this phone, and when it was last played.
typedef KeptGame = ({GameSlot slot, DateTime played});

/// The games kept on this phone, most recently played first (#572, #577).
///
/// The list lives in the app's settings beside the theme and the volume. Each game's hero and world
/// are in namespaces of their own (`GameSlot.scope`), which deleting the game erases: a new game
/// takes a slot of its own, so without this every game ever started would stay on the phone with
/// no way back to it and no way to let it go.
class KeptGames {
  KeptGames(this.settings, this.root);
  final CheckpointStore settings;
  final Directory root;
  List<KeptGame> games = const [];

  /// Read the list. A game that was opened and never saved has nothing in it to lose, so it is let
  /// go of here rather than left as files nobody can reach; one that cannot be read is kept listed,
  /// so the player can see it and choose to delete it.
  Future<void> load() async {
    final listed = await settings.load('games');
    final found = <KeptGame>[];
    if (listed is List) {
      for (final entry in listed) {
        final slot = entry is Map ? GameSlot.fromJson(entry['slot']) : null;
        final played = entry is Map ? entry['played'] : null;
        if (slot != null && played is int) found.add((slot: slot, played: DateTime.fromMillisecondsSinceEpoch(played)));
      }
    } else if (GameSlot.fromJson(await settings.load('last')) case final last?) {
      // before there was a list, only the last game played was remembered
      found.add((slot: last, played: DateTime.now()));
    }
    final kept = <KeptGame>[];
    for (final game in found) {
      if (kept.any((k) => k.slot.slot == game.slot.slot)) continue;
      bool saved;
      try {
        saved = await GameSession.kept(game.slot, root: root);
      } on StorageFailure {
        saved = true;
      }
      if (saved) {
        kept.add(game);
      } else {
        await GameSession.forget(game.slot, root: root);
      }
    }
    games = kept;
    // written only when there is something to keep: the old setting moved into a list, or a game let go
    if (listed is List ? kept.length != listed.length : found.isNotEmpty) await _write();
  }

  /// The game just opened goes to the top: it is what Continue opens next time.
  Future<void> played(GameSlot slot, {DateTime? at}) {
    games = [(slot: slot, played: at ?? DateTime.now()), ...games.where((g) => g.slot.slot != slot.slot)];
    return _write();
  }

  /// Erase a game, hero and world, for good. The player has been asked.
  Future<void> delete(GameSlot slot) async {
    await GameSession.forget(slot, root: root);
    games = games.where((g) => g.slot.slot != slot.slot).toList();
    await _write();
  }

  Future<void> _write() => settings.commit('games',
    [for (final g in games) {'slot': g.slot.json, 'played': g.played.millisecondsSinceEpoch}]);
}

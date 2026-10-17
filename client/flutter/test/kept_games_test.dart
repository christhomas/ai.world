import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/kept_games.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:flutter_test/flutter_test.dart';

const _settings = StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road');

void main() {
  late Directory root;
  setUp(() async { root = await Directory.systemTemp.createTemp('kept-games-'); });
  tearDown(() async { await root.delete(recursive: true); });

  Future<void> save(GameSlot slot) async {
    await (await CheckpointStore.open(root, slot.scope('player'))).commit('save', {'state': {'playerId': slot.slot}});
    await (await CheckpointStore.open(root, slot.scope('world'))).commit('records', {'worlds/x': 'kept'});
  }

  const rowan = GameSlot(slot: 'local-1', seed: 9, name: 'Rowan');
  const ash = GameSlot(slot: 'local-2', seed: 4, name: 'Ash', server: 'wss://world.example/play');

  test('the last game played before there was a list is the list', () async {
    final settings = await CheckpointStore.open(root, _settings);
    await settings.commit('last', rowan.json);
    await save(rowan);
    final games = KeptGames(settings, root);
    await games.load();
    expect(games.games.map((g) => g.slot.slot), ['local-1']);
    expect(await settings.load('games'), isA<List>(), reason: 'written as a list from then on');
  });

  test('the game played last is first, and comes back first from storage', () async {
    final settings = await CheckpointStore.open(root, _settings);
    final games = KeptGames(settings, root);
    await games.load();
    await save(rowan);
    await save(ash);
    await games.played(rowan, at: DateTime(2026, 10, 1));
    await games.played(ash, at: DateTime(2026, 10, 2));
    await games.played(rowan, at: DateTime(2026, 10, 3));
    final again = KeptGames(settings, root);
    await again.load();
    expect(again.games.map((g) => g.slot.slot), ['local-1', 'local-2']);
    expect(again.games.last.slot.server, 'wss://world.example/play');
    expect(again.games.first.played, DateTime(2026, 10, 3));
  });

  test('deleting a game erases its hero and its world, and nobody else\'s', () async {
    final settings = await CheckpointStore.open(root, _settings);
    final games = KeptGames(settings, root);
    await games.load();
    await save(rowan);
    await save(ash);
    await games.played(rowan);
    await games.played(ash);
    await games.delete(rowan);
    expect(games.games.map((g) => g.slot.slot), ['local-2']);
    expect(await GameSession.kept(rowan, root: root), isFalse);
    expect(await (await CheckpointStore.open(root, rowan.scope('world'))).load('records'), isNull);
    expect(await GameSession.kept(ash, root: root), isTrue);
    expect(await (await CheckpointStore.open(root, ash.scope('world'))).load('records'), isNotNull);
  });

  test('a game opened and never saved is let go of, files and all', () async {
    final settings = await CheckpointStore.open(root, _settings);
    final games = KeptGames(settings, root);
    await games.load();
    await save(rowan);
    await games.played(rowan);
    // opened, which makes its namespaces, and left before it ever saved
    await CheckpointStore.open(root, ash.scope('player'));
    await (await CheckpointStore.open(root, ash.scope('world'))).commit('records', {'worlds/x': 'half'});
    await games.played(ash);
    final again = KeptGames(settings, root);
    await again.load();
    expect(again.games.map((g) => g.slot.slot), ['local-1']);
    expect(await (await CheckpointStore.open(root, ash.scope('world'))).load('records'), isNull);
  });

  test('what was kept and is not a game is passed over rather than trusted', () async {
    final settings = await CheckpointStore.open(root, _settings);
    await save(rowan);
    await settings.commit('games', [
      {'slot': {'slot': 'local-1', 'seed': 'nine', 'kind': 'road'}, 'played': 1},
      {'slot': rowan.json, 'played': 'yesterday'},
      'nonsense',
      {'slot': rowan.json, 'played': 1},
    ]);
    final games = KeptGames(settings, root);
    await games.load();
    expect(games.games.map((g) => g.slot.slot), ['local-1']);
  });
}

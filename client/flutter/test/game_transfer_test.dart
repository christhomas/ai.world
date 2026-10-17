import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/game_transfer.dart';
import 'package:ai_world_flutter/src/kept_games.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:ai_world_flutter/src/storage/game_file.dart';
import 'package:flutter_test/flutter_test.dart';

const _settings = StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road');

void main() {
  late Directory root;
  late KeptGames games;
  setUp(() async {
    root = await Directory.systemTemp.createTemp('game-transfer-');
    games = KeptGames(await CheckpointStore.open(root, _settings), root);
    await games.load();
  });
  tearDown(() async { await root.delete(recursive: true); });

  const rowan = GameSlot(slot: 'local-1', seed: 9, kind: 'endless', name: 'Rowan');
  const hero = {'state': {'playerId': 'hero', 'gold': 12, 'pack': ['rope', 'lamp']}};
  const records = {'worlds/1/rooms': '{"a":1}', 'worlds/1/clock': '42'};
  final at = DateTime(2026, 10, 17, 9, 30);

  Future<void> keep(GameSlot slot, Object save, Map<String, String> world) async {
    await (await CheckpointStore.open(root, slot.scope('world'))).commit('records', world);
    await (await CheckpointStore.open(root, slot.scope('player'))).commit('save', save);
    await games.played(slot, at: DateTime(2026, 10, 1));
  }

  Future<Checkpoint?> held(GameSlot slot, String domain) =>
    CheckpointStore.open(root, slot.scope(domain)).then((store) => store.inspect(domain == 'player' ? 'save' : 'records'));

  Future<List<int>> exported(GameSlot slot) async => utf8.encode((await exportGame(slot, root: root, at: at)).encode());

  /// Every file under the root, and what it holds: a refused or careful import changes none of them.
  Future<Map<String, String>> everything() async => {
    for (final file in root.listSync(recursive: true).whereType<File>()) file.path: file.readAsStringSync(),
  };

  test('a game exported and imported is the same game, in a new slot at the top of the list', () async {
    await keep(rowan, hero, records);
    final slot = await importGame(await exported(rowan), games, at: at);
    expect(slot.slot, isNot(rowan.slot));
    expect(slot.slot, 'imported-${at.millisecondsSinceEpoch}');
    expect((slot.seed, slot.kind, slot.name, slot.server, slot.world), (9, 'endless', 'Rowan', null, null));
    expect((await held(slot, 'player'))?.value, hero);
    expect((await held(slot, 'world'))?.value, records);
    expect(await GameSession.kept(slot, root: root), isTrue);
    expect(games.games.map((g) => g.slot.slot), [slot.slot, rowan.slot], reason: 'Continue opens the imported game');
    // and the list as the next launch reads it
    final again = KeptGames(games.settings, root);
    await again.load();
    expect(again.games.map((g) => g.slot.slot), [slot.slot, rowan.slot]);
  });

  test('a shared world game keeps its server and its named world', () async {
    const ash = GameSlot(slot: 'named-0a1b2c3d-world.example', seed: 4, name: 'Ash',
      server: 'wss://world.example/play', world: 'Harbour');
    await keep(ash, hero, const {});
    final slot = await importGame(await exported(ash), games, at: at);
    expect((slot.server, slot.world, slot.seed), ('wss://world.example/play', 'Harbour', 4));
    expect((await held(slot, 'world'))?.value, const <String, String>{});
  });

  test('an import never touches a kept game, even its own original', () async {
    await keep(rowan, hero, records);
    final file = await exported(rowan);
    final before = await everything();
    final first = await importGame(file, games, at: at);
    final second = await importGame(file, games, at: at);
    expect({rowan.slot, first.slot, second.slot}, hasLength(3), reason: 'the same file twice is two games');
    final after = await everything();
    for (final MapEntry(:key, :value) in before.entries) {
      if (key.contains('settings-')) continue; // the list itself is what an import adds to
      expect(after[key], value, reason: '$key was changed by an import');
    }
    expect((await held(rowan, 'player'))?.revision, 1);
    expect((await held(rowan, 'world'))?.revision, 1);
  });

  test('a slot that holds anything is passed over, listed or not', () async {
    await keep(rowan, hero, records);
    final file = await exported(rowan);
    // somebody's hero and world left under the very name the import would choose, though not listed
    final squatter = GameSlot(slot: 'imported-${at.millisecondsSinceEpoch}', seed: 9, kind: 'endless', name: 'Rowan');
    await (await CheckpointStore.open(root, squatter.scope('player'))).commit('save', {'state': {'playerId': 'other'}});
    // and a world with no hero under the next
    final orphan = GameSlot(slot: 'imported-${at.millisecondsSinceEpoch}-1', seed: 9, kind: 'endless', name: 'Rowan');
    await (await CheckpointStore.open(root, orphan.scope('world'))).commit('records', {'worlds/x': 'theirs'});
    final slot = await importGame(file, games, at: at);
    expect(slot.slot, 'imported-${at.millisecondsSinceEpoch}-2');
    expect((await held(squatter, 'player'))?.value, {'state': {'playerId': 'other'}});
    expect((await held(orphan, 'world'))?.value, {'worlds/x': 'theirs'});
    expect((await held(slot, 'player'))?.value, hero);
  });

  test('a refused file changes nothing on the phone', () async {
    await keep(rowan, hero, records);
    final text = utf8.decode(await exported(rowan));
    final before = await everything();
    final newer = jsonEncode((jsonDecode(text) as Map)..['version'] = 2);
    final corrupt = text.replaceFirst('Rowan', 'Rowen');
    for (final (why, bytes) in [
      ('truncated', utf8.encode(text.substring(0, text.length ~/ 2))),
      ('corrupt', utf8.encode(corrupt)),
      ('newer', utf8.encode(newer)),
      ('empty', <int>[]),
    ]) {
      await expectLater(importGame(bytes, games, at: at), throwsA(isA<GameFileRefused>()), reason: why);
    }
    expect(await everything(), before);
    expect(games.games.map((g) => g.slot.slot), [rowan.slot]);
  });

  test('a file whose slot this app cannot keep is refused, and leaves nothing behind', () async {
    await keep(rowan, hero, records);
    final before = await everything();
    String sealed(Map<String, Object?> slot) {
      final body = jsonEncode({'slot': slot, 'hero': hero, 'world': records, 'exported': 1});
      return jsonEncode({'format': 'ai-world-game', 'version': 1, 'checksum': gameFileChecksum(body), 'body': body});
    }
    for (final slot in [
      {'slot': 'x', 'seed': -1, 'kind': 'road'},
      {'slot': 'x', 'seed': 1, 'kind': 'ocean'},
      {'slot': 'x', 'seed': 1},
      {'slot': 'x', 'seed': 1, 'kind': 'road', 'world': 'Harbour'},
    ]) {
      await expectLater(importGame(utf8.encode(sealed(slot)), games, at: at), throwsA(isA<GameFileRefused>()), reason: '$slot');
    }
    expect(await everything(), before);
  });

  test('a game with nothing saved has nothing to export', () async {
    await expectLater(exportGame(rowan, root: root, at: at), throwsA(isA<GameFileRefused>()));
  });

  test('an exported file is named for the hero and the day', () {
    expect(gameFileName(rowan, at), 'ai-world-rowan-2026-10-17.json');
    expect(gameFileName(const GameSlot(slot: 's', seed: 1, name: ' Ysolde of the Marsh! '), DateTime(2026, 1, 2)),
      'ai-world-ysolde-of-the-marsh-2026-01-02.json');
    expect(gameFileName(const GameSlot(slot: 's', seed: 1, name: 'ⓐⓑ'), DateTime(2026, 1, 2)), 'ai-world-game-2026-01-02.json');
  });
}

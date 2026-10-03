import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';

void main() {
  late Directory root;
  const scope = StorageScope(domain: 'player', world: 'Crossroads Town', seed: 3, player: 'hero-a');
  final save = <String, Object?>{
    'seed': 3, 'world': 'endless', 'worldName': 'Crossroads Town',
    'cam': {'x': 4, 'z': 8, 'rot': .8, 'zoom': 18}, 'player': {'x': 4, 'z': 8},
    'sky': 'island-a', 'manifest': {'unknownFutureAnchor': [1, 2, 3]},
    'state': {'playerId': 'hero-a', 'inventory': {'gold': 14, 'items': {'book': 1}},
      'quests': {'first': 'done'}, 'horse': {'cargo': {'wood': 2}},
      'boat': {'cargo': {'fish': 3}}, 'unknownFutureField': {'nested': true}},
  };
  setUp(() async { root = await Directory.systemTemp.createTemp('checkpoint-test-'); });
  tearDown(() async { await root.delete(recursive: true); });

  test('restart round-trips the whole shared-shaped save and unknown fields', () async {
    final store = await CheckpointStore.open(root, scope);
    await store.commit('slot-a', save);
    await store.flush();
    final restarted = await CheckpointStore.open(root, scope);
    expect(await restarted.load('slot-a'), save);
    expect((await restarted.inspect('slot-a'))!.revision, 1);
  });

  test('fresh install is empty and an interrupted first write stays uncommitted', () async {
    final store = await CheckpointStore.open(root, scope);
    expect(await store.inspect('slot-a'), null);
    final failing = await CheckpointStore.open(root, scope, failure: (stage) {
      if (stage == WriteStage.afterStageFlush) throw FileSystemException('killed before commit');
    });
    await expectLater(failing.commit('slot-a', save), throwsA(isA<StorageFailure>()));
    expect(await (await CheckpointStore.open(root, scope)).load('slot-a'), null);
  });

  test('flush waits for an in-flight failed checkpoint and reports its error', () async {
    final started = Completer<void>();
    final release = Completer<void>();
    final failing = await CheckpointStore.open(root, scope, failure: (stage) async {
      if (stage == WriteStage.afterStageFlush) {
        started.complete();
        await release.future;
        throw FileSystemException('interrupted in-flight write');
      }
    });
    final committed = expectLater(failing.commit('slot-a', save), throwsA(isA<StorageFailure>()));
    await started.future;
    var flushed = false;
    final flushing = expectLater(failing.flush().whenComplete(() { flushed = true; }), throwsA(isA<StorageFailure>()));
    await Future<void>.delayed(Duration.zero);
    expect(flushed, false);
    release.complete();
    await Future.wait([committed, flushing]);
  });

  for (final stage in WriteStage.values) {
    test('interruption at $stage leaves a committed prior checkpoint', () async {
      final store = await CheckpointStore.open(root, scope);
      await store.commit('slot-a', save);
      final failing = await CheckpointStore.open(root, scope, failure: (at) {
        if (at == stage) throw FileSystemException('simulated interruption');
      });
      await expectLater(failing.commit('slot-a', {'progress': 'new'}), throwsA(isA<StorageFailure>()));
      await expectLater(failing.flush(), throwsA(isA<StorageFailure>()));
      final restarted = await CheckpointStore.open(root, scope);
      expect(await restarted.load('slot-a'), save);
    });
  }

  test('corrupt current recovers previous; two corrupt checkpoints report failure', () async {
    final store = await CheckpointStore.open(root, scope);
    await store.commit('slot-a', {'position': 1});
    await store.commit('slot-a', {'position': 2});
    await File('${store.directory.path}/slot-a.json').writeAsString('{broken');
    final recovered = await store.inspect('slot-a');
    expect(recovered!.recovered, true);
    expect(recovered.value, {'position': 1});
    await File('${store.directory.path}/slot-a.previous').writeAsString('broken too');
    await expectLater(store.load('slot-a'), throwsA(isA<StorageFailure>()));
    await expectLater(store.commit('slot-a', save), throwsA(isA<StorageFailure>()));
  });

  test('quota failure is observable and does not touch committed bytes', () async {
    final store = await CheckpointStore.open(root, scope);
    await store.commit('slot-a', save);
    final bytes = await File('${store.directory.path}/slot-a.json').readAsBytes();
    final failing = await CheckpointStore.open(root, scope, failure: (_) {
      throw FileSystemException('full disk', '', const OSError('No space', 28));
    });
    await expectLater(failing.commit('slot-a', null), throwsA(isA<StorageFailure>().having((e) => e.code, 'code', StorageError.quota)));
    expect(await File('${store.directory.path}/slot-a.json').readAsBytes(), bytes);
  });

  test('same-instance concurrent writes are sequential and snapshots cannot mutate', () async {
    final store = await CheckpointStore.open(root, scope);
    final first = {'counter': 1};
    final pending = store.commit('slot-a', first);
    first['counter'] = 99;
    await Future.wait([pending, store.commit('slot-a', {'counter': 2}), store.commit('slot-b', save)]);
    expect(await store.load('slot-a'), {'counter': 2});
    expect((await store.inspect('slot-a'))!.revision, 2);
    expect(await store.load('slot-b'), save);
  });

  test('world seed player and domain namespaces stay isolated', () async {
    final first = await CheckpointStore.open(root, scope);
    await first.commit('slot-a', save);
    for (final other in [
      const StorageScope(domain: 'world', world: 'Crossroads Town', seed: 3, player: 'hero-a'),
      const StorageScope(domain: 'player', world: 'Other Town', seed: 3, player: 'hero-a'),
      const StorageScope(domain: 'player', world: 'Crossroads Town', seed: 4, player: 'hero-a'),
      const StorageScope(domain: 'player', world: 'Crossroads Town', seed: 3, player: 'hero-b'),
    ]) {
      expect(await (await CheckpointStore.open(root, other)).load('slot-a'), null);
    }
  });

  test('future schema is rejected without falling back or overwriting', () async {
    final store = await CheckpointStore.open(root, scope);
    await store.commit('slot-a', save);
    final file = File('${store.directory.path}/slot-a.json');
    final envelope = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    envelope['schema'] = 9;
    await file.writeAsString(jsonEncode(envelope));
    final bytes = await file.readAsBytes();
    await expectLater(store.load('slot-a'), throwsA(isA<StorageFailure>().having((e) => e.code, 'code', StorageError.schema)));
    await expectLater(store.commit('slot-a', save), throwsA(isA<StorageFailure>()));
    expect(await file.readAsBytes(), bytes);
  });

  test('keys and symlinks cannot escape the app-private namespace', () async {
    final store = await CheckpointStore.open(root, scope);
    for (final key in ['../outside', '/absolute', 'slot/a', '.', '']) {
      await expectLater(store.commit(key, save), throwsA(isA<StorageFailure>()));
    }
    final outside = File('${root.path}/outside')..writeAsStringSync('keep me');
    await Link('${store.directory.path}/slot-a.json').create(outside.path);
    await expectLater(store.commit('slot-a', save), throwsA(isA<StorageFailure>()));
    expect(await outside.readAsString(), 'keep me');
  });

  test('export import requires current-revision confirmation before replacement', () async {
    final store = await CheckpointStore.open(root, scope);
    await store.commit('slot-a', save);
    final exported = await store.exportData('slot-a');
    await store.commit('slot-b', {'keep': true});
    await expectLater(store.importData('slot-b', exported), throwsA(isA<StorageFailure>()));
    expect(await store.load('slot-b'), {'keep': true});
    await store.importData('slot-b', exported, replaceRevision: 1);
    expect(await store.load('slot-b'), save);
    expect((await store.inspect('slot-b'))!.revision, 2);
    await File('${store.directory.path}/slot-b.json').writeAsString('{interrupted');
    final recovered = await store.inspect('slot-b');
    expect(recovered, isNotNull);
    expect(recovered!.recovered, true);
    expect(recovered.revision, 1);
    expect(recovered.value, {'keep': true});
  });
}

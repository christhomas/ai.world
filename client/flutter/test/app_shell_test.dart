import 'dart:io';

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<Directory> storage(WidgetTester tester) async {
    final root = (await tester.runAsync(() => Directory.systemTemp.createTemp('app-shell')))!;
    addTearDown(() => root.deleteSync(recursive: true));
    return root;
  }

  Future<void> title(WidgetTester tester, Directory root) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppShell(storageRoot: root))));
    // the settings and the kept game are read from app-private storage, on real files; the new
    // game button is live once they have been
    bool ready() => tester.widget<TextButton>(find.descendant(
      of: find.byKey(const ValueKey('new-game')), matching: find.byType(TextButton))).onPressed != null;
    for (var n = 0; n < 100 && !ready(); n++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    expect(ready(), isTrue, reason: 'the title never finished reading storage');
  }

  testWidgets('a first launch offers a new game and nothing to continue', (tester) async {
    final root = await storage(tester);
    await title(tester, root);
    expect(find.text('NEW GAME'), findsOneWidget);
    expect(find.byKey(const ValueKey('continue')), findsNothing);
    expect(tester.getSize(find.byKey(const ValueKey('new-game'))).height, greaterThanOrEqualTo(44));
  });

  testWidgets('a game left in its slot is offered to continue', (tester) async {
    final root = await storage(tester);
    const slot = GameSlot(slot: 'local-1', seed: 9, name: 'Rowan');
    await tester.runAsync(() async {
      final settings = await CheckpointStore.open(root,
        const StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road'));
      await settings.commit('last', {'slot': slot.slot, 'seed': slot.seed, 'kind': slot.kind, 'name': slot.name});
      await (await CheckpointStore.open(root, slot.scope('player'))).commit('save', {'state': {'playerId': 'hero'}});
    });
    await title(tester, root);
    expect(find.text('CONTINUE'), findsOneWidget);
  });

  testWidgets('a kept game is deleted from the title only once the player says so', (tester) async {
    final root = await storage(tester);
    const slot = GameSlot(slot: 'local-1', seed: 9, name: 'Rowan');
    await tester.runAsync(() async {
      final settings = await CheckpointStore.open(root,
        const StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road'));
      await settings.commit('last', slot.json);
      await (await CheckpointStore.open(root, slot.scope('player'))).commit('save', {'state': {'playerId': 'hero'}});
    });
    await title(tester, root);
    await tester.tap(find.byKey(const ValueKey('saved-games')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('delete-local-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delete-sure')));
    await tester.pumpAndSettle();
    // the deletion is real work on real files; the title comes back with nothing to continue
    for (var n = 0; n < 100 && find.byKey(const ValueKey('new-game')).evaluate().isEmpty; n++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    expect(find.byKey(const ValueKey('continue')), findsNothing);
    expect(find.byKey(const ValueKey('saved-games')), findsNothing);
    expect(await tester.runAsync(() => GameSession.kept(slot, root: root)), isFalse);
  });

  testWidgets('a slot remembered but no longer kept is not offered', (tester) async {
    final root = await storage(tester);
    await tester.runAsync(() async {
      final settings = await CheckpointStore.open(root,
        const StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road'));
      await settings.commit('last', {'slot': 'gone', 'seed': 1, 'kind': 'road', 'name': 'Traveller'});
    });
    await title(tester, root);
    expect(find.byKey(const ValueKey('continue')), findsNothing);
  });
}

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/game_file_ports.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:ai_world_flutter/src/storage/game_file.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<Directory> storage(WidgetTester tester) async {
    final root = (await tester.runAsync(() => Directory.systemTemp.createTemp('app-shell')))!;
    addTearDown(() => root.deleteSync(recursive: true));
    return root;
  }

  Future<void> title(WidgetTester tester, Directory root, {ShareGameFile? share, PickGameFile? pick}) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppShell(storageRoot: root, shareFile: share, pickFile: pick))));
    // the settings and the kept game are read from app-private storage, on real files; the new
    // game button is live once they have been
    bool ready() => tester.widget<TextButton>(find.descendant(
      of: find.byKey(const ValueKey('new-game')), matching: find.byType(TextButton))).onPressed != null;
    // every step of the file work waits for a turn of the real event loop, and the saved games
    // add a few dozen of them, so the title is given a good while
    for (var n = 0; n < 400 && !ready(); n++) {
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
    for (var n = 0; n < 400 && find.byKey(const ValueKey('new-game')).evaluate().isEmpty; n++) {
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

  /// Turns of the real event loop until `done`, for work on real files the test cannot pump through.
  Future<void> until(WidgetTester tester, bool Function() done) async {
    for (var n = 0; n < 400 && !done(); n++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    expect(done(), isTrue, reason: 'the file work never finished');
  }

  final rowanFile = GameFile(slot: const {'slot': 'local-1', 'seed': 9, 'kind': 'road', 'name': 'Rowan'},
    hero: const {'state': {'playerId': 'hero'}}, world: const {'worlds/1/clock': '42'}, exported: DateTime(2026, 10, 1));

  testWidgets('a game file picked from the title is imported and offered to continue', (tester) async {
    final root = await storage(tester);
    var picked = 0;
    await title(tester, root, pick: () async { picked++; return Uint8List.fromList(utf8.encode(rowanFile.encode())); });
    final button = find.byKey(const ValueKey('import-game'));
    expect(find.text('IMPORT A GAME'), findsOneWidget);
    expect(tester.getSize(button).height, greaterThanOrEqualTo(44));
    expect(find.byKey(const ValueKey('continue')), findsNothing);
    await tester.tap(button);
    await until(tester, () => find.text("Imported Rowan's game. Continue plays it.").evaluate().isNotEmpty);
    expect(picked, 1);
    expect(find.byKey(const ValueKey('continue')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('saved-games')));
    await tester.pump();
    expect(find.textContaining('Rowan'), findsWidgets);
    final saved = find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('saved-imported-'));
    expect(saved, findsOneWidget, reason: 'in a slot of its own');
  });

  testWidgets('a damaged or newer game file is refused on the title with a reason', (tester) async {
    final root = await storage(tester);
    final text = rowanFile.encode();
    final newer = jsonEncode((jsonDecode(text) as Map)..['version'] = 2);
    final files = [text.substring(0, text.length ~/ 2), newer];
    await title(tester, root, pick: () async => Uint8List.fromList(utf8.encode(files.removeAt(0))));
    await tester.tap(find.byKey(const ValueKey('import-game')));
    await until(tester, () => find.textContaining('damaged or incomplete').evaluate().isNotEmpty);
    await tester.tap(find.byKey(const ValueKey('import-game')));
    await until(tester, () => find.textContaining('newer AI World').evaluate().isNotEmpty);
    expect(find.byKey(const ValueKey('continue')), findsNothing, reason: 'nothing was kept');
    expect(find.byKey(const ValueKey('saved-games')), findsNothing);
  });

  testWidgets('a player who cancels the picker is told nothing and keeps the title as it was', (tester) async {
    final root = await storage(tester);
    var picked = false;
    await title(tester, root, pick: () async { picked = true; return null; });
    await tester.tap(find.byKey(const ValueKey('import-game')));
    await until(tester, () => picked);
    await tester.pump();
    expect(find.byKey(const ValueKey('title-note')), findsNothing);
  });

  testWidgets('a kept game is exported from the saved games to the share sheet as one file', (tester) async {
    final root = await storage(tester);
    const slot = GameSlot(slot: 'local-1', seed: 9, name: 'Rowan');
    await tester.runAsync(() async {
      final settings = await CheckpointStore.open(root,
        const StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road'));
      await settings.commit('last', slot.json);
      await (await CheckpointStore.open(root, slot.scope('player'))).commit('save', {'state': {'playerId': 'hero'}});
      await (await CheckpointStore.open(root, slot.scope('world'))).commit('records', {'worlds/1/clock': '42'});
    });
    final shared = <(String, Uint8List, Rect?)>[];
    await title(tester, root, share: (name, bytes, origin) async => shared.add((name, bytes, origin)));
    await tester.tap(find.byKey(const ValueKey('saved-games')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('export-local-1')));
    await until(tester, () => find.text("Exported Rowan's game to a file.").evaluate().isNotEmpty);
    final (name, bytes, origin) = shared.single;
    expect(name, startsWith('ai-world-rowan-'));
    expect(origin, isNotNull);
    final file = GameFile.decode(bytes);
    expect(file.slot, slot.json);
    expect(file.hero, {'state': {'playerId': 'hero'}});
    expect(file.world, {'worlds/1/clock': '42'});
  });
}

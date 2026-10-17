import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// The bundled game's manifest and source, as a test stands them in.
class GameAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final text = key.endsWith('game-manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': 'game'}) : 'bundled game';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

/// An engine with one small world, where somebody starts talking whenever the test says so. It
/// keeps the controls the last step was sent with, as the game would read them.
class TalkingEngine {
  var talking = false;
  var disposed = false;
  Map? input;

  Future<Object?> answer(MethodCall call) async {
    if (call.method == 'create') return 'owner';
    if (call.method == 'dispose') { disposed = true; return null; }
    final request = jsonDecode((call.arguments as Map)['request'] as String) as Map;
    if (request['type'] == 'step') input = (request['payload'] as Map)['input'] as Map;
    return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
      'requestId': request['id'], 'type': 'result',
      'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': talking ? 'BOOK' : 'WORLD',
        'busy': talking ? 'talking' : null,
        'models': {'hero': {'x': 0, 'z': 0, 'playerId': 'hero-1', 'hp': 7, 'maxHp': 10}}}}});
  }
}

void main() {
  Future<Directory> storage(WidgetTester tester) async {
    final root = (await tester.runAsync(() => Directory.systemTemp.createTemp('app-shell')))!;
    addTearDown(() => root.deleteSync(recursive: true));
    return root;
  }

  Future<void> title(WidgetTester tester, Directory root, {MethodChannel? engine, AssetBundle? assets}) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppShell(storageRoot: root, engineChannel: engine, assets: assets))));
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

  testWidgets('a conversation puts the camera away and Exit Photo gives the world back its controls (#578)', (tester) async {
    final root = await storage(tester);
    const engineChannel = MethodChannel('world.ai/app-shell-test');
    const rendererChannel = MethodChannel('world.ai/renderer');
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    final engine = TalkingEngine();
    messenger.setMockMethodCallHandler(engineChannel, engine.answer);
    messenger.setMockMethodCallHandler(rendererChannel, (call) async => call.method == 'create' ? 7 : null);
    addTearDown(() {
      messenger.setMockMethodCallHandler(engineChannel, null);
      messenger.setMockMethodCallHandler(rendererChannel, null);
    });
    // opening the game is real file work and the game steps on the display's frames, so both the
    // real event loop and the test's clock are turned until what is waited for has happened
    Future<void> until(bool Function() done, String why) async {
      for (var n = 0; n < 400 && !done(); n++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(done(), isTrue, reason: why);
    }
    bool shown(Key key) => find.byKey(key).evaluate().isNotEmpty;
    const hud = '7/10 · 100 BREATH';
    Future<void> photo() async {
      await tester.tap(find.byKey(const ValueKey('more')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('more-photo')));
      await tester.pump();
    }

    await title(tester, root, engine: engineChannel, assets: GameAssets());
    await tester.tap(find.byKey(const ValueKey('new-game')));
    await until(() => find.text(hud).evaluate().isNotEmpty, 'the game never opened');

    await photo();
    expect(shown(const ValueKey('photo-shutter')), isTrue);
    expect(find.text(hud), findsNothing);
    expect(shown(const ValueKey('more')), isFalse);
    engine.input = null;
    await until(() => engine.input != null, 'the game stopped stepping');
    expect(engine.input!['busy'], 'framing');

    // somebody speaks to the hero: the conversation takes the screen, and the HUD comes back with it
    engine.talking = true;
    await until(() => !shown(const ValueKey('photo-shutter')), 'the camera stayed up through a conversation');
    expect(find.text(hud), findsOneWidget);
    expect(shown(const ValueKey('more')), isTrue);
    engine.input = null;
    await until(() => engine.input != null, 'the game stopped stepping');
    expect(engine.input!['busy'], 'talking');

    engine.talking = false;
    await until(() => engine.input?['busy'] == null && engine.input?['owner'] == 'WORLD', 'the conversation never let the world go');
    await photo();
    expect(shown(const ValueKey('photo-shutter')), isTrue);
    await tester.tap(find.byKey(const ValueKey('photo-exit')));
    await tester.pump();
    expect(shown(const ValueKey('photo-shutter')), isFalse);
    expect(find.text(hud), findsOneWidget);
    expect(shown(const ValueKey('more')), isTrue);
    engine.input = null;
    await until(() => engine.input != null, 'the game stopped stepping');
    expect(engine.input!['busy'], isNull);
    expect(engine.input!['owner'], 'WORLD');

    // the game is closed and its engine let go before its storage is deleted
    await tester.pumpWidget(const SizedBox());
    await until(() => engine.disposed, 'the game was never closed');
    expect(tester.takeException(), isNull);
  });
}

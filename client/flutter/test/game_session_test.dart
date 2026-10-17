import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/invite.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// The bundled game's manifest and source, as a test stands them in.
class GameAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final text = key.endsWith('manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': key.contains('jobs') ? 'jobs' : 'game'}) : 'bundled game';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

/// An engine that answers as `src/mobile/game-engine.ts` does: a save after `resync save`, and the
/// world's records whenever it has written some. The game's store writes at once, so the save comes
/// back with the `resync` reply itself; a slower store hands it over with the next step.
class StandInEngine {
  StandInEngine({this.saveAtOnce = true});
  final bool saveAtOnce;
  final opened = <Map<String, dynamic>>[];
  final requests = <String>[];
  var saveAsked = false;
  var x = 3.0;

  Future<Object?> answer(MethodCall call) async {
    final args = call.arguments as Map;
    if (call.method == 'create') {
      if (args['entry'] == 'AiWorldJobEngine') return 'jobs-owner';
      expect(args['entry'], 'AiWorldGameEngine');
      opened.add(jsonDecode(args['options'] as String) as Map<String, dynamic>);
      return 'owner-${opened.length}';
    }
    if (call.method == 'dispose') return null;
    final request = jsonDecode(args['request'] as String) as Map;
    requests.add(request['type'] as String);
    final payload = request['payload'] as Map;
    // a step moves the hero first, and the reply says where he got to, as the engine's does
    if (request['type'] == 'step' && ((payload['input'] as Map)['move'] as List)[1] == 1) x += 1;
    final models = <String, Object?>{'hero': {'x': x, 'z': 0, 'playerId': 'hero-1'}};
    if (request['type'] == 'resync' && payload['reason'] == 'save') saveAsked = true;
    if (request['type'] == 'step') models['world'] = {'world:clock': 'day ${request['sequence']}'};
    if (saveAsked && (saveAtOnce || request['type'] == 'step')) {
      saveAsked = false;
      models['save'] = {'state': {'playerId': 'hero-1'}, 'at': x};
    }
    return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
      'requestId': request['id'], 'type': 'result',
      'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': 'WORLD', 'busy': null, 'models': models}}});
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/game-session-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('a game left is kept in its slot, and opened again from what was kept', () async {
    final root = await Directory.systemTemp.createTemp('game-session');
    addTearDown(() => root.delete(recursive: true));
    final engine = StandInEngine();
    messenger.setMockMethodCallHandler(channel, engine.answer);
    const slot = GameSlot(slot: 'first', seed: 3, name: 'Rowan');
    expect(await GameSession.kept(slot, root: root), isFalse);

    final first = await GameSession.open(slot, root: root, viewport: const Size(844, 390), channel: channel, assets: GameAssets());
    expect(engine.opened.single, containsPair('seed', 3));
    expect(engine.opened.single.containsKey('saved'), isFalse, reason: 'a new game has no save');
    expect(engine.opened.single['world'], isEmpty);
    first.hold({...stillInput, 'move': [0, 1]});
    await first.step(1 / 30);
    expect(first.presentation.value['models']['hero']['x'], 4.0);
    await first.close();
    expect(await GameSession.kept(slot, root: root), isTrue);

    // the next launch continues it: the save and the world's records go back into the engine
    final again = await GameSession.open(slot, root: root, viewport: const Size(844, 390), channel: channel, assets: GameAssets());
    expect(engine.opened.last['saved'], {'state': {'playerId': 'hero-1'}, 'at': 4.0});
    expect((engine.opened.last['world'] as Map).keys, contains('world:clock'));
    await again.close();

    // and another slot is another game: nothing of the first reaches it
    final other = await GameSession.open(const GameSlot(slot: 'second', seed: 7), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets());
    expect(engine.opened.last.containsKey('saved'), isFalse);
    expect(engine.opened.last['world'], isEmpty);
    await other.close();
  });

  for (final atOnce in [true, false]) {
    test('a save is kept whichever reply carries it (${atOnce ? 'the resync' : 'the next step'})', () async {
      final root = await Directory.systemTemp.createTemp('game-session');
      addTearDown(() => root.delete(recursive: true));
      final engine = StandInEngine(saveAtOnce: atOnce);
      messenger.setMockMethodCallHandler(channel, engine.answer);
      const slot = GameSlot(slot: 'either', seed: 5);
      final session = await GameSession.open(slot, root: root, viewport: const Size(844, 390), channel: channel, assets: GameAssets());
      await session.save();
      expect(await GameSession.kept(slot, root: root), isTrue);
      await session.close();
    });
  }

  test('a one-shot action is sent once, however long the finger stays down', () async {
    final root = await Directory.systemTemp.createTemp('game-session');
    addTearDown(() => root.delete(recursive: true));
    final sent = <List<Object?>>[];
    final engine = StandInEngine();
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'request') {
        final request = jsonDecode((call.arguments as Map)['request'] as String) as Map;
        if (request['type'] == 'step') sent.add(((request['payload'] as Map)['input'] as Map)['actions'] as List);
      }
      return engine.answer(call);
    });
    final session = await GameSession.open(const GameSlot(slot: 'actions', seed: 3), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets());
    session.hold({...stillInput, 'actions': ['attack']});
    await session.step(1 / 30);
    await session.step(1 / 30);
    expect(sent.take(2), [['attack'], <Object?>[]]);
    await session.close();
  });

  test('a named world is asked about each time it is opened, and the engine joins what its server said (#565)', () async {
    final root = await Directory.systemTemp.createTemp('game-session-named');
    addTearDown(() => root.delete(recursive: true));
    final engine = StandInEngine();
    messenger.setMockMethodCallHandler(channel, engine.answer);
    const slot = GameSlot(slot: 'named-1-worlds.example', seed: 907, kind: 'road', name: 'Rowan',
      server: 'wss://worlds.example/play', world: 'Hollowmere');
    final asked = <Uri>[];
    var described = <String, dynamic>{'name': 'Hollowmere', 'seed': 907, 'kind': 'road',
      'layers': [{'id': 'highland:a', 'kind': 'highland', 'x': 1, 'z': 2, 'seed': 3, 'parent': null, 'version': 1}]};
    Future<Map<String, dynamic>> describe(Uri endpoint) async { asked.add(endpoint); return described; }

    final session = await GameSession.open(slot, root: root, viewport: const Size(844, 390), channel: channel,
      assets: GameAssets(), describe: describe);
    expect(asked.single.toString(), 'https://worlds.example/world?name=Hollowmere');
    expect(engine.opened.single['invite'], described, reason: 'what the server said, for the engine to join as the page does');
    expect(engine.opened.single['server'], 'wss://worlds.example/play');
    await session.close();

    // grown again since, under the same name: not the world this hero was kept in
    described = {...described, 'seed': 908};
    await expectLater(GameSession.open(slot, root: root, viewport: const Size(844, 390), channel: channel,
      assets: GameAssets(), describe: describe), throwsA(isA<WorldRefused>()));
    expect(engine.opened, hasLength(1), reason: 'refused before an engine was opened');
  });
}


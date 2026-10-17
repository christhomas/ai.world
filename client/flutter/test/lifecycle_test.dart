import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/host_contract.dart';
import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class GameAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final text = key.endsWith('manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': key.contains('jobs') ? 'jobs' : 'game'}) : 'bundled game';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

/// An engine held to the real request gate, as `src/mobile/game-engine.ts` is: a step out of order, a
/// time that goes backwards or a request after disposal is refused the way the engine refuses it, so
/// a session that got its bookkeeping wrong under interruption fails here rather than on a phone.
class GatedEngine {
  HostRequestGate? gate;
  final moves = <List<Object?>>[];
  final lifecycles = <String>[];
  var saves = 0;
  var saveAsked = false;

  Future<Object?> answer(MethodCall call) async {
    final args = call.arguments as Map;
    if (call.method == 'create') return 'owner';
    if (call.method == 'dispose') return null;
    final request = jsonDecode(args['request'] as String) as Map<String, dynamic>;
    gate ??= HostRequestGate(request['session'] as String);
    gate!.accept(request);
    final payload = request['payload'] as Map;
    final models = <String, Object?>{'hero': {'x': 0, 'z': 0, 'playerId': 'hero-1'}};
    switch (request['type']) {
      case 'step':
        moves.add(((payload['input'] as Map)['move'] as List));
        if (saveAsked) { saveAsked = false; saves++; models['save'] = {'state': {'playerId': 'hero-1'}}; }
      case 'lifecycle':
        lifecycles.add(payload['state'] as String);
      case 'resync' when payload['reason'] == 'save':
        saveAsked = true;
    }
    return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
      'requestId': request['id'], 'type': 'result',
      'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': 'WORLD', 'busy': null, 'models': models}}});
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/lifecycle-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  Future<(GameSession, GatedEngine, Directory)> open() async {
    final root = await Directory.systemTemp.createTemp('lifecycle');
    final engine = GatedEngine();
    messenger.setMockMethodCallHandler(channel, engine.answer);
    final session = await GameSession.open(const GameSlot(slot: 'away', seed: 3), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets());
    return (session, engine, root);
  }

  test('twenty trips to the background and back leave no thumb held, no step out of order, and a save each time', () async {
    final (session, engine, root) = await open();
    addTearDown(() => root.delete(recursive: true));
    final input = InputOwnerController(session.hold);
    for (var trip = 0; trip < 20; trip++) {
      input.hold('thumb', move: [0, 1]);
      await session.step(1 / 30);
      expect(engine.moves.last, [0, 1]);
      // going away mid-walk, as AppShell and the shell take it: the controls park, the game saves,
      // the engine is told, and a frame already on its way still arrives
      input.lifecycle(false);
      await Future.wait([session.save(), session.step(1 / 30), session.lifecycle(false)]);
      expect(engine.moves.last, [0, 0], reason: 'trip $trip: nothing walks while the app is away');
      input.lifecycle(true);
      await session.lifecycle(true);
      await session.step(1 / 30);
      expect(engine.moves.last, [0, 0], reason: 'trip $trip: coming back does not bring the old thumb back');
    }
    expect(engine.saves, 20, reason: 'every trip away was saved');
    expect(engine.lifecycles.where((state) => state == 'background'), hasLength(20));
    expect(await GameSession.kept(const GameSlot(slot: 'away', seed: 3), root: root), isTrue);
    await session.close();
  });

  test('closing while a step is still on its way lets the step land and stops there', () async {
    final (session, engine, root) = await open();
    addTearDown(() => root.delete(recursive: true));
    final stepping = session.step(1 / 30);
    final closing = session.close();
    await Future.wait([stepping, closing]);
    final steps = engine.moves.length;
    await session.act('attack');
    await session.lifecycle(true);
    expect(engine.moves, hasLength(steps), reason: 'a closed game is sent nothing more');
  });
}

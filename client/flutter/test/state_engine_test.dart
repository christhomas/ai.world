import 'dart:async';
import 'dart:convert';
import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class EngineAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final text = key.endsWith('manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': 'hero-state'}) : 'bundled source';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

class GameEngineAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final scope = key.contains('jobs') ? 'jobs' : 'game';
    final text = key.endsWith('manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': scope}) : 'bundled $scope';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/state-engine-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('an installed game owns a second native engine for its ground and country jobs', () async {
    final opened = <String>[];
    final disposed = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'create') {
        opened.add(args['entry'] as String);
        return args['entry'];
      }
      if (call.method == 'dispose') disposed.add(args['token'] as String);
      return null;
    });
    final game = await StateEngine.openGame('game:split', {'seed': 3}, assets: GameEngineAssets(), channel: channel);
    expect(opened, containsAll(['AiWorldGameEngine', 'AiWorldJobEngine']));
    await game.dispose();
    expect(disposed, containsAll(['AiWorldGameEngine', 'AiWorldJobEngine']));
    expect(disposed, hasLength(2));
  });

  test('a slow job never holds a game request and replies arrive in order on a later request', () async {
    final started = Completer<void>();
    final finished = Completer<String>();
    final jobRequests = <String>[];
    final delivered = <Object?>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'create') return args['entry'];
      if (call.method == 'dispose') return null;
      if (args['token'] == 'AiWorldJobEngine') {
        jobRequests.add(args['request'] as String);
        if (jobRequests.length == 1) { started.complete(); return finished.future; }
        return '{"answer":2}';
      }
      final request = jsonDecode(args['request'] as String) as Map;
      delivered.add(args['jobs']);
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result', 'payload': {},
        'jobs': request['sequence'] == 0 ? ['first job', 'second job'] : <String>[]});
    });
    final game = await StateEngine.openGame('game:async', {}, assets: GameEngineAssets(), channel: channel);
    await game.request('start', {'mode': 'local', 'world': 'slot'});
    await started.future;
    // The first job has deliberately not answered. The game must still answer another request.
    await game.request('resync', {'reason': 'scene'});
    expect(jobRequests, ['first job']);
    expect(delivered, [null, null]);
    finished.complete('{"answer":1}');
    await Future<void>.delayed(Duration.zero);
    await game.request('resync', {'reason': 'scene'});
    expect(jobRequests, ['first job', 'second job']);
    expect(jsonDecode(delivered.last as String), [{'answer': 1}, {'answer': 2}]);
    await game.request('resync', {'reason': 'scene'});
    expect(delivered.last, isNull, reason: 'a reply crosses once');
    await game.dispose();
  });

  test('disposal fences a running job and drops the jobs queued behind it', () async {
    final started = Completer<void>();
    final late = Completer<String>();
    final disposed = <String>[];
    var jobs = 0;
    messenger.setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'create') return args['entry'];
      if (call.method == 'dispose') { disposed.add(args['token'] as String); return null; }
      if (args['token'] == 'AiWorldJobEngine') { jobs++; started.complete(); return late.future; }
      final request = jsonDecode(args['request'] as String) as Map;
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result', 'payload': {}, 'jobs': ['running', 'queued']});
    });
    final game = await StateEngine.openGame('game:gone', {}, assets: GameEngineAssets(), channel: channel);
    await game.request('start', {'mode': 'local', 'world': 'slot'});
    await started.future;
    await game.dispose();
    late.complete('{"answer":"too late"}');
    await Future<void>.delayed(Duration.zero);
    expect(jobs, 1);
    expect(disposed, containsAll(['AiWorldGameEngine', 'AiWorldJobEngine']));
    await expectLater(game.request('resync', {'reason': 'late'}), throwsStateError);
  });

  test('a failed job transport surfaces on the next game request and both owners can be released', () async {
    final disposed = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'create') return args['entry'];
      if (call.method == 'dispose') { disposed.add(args['token'] as String); return null; }
      if (args['token'] == 'AiWorldJobEngine') throw PlatformException(code: 'state-engine', message: 'interrupted');
      final request = jsonDecode(args['request'] as String) as Map;
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result', 'payload': {}, 'jobs': ['job']});
    });
    final game = await StateEngine.openGame('game:failed', {}, assets: GameEngineAssets(), channel: channel);
    await game.request('start', {'mode': 'local', 'world': 'slot'});
    await Future<void>.delayed(Duration.zero);
    await expectLater(game.request('resync', {'reason': 'scene'}), throwsStateError);
    expect(game.isRetired, isTrue);
    await game.dispose();
    expect(disposed, hasLength(2));
  });

  test('a failed game creation releases the already opened jobs context', () async {
    final disposed = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'create') {
        if (args['entry'] == 'AiWorldGameEngine') throw PlatformException(code: 'state-engine', message: 'bad bundle');
        return 'jobs';
      }
      if (call.method == 'dispose') disposed.add(args['token'] as String);
      return null;
    });
    await expectLater(StateEngine.openGame('game:bad', {}, assets: GameEngineAssets(), channel: channel), throwsA(isA<PlatformException>()));
    expect(disposed, ['jobs']);
  });

  test('bundled source and digest cross once; requests ordered and disposal owned once', () async {
    final calls = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      final args = call.arguments as Map;
      if (call.method == 'create') {
        expect(utf8.decode(args['source'] as Uint8List), 'bundled source');
        expect(args['bundleSha256'], 'b' * 64);
        return 'native-owner';
      }
      expect(args['token'], 'native-owner');
      if (call.method == 'dispose') return null;
      final request = jsonDecode(args['request'] as String) as Map;
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result', 'payload': {}});
    });
    final engine = await StateEngine.open('owned', assets: EngineAssets(), channel: channel);
    expect(engine.sourceSha, 'a' * 40);
    await engine.request('start', {'mode': 'local', 'world': 'local'});
    await engine.request('resync', {'reason': 'refresh'});
    final disposal = engine.dispose();
    expect(identical(disposal, engine.dispose()), isTrue);
    await disposal;
    await expectLater(engine.request('resync', {'reason': 'late'}), throwsStateError);
    expect(calls, ['create', 'request', 'request', 'dispose']);
  });

  test('cross-session native reply retires owner and does not replay an uncertain request', () async {
    var requests = 0;
    var disposals = 0;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'create') return 'owner';
      if (call.method == 'dispose') { disposals++; return null; }
      requests++;
      return jsonEncode({'version': 1, 'session': 'stale', 'sequence': 0, 'requestId': 'request:0', 'type': 'result', 'payload': {}});
    });
    final engine = await StateEngine.open('owned', assets: EngineAssets(), channel: channel);
    await expectLater(engine.request('start', {'mode': 'local', 'world': 'local'}), throwsFormatException);
    expect(engine.isRetired, isTrue);
    await expectLater(engine.request('resync', {'reason': 'retry'}), throwsStateError);
    await engine.dispose();
    expect(requests, 1);
    expect(disposals, 1);
  });
}

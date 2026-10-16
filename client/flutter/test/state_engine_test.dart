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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/state-engine-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

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

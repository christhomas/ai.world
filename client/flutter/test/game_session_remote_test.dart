import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/network/world_socket_link.dart';
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

/// A socket that does what the test says, and keeps what it was sent.
class StandInSocket implements ParcelSocket {
  StandInSocket(this.url, this.onOpen, this.onMessage, this.onClose);
  final Uri url;
  final void Function() onOpen;
  final void Function(Object parcel) onMessage;
  final void Function(String why) onClose;
  final sent = <Object>[];
  var started = false, closed = false;
  @override
  Future<void> start() async { started = true; }
  @override
  Future<void> send(Object parcel) async { sent.add(parcel); }
  @override
  Future<void> close() async { closed = true; }
}

/// An engine that joins a shared world as `src/mobile/game-engine.ts` does: when its options name
/// one it asks for the socket as it starts, says hello once it opens, and closes it when the server
/// says `bye`.
class SharedWorldEngine {
  Map<String, dynamic>? options;
  final parcels = <Map>[];
  String? startedAs;

  Future<Object?> answer(MethodCall call) async {
    final args = call.arguments as Map;
    if (call.method == 'create' && args['entry'] == 'AiWorldJobEngine') return 'jobs-owner';
    if (call.method == 'create') { options = jsonDecode(args['options'] as String) as Map<String, dynamic>; return 'owner'; }
    if (call.method == 'dispose') return null;
    final request = jsonDecode(args['request'] as String) as Map;
    final payload = request['payload'] as Map;
    final models = <String, Object?>{'hero': {'x': 0, 'z': 0}};
    if (request['type'] == 'start') {
      startedAs = payload['mode'] as String;
      if (options?['server'] case final String server) models['link'] = {'connect': server, 'generation': 1};
    }
    if (request['type'] == 'parcel') {
      parcels.add(payload);
      if (payload['event'] == 'open') {
        models['outbox'] = [{'text': '{"t":"hello"}'}, {'binary': base64Encode([1, 2, 255])}];
      }
      if (payload['text'] == 'bye') models['link'] = {'close': 1};
    }
    return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
      'requestId': request['id'], 'type': 'result',
      'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': 'WORLD', 'busy': null, 'models': models}}});
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/game-session-remote-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('a shared world is joined through the app\'s socket, both ways, until the game closes it', () async {
    final root = await Directory.systemTemp.createTemp('game-session-remote');
    addTearDown(() => root.delete(recursive: true));
    final engine = SharedWorldEngine();
    messenger.setMockMethodCallHandler(channel, engine.answer);
    final sockets = <StandInSocket>[];
    final session = await GameSession.open(const GameSlot(slot: 'shared', seed: 3, server: 'wss://shared.example'),
      root: root, viewport: const Size(844, 390), channel: channel, assets: GameAssets(),
      sockets: (url, {required onOpen, required onMessage, required onClose}) {
        final socket = StandInSocket(url, onOpen, onMessage, onClose);
        sockets.add(socket);
        return socket;
      });
    expect(engine.options!['server'], 'wss://shared.example');
    expect(engine.startedAs, 'remote');
    final socket = sockets.single;
    expect(socket.url.toString(), 'wss://shared.example');
    expect(socket.started, isTrue);

    socket.onOpen();
    await pumpEventQueue();
    expect(engine.parcels.single, {'generation': 1, 'event': 'open', 'text': null, 'binary': null, 'why': null});
    expect(socket.sent, ['{"t":"hello"}', [1, 2, 255]], reason: 'what the game sent goes out as it was sent, binary as bytes');
    expect(socket.sent.last, isA<Uint8List>());

    socket.onMessage(Uint8List.fromList([9, 8]));
    socket.onMessage('bye');
    await pumpEventQueue();
    expect(engine.parcels[1], {'generation': 1, 'event': 'message', 'text': null, 'binary': base64Encode([9, 8]), 'why': null});
    expect(engine.parcels[2]['text'], 'bye');
    expect(socket.closed, isTrue, reason: 'the game closed its link, so the app closes the socket');

    socket.onMessage('late, from a socket the game has closed');
    await pumpEventQueue();
    expect(engine.parcels, hasLength(3), reason: 'a closed socket cannot speak for the game any more');
    await session.close();
  });

  test('a private world asks for no socket at all', () async {
    final root = await Directory.systemTemp.createTemp('game-session-remote');
    addTearDown(() => root.delete(recursive: true));
    final engine = SharedWorldEngine();
    messenger.setMockMethodCallHandler(channel, engine.answer);
    final session = await GameSession.open(const GameSlot(slot: 'alone', seed: 3), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets(),
      sockets: (url, {required onOpen, required onMessage, required onClose}) => throw StateError('no socket for a private world'));
    expect(engine.options!.containsKey('server'), isFalse);
    expect(engine.startedAs, 'local');
    await session.close();
  });
}

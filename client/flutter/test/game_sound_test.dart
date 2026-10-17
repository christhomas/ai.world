import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_world_flutter/src/audio/synth.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class GameAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final text = key.endsWith('game-manifest.json') ? jsonEncode({'contractVersion': 1,
      'sourceSha': 'a' * 40, 'bundleSha256': 'b' * 64, 'scope': 'game'}) : 'bundled game';
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}

class Heard implements SoundOutput {
  final played = <Int16List>[];
  @override
  Future<void> play(Int16List samples, int rate) async { played.add(samples); }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('world.ai/game-sound-test');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('what the game sounded is made here and played, at the game\'s own volume', () async {
    final root = await Directory.systemTemp.createTemp('game-sound');
    addTearDown(() => root.delete(recursive: true));
    var volume = 0.6;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'create') return 'owner';
      if (call.method == 'dispose') return null;
      final request = jsonDecode((call.arguments as Map)['request'] as String) as Map;
      final models = <String, Object?>{'hero': {'x': 0, 'z': 0}, 'hud': {'volume': volume}};
      if (request['type'] == 'step') {
        models['sounds'] = [
          [{'burst': 1500, 'dur': 0.07, 'q': 1.2, 'gain': 0.12, 'at': 0}],
          [{'tone': 660, 'dur': 0.12, 'wave': 'sine', 'gain': 0.12, 'at': 0}],
        ];
      }
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result',
        'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': 'WORLD', 'busy': null, 'models': models}}});
    });
    final heard = Heard();
    final session = await GameSession.open(const GameSlot(slot: 'loud', seed: 3), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets(), sound: heard);
    await session.step(1 / 30);
    expect(heard.played, hasLength(2), reason: 'a footstep and a chime');
    expect(heard.played.every((samples) => samples.any((s) => s != 0)), isTrue);
    volume = 0;
    await session.step(1 / 30);
    expect(heard.played.skip(2).every((samples) => samples.every((s) => s == 0)), isTrue, reason: 'turned all the way down');
    await session.close();
  });

  test('the wind and the drone under everything are handed over a second at a time, and not when silent', () async {
    final root = await Directory.systemTemp.createTemp('game-beds');
    addTearDown(() => root.delete(recursive: true));
    var wind = 0.07;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'create') return 'owner';
      if (call.method == 'dispose') return null;
      final request = jsonDecode((call.arguments as Map)['request'] as String) as Map;
      final models = <String, Object?>{'hero': {'x': 0, 'z': 0}, 'hud': {'volume': 0.6, 'beds': {
        'wind': wind, 'water': {'gain': 0, 'centre': 1500, 'q': 0.5}, 'drone': {'freq': 110, 'gain': wind > 0 ? 0.025 : 0}}}};
      return jsonEncode({'version': 1, 'session': request['session'], 'sequence': request['sequence'],
        'requestId': request['id'], 'type': 'result',
        'payload': {'state': {'revision': 1, 'tick': 0, 'renderTimeMs': 0, 'owner': 'WORLD', 'busy': null, 'models': models}}});
    });
    final heard = Heard();
    final session = await GameSession.open(const GameSlot(slot: 'beds', seed: 3), root: root,
      viewport: const Size(844, 390), channel: channel, assets: GameAssets(), sound: heard);
    expect(heard.played, hasLength(1), reason: 'a stretch as soon as the game says what to play');
    for (var i = 0; i < 40; i++) { await session.step(1 / 30); }
    expect(heard.played, hasLength(2), reason: 'and the next a second later, not a frame later');
    expect(heard.played.last.length, greaterThan(44100), reason: 'each runs on under the next');
    wind = 0;
    final quiet = heard.played.length;
    for (var i = 0; i < 40; i++) { await session.step(1 / 30); }
    expect(heard.played.length, quiet, reason: 'nothing to hear is nothing handed over');
    await session.close();
  });
}


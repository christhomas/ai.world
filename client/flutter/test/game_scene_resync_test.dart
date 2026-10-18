import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/native_world_renderer.dart';
import 'package:ai_world_flutter/src/scene_frame.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'game_session_test.dart' show GameAssets, StandInEngine;
import 'scene_delta_test.dart' show node, packet;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const engineChannel = MethodChannel('world.ai/scene-recovery-engine');
  const renderChannel = MethodChannel('world.ai/scene-recovery-renderer');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  for (final failure in ['gap', 'native reset']) {
    test('the installed session asks for a full scene after $failure', () async {
      final root = await Directory.systemTemp.createTemp('scene-recovery');
      addTearDown(() => root.delete(recursive: true));
      final engine = StandInEngine();
      var scenes = 0, resyncs = 0, submissions = 0;
      var nativeReset = failure == 'native reset';
      final submitted = <Map>[];
      messenger.setMockMethodCallHandler(renderChannel, (call) async {
        if (call.method == 'create') return 7;
        if (call.method == 'applyScene') {
          submissions++;
          if (nativeReset && submissions == 2) {
            nativeReset = false;
            throw PlatformException(code: 'scene-resync', message: 'Scene resync required: reset');
          }
          submitted.add(call.arguments as Map);
        }
        return null;
      });
      messenger.setMockMethodCallHandler(engineChannel, (call) async {
        final result = await engine.answer(call);
        if (call.method != 'request') return result;
        final request = jsonDecode((call.arguments as Map)['request'] as String) as Map;
        if (request['type'] == 'resync' && request['payload']['reason'] == 'renderer') resyncs++;
        if (request['type'] != 'step') return result;
        scenes++;
        final scene = scenes == 1 ? packet(1, full: true, nodes: [node(1)], order: ['1'])
          : scenes == 2 ? packet(failure == 'gap' ? 3 : 2, changes: [{'id': 1, 'visible': false}])
          : packet(4, full: true, nodes: [node(1)], order: ['1']);
        final reply = jsonDecode(result as String) as Map<String, dynamic>;
        reply['payload']['state']['models']['scene'] = scene;
        return jsonEncode(reply);
      });
      addTearDown(() {
        messenger.setMockMethodCallHandler(engineChannel, null);
        messenger.setMockMethodCallHandler(renderChannel, null);
      });
      final renderer = await NativeWorldRenderer.create(width: 320, height: 180, channel: renderChannel);
      final session = await GameSession.open(const GameSlot(slot: 'resync', seed: 3), root: root,
        viewport: const Size(320, 180), channel: engineChannel, assets: GameAssets(), pipeline: FlutterFramePipeline(renderer));
      for (var step = 0; step < 2; step++) {
        await session.step(1 / 30);
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
      expect(submitted, hasLength(1), reason: 'only the complete pre-failure scene was submitted');
      expect(resyncs, 1, reason: 'a gap or rejected native generation must reach the engine');
      await session.step(1 / 30);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(submitted, hasLength(2));
      expect(submitted.last['full'], true);
      expect((submitted.last['meshes'] as List).length, 1, reason: 'full resync rebuilds matching meshes');
      expect(session.trouble.value, isNull);
      await session.close();
      await renderer.dispose();
    });
  }
}

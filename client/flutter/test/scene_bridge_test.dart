import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final path in [
    'android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt',
    'ios/Runner/WorldRendererBridge.swift',
  ]) {
    test('$path parses and guards an atomic scene batch', () {
      final source = File(path).readAsStringSync();
      for (final field in ['applyScene', 'generation', 'full', 'meshIds', 'meshes', 'removed', 'frame', 'cutaway']) {
        expect(source, contains('"$field"'), reason: path);
      }
      expect(source, contains('Scene resync required'), reason: path);
      expect(source, contains('sceneGeneration.validate'), reason: path);
      final mutation = path.endsWith('.kt') ? 'pending.putAll(updates)' : 'pending.merge(updates)';
      expect(source.indexOf('sceneGeneration.validate'), lessThan(source.indexOf(mutation)));
      expect(source, contains('sceneGeneration.commit'), reason: path);
      expect(source, contains('sceneMeshOrder'), reason: path);
      expect(source, contains(path.endsWith('.kt') ? 'if (!sceneValid)' : 'guard sceneValid'), reason: path);
    });
  }
}

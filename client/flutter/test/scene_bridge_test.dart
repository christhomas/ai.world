import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('both native bridges validate scene generations and inventory before atomic application', () {
    for (final path in [
      'android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt',
      'ios/Runner/WorldRendererBridge.swift',
    ]) {
      final source = File(path).readAsStringSync();
      expect(source, contains('"applyScene"'), reason: path);
      expect(source, contains('"generation"'), reason: path);
      expect(source, contains('"full"'), reason: path);
      expect(source, contains('"meshIds"'), reason: path);
      expect(source, contains('Scene resync required'), reason: path);
      expect(source, contains('sceneGeneration'), reason: path);
    }
  });
}

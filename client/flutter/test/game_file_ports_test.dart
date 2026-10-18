import 'dart:io';

import 'package:ai_world_flutter/src/game_file_ports.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const shareChannel = MethodChannel('dev.fluttercommunity.plus/share');
  const pathChannel = MethodChannel('plugins.flutter.io/path_provider');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('game-file-share-');
    messenger.setMockMethodCallHandler(pathChannel, (call) async {
      expect(call.method, 'getTemporaryDirectory');
      return root.path;
    });
  });
  tearDown(() async {
    messenger.setMockMethodCallHandler(shareChannel, null);
    messenger.setMockMethodCallHandler(pathChannel, null);
    await root.delete(recursive: true);
  });

  for (final (result, status) in [
    ('saved', ShareResultStatus.success),
    ('', ShareResultStatus.dismissed),
    ('dev.fluttercommunity.plus/share/unavailable', ShareResultStatus.unavailable),
  ]) {
    test('the share port returns the OS result ($status) along with one game file', () async {
      final bytes = Uint8List.fromList([123, 125]);
      const origin = Rect.fromLTWH(10, 20, 72, 44);
      var called = false;
      messenger.setMockMethodCallHandler(shareChannel, (call) async {
        called = true;
        expect(call.method, 'share');
        final args = call.arguments as Map;
        final paths = args['paths'] as List;
        expect(paths, hasLength(1));
        final file = File(paths.single as String);
        expect(file.uri.pathSegments.last, 'ai-world-rowan.json');
        expect(await file.readAsBytes(), bytes);
        expect(args['originX'], origin.left);
        expect(args['originY'], origin.top);
        expect(args['originWidth'], origin.width);
        expect(args['originHeight'], origin.height);
        return result;
      });
      expect(await shareGameFile('ai-world-rowan.json', bytes, origin), status);
      expect(called, isTrue);
    });
  }
}

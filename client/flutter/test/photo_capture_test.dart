import 'dart:async';
import 'dart:ui' as ui;

import 'package:ai_world_flutter/src/native_world_renderer.dart';
import 'package:ai_world_flutter/src/photo_capture.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const rendererChannel = MethodChannel('world.ai/renderer');
  const shareChannel = MethodChannel('world.ai/photo');
  const capture = PhotoCapture();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final pixels = Uint8List.fromList([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  late List<MethodCall> rendererCalls, shareCalls;
  late Future<Object?> Function(MethodCall) share;

  setUp(() {
    rendererCalls = [];
    shareCalls = [];
    share = (_) async => 'shared';
    messenger.setMockMethodCallHandler(rendererChannel, (call) async {
      rendererCalls.add(call);
      if (call.method == 'create') return 7;
      if (call.method == 'snapshot') return {'width': 2, 'height': 2, 'rgba': pixels};
      return null;
    });
    messenger.setMockMethodCallHandler(shareChannel, (call) {
      shareCalls.add(call);
      return share(call);
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(rendererChannel, null);
    messenger.setMockMethodCallHandler(shareChannel, null);
  });

  Future<NativeWorldRenderer> renderer() async {
    final renderer = await NativeWorldRenderer.create(width: 2, height: 2);
    addTearDown(renderer.dispose);
    return renderer;
  }

  test('shares a PNG with the rendered dimensions, colours and top row intact', () async {
    final view = await renderer();
    expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.shared);
    expect(rendererCalls.map((call) => call.method), ['create', 'snapshot']);
    expect(rendererCalls.last.arguments, {'textureId': 7});
    expect(shareCalls.single.method, 'share');
    final png = (shareCalls.single.arguments as Map)['png'] as Uint8List;
    expect(png.take(8), [137, 80, 78, 71, 13, 10, 26, 10]);
    final codec = await ui.instantiateImageCodec(png);
    try {
      final decoded = await codec.getNextFrame();
      try {
        expect([decoded.image.width, decoded.image.height], [2, 2]);
        final rgba = (await decoded.image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
        expect(rgba.buffer.asUint8List(rgba.offsetInBytes, rgba.lengthInBytes), pixels);
      } finally {
        decoded.image.dispose();
      }
    } finally {
      codec.dispose();
    }
  });

  for (final (reply, expected) in [('cancelled', PhotoResult.cancelled), ('closed', PhotoResult.closed)]) {
    test('reports $reply without claiming the photo was saved, and can try again', () async {
      final view = await renderer();
      share = (_) async => reply;
      expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), expected);
      share = (_) async => 'shared';
      expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.shared);
      expect(shareCalls, hasLength(2));
      expect(rendererCalls.where((call) => call.method == 'dispose'), isEmpty);
    });
  }

  for (final code in ['permission-denied', 'share-failed']) {
    test('$code is a recoverable failure', () async {
      final view = await renderer();
      share = (_) async => throw PlatformException(code: code);
      expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.failed);
      share = (_) async => 'shared';
      expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.shared);
    });
  }

  test('no renderer yet never opens a share sheet', () async {
    expect(await capture.captureAndShare(() async => null, isCurrent: () => true), PhotoResult.notReady);
    expect(rendererCalls, isEmpty);
    expect(shareCalls, isEmpty);
  });

  test('a retired renderer cannot open a share sheet', () async {
    final view = await renderer();
    await view.dispose();
    expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.failed);
    expect(shareCalls, isEmpty);
  });

  test('a failed readback never hands an empty picture to the OS', () async {
    final view = await renderer();
    messenger.setMockMethodCallHandler(rendererChannel, (call) async {
      rendererCalls.add(call);
      if (call.method == 'snapshot') throw PlatformException(code: 'snapshot-failed');
      return null;
    });
    expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.failed);
    expect(shareCalls, isEmpty);
  });

  test('exiting during readback or encoding fences the late share', () async {
    final waiting = Completer<RenderSnapshot?>();
    var current = true;
    final result = capture.captureAndShare(() => waiting.future, isCurrent: () => current);
    current = false;
    waiting.complete(RenderSnapshot(width: 2, height: 2, rgba: pixels));
    expect(await result, PhotoResult.cancelled);
    final view = await renderer();
    var checks = 0;
    expect(await capture.captureAndShare(view.snapshot, isCurrent: () => ++checks == 1), PhotoResult.cancelled);
    expect(checks, 2, reason: 'the surface is checked again after encoding');
    expect(shareCalls, isEmpty);
  });

  test('an unknown native reply is never presented as success', () async {
    final view = await renderer();
    share = (_) async => null;
    expect(await capture.captureAndShare(view.snapshot, isCurrent: () => true), PhotoResult.failed);
  });
}

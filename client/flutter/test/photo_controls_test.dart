import 'dart:async';

import 'package:ai_world_flutter/src/native_world_renderer.dart';
import 'package:ai_world_flutter/src/photo_capture.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:ai_world_flutter/src/shell/photo_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const rendererChannel = MethodChannel('world.ai/renderer');
  const shareChannel = MethodChannel('world.ai/photo');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late List<String> calls;
  late Completer<void> shown;
  late Future<Object?> Function(MethodCall) share;

  setUp(() {
    calls = [];
    shown = Completer<void>();
    share = (_) async => 'shared';
    messenger.setMockMethodCallHandler(rendererChannel, (call) async {
      calls.add(call.method);
      if (call.method == 'create') return 7;
      if (call.method == 'snapshot') return {'width': 1, 'height': 1, 'rgba': Uint8List.fromList([20, 40, 60, 255])};
      return null;
    });
    messenger.setMockMethodCallHandler(shareChannel, (call) {
      calls.add('share');
      if (!shown.isCompleted) shown.complete();
      return share(call);
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(rendererChannel, null);
    messenger.setMockMethodCallHandler(shareChannel, null);
  });

  Future<void> open(WidgetTester tester, {Future<RenderSnapshot?> Function()? snapshot, VoidCallback? close}) async {
    await tester.binding.setSurfaceSize(const Size(667, 320));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    if (snapshot == null) {
      final renderer = await NativeWorldRenderer.create(width: 1, height: 1);
      addTearDown(renderer.dispose);
      snapshot = renderer.snapshot;
    }
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PhotoControls(
      tokens: LedgerTokens.all[LedgerTheme.stone]!, snapshot: snapshot, close: close ?? () {}))));
  }

  for (final (reply, result) in [('shared', PhotoResult.shared), ('cancelled', PhotoResult.cancelled), ('closed', PhotoResult.closed)]) {
    testWidgets('$reply shows the truthful message and leaves the shutter ready', (tester) async {
      share = (_) async => reply;
      await open(tester);
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const ValueKey('photo-shutter')));
        await shown.future.timeout(const Duration(seconds: 5));
      });
      await tester.pumpAndSettle();
      expect(find.text(result.message), findsOneWidget);
      expect(tester.widget<TextButton>(find.byKey(const ValueKey('photo-shutter'))).onPressed, isNotNull);
      expect(calls, ['create', 'snapshot', 'share']);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('permission denial is shown and the player can take another photo', (tester) async {
    share = (_) async => throw PlatformException(code: 'permission-denied');
    await open(tester);
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('photo-shutter')));
      await shown.future.timeout(const Duration(seconds: 5));
    });
    await tester.pumpAndSettle();
    expect(find.text(PhotoResult.failed.message), findsOneWidget);
    share = (_) async => 'shared';
    shown = Completer<void>();
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('photo-shutter')));
      await shown.future.timeout(const Duration(seconds: 5));
    });
    await tester.pumpAndSettle();
    expect(calls.where((call) => call == 'share'), hasLength(2));
    expect(find.byKey(const ValueKey('photo-exit')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no renderer yet tells the player and keeps exit available', (tester) async {
    var closed = false;
    await open(tester, snapshot: () async => null, close: () => closed = true);
    await tester.tap(find.byKey(const ValueKey('photo-shutter')));
    await tester.pumpAndSettle();
    expect(find.text(PhotoResult.notReady.message), findsOneWidget);
    expect(calls, isEmpty);
    await tester.tap(find.byKey(const ValueKey('photo-exit')));
    expect(closed, isTrue);
    expect(tester.getSize(find.byKey(const ValueKey('photo-exit'))).height, greaterThanOrEqualTo(44));
  });

  testWidgets('a pending share disables duplicate shutters and tolerates the surface retiring', (tester) async {
    final reply = Completer<Object?>();
    share = (_) => reply.future;
    await open(tester);
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('photo-shutter')));
      await shown.future.timeout(const Duration(seconds: 5));
    });
    await tester.pump();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('photo-shutter'))).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('photo-shutter')));
    expect(calls.where((call) => call == 'share'), hasLength(1));
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('The same game continues'))));
    reply.complete('cancelled');
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a readback that never arrives cannot strand the shutter', (tester) async {
    final frame = Completer<RenderSnapshot?>();
    await open(tester, snapshot: () => frame.future);
    await tester.tap(find.byKey(const ValueKey('photo-shutter')));
    await tester.pump(const Duration(seconds: 11));
    await tester.pumpAndSettle();
    expect(find.text(PhotoResult.failed.message), findsOneWidget);
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('photo-shutter'))).onPressed, isNotNull);
    expect(calls, isEmpty);
    frame.complete(null);
  });

  testWidgets('exiting during readback never opens a late share sheet', (tester) async {
    final frame = Completer<RenderSnapshot?>();
    var closed = false;
    await open(tester, snapshot: () => frame.future, close: () => closed = true);
    await tester.tap(find.byKey(const ValueKey('photo-shutter')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('photo-exit')));
    expect(closed, isTrue);
    frame.complete(RenderSnapshot(width: 1, height: 1, rgba: Uint8List.fromList([20, 40, 60, 255])));
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('system Back puts the camera away without popping the game', (tester) async {
    var closed = false;
    await open(tester, snapshot: () async => null, close: () => closed = true);
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(closed, isTrue);
    expect(find.byType(PhotoControls), findsOneWidget, reason: 'the route was not popped');
  });

  testWidgets('Escape puts the camera away', (tester) async {
    var closed = false;
    await open(tester, snapshot: () async => null, close: () => closed = true);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    expect(closed, isTrue);
  });
}

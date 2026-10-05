import 'dart:async';

import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

const _channel = MethodChannel('world.ai/renderer');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late List<MethodCall> calls;
  late Future<Object?> Function(MethodCall) handle;

  setUp(() {
    calls = [];
    handle = (call) async => call.method == 'create' ? 7 : null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) {
          calls.add(call);
          return handle(call);
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  });

  testWidgets('creation owns one texture and catches up to the latest viewport',
      (tester) async {
    final created = Completer<int>();
    handle = (call) async => call.method == 'create' ? created.future : null;
    var notifications = 0;
    void ready(NativeWorldRenderer renderer) => notifications++;
    await tester.pumpWidget(_view(100, 80, ready));
    await tester.pumpWidget(_view(200, 150, ready));
    await tester.pumpWidget(_view(300, 160, ready));
    expect(_sizes(calls, 'create'), [[100, 80]]);
    expect(_sizes(calls, 'resize'), isEmpty);

    created.complete(7);
    await tester.pump();
    expect(_sizes(calls, 'create'), hasLength(1));
    expect(_sizes(calls, 'resize'), [[300, 160]]);
    expect(notifications, 1);
    expect(tester.widget<Texture>(find.byType(Texture)).textureId, 7);
    await _remove(tester);
    expect(_disposed(calls), [7]);
  });

  testWidgets('slow resize coalesces later layouts without overlapping calls',
      (tester) async {
    final resized = Completer<void>();
    var resizing = 0;
    var maximum = 0;
    handle = (call) async {
      if (call.method == 'create') return 7;
      if (call.method == 'resize') {
        resizing++;
        if (resizing > maximum) maximum = resizing;
        if (_sizes(calls, 'resize').length == 1) await resized.future;
        resizing--;
      }
      return null;
    };
    await tester.pumpWidget(_view(100, 80, (_) {}));
    await tester.pump();
    await tester.pumpWidget(_view(200, 100, (_) {}));
    await tester.pumpWidget(_view(300, 120, (_) {}));
    await tester.pumpWidget(_view(400, 140, (_) {}));
    expect(_sizes(calls, 'resize'), [[200, 100]]);
    resized.complete();
    await tester.pump();
    expect(_sizes(calls, 'resize'), [[200, 100], [400, 140]]);
    expect(maximum, 1);
    expect(_sizes(calls, 'create'), hasLength(1));
    await _remove(tester);
  });

  testWidgets('creation finishing after exit releases its texture once',
      (tester) async {
    final created = Completer<int>();
    handle = (call) async => call.method == 'create' ? created.future : null;
    var notifications = 0;
    await tester.pumpWidget(_view(100, 80, (_) => notifications++));
    await _remove(tester);
    created.complete(7);
    await tester.pump();
    expect(_disposed(calls), [7]);
    expect(notifications, 0);
    expect(_sizes(calls, 'resize'), isEmpty);
    expect(find.byType(Texture), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('exit during initialization fences queued layouts',
      (tester) async {
    final initialized = Completer<void>();
    var notifications = 0;
    Future<void> ready(NativeWorldRenderer renderer) {
      notifications++;
      return initialized.future;
    }
    await tester.pumpWidget(_view(100, 80, ready));
    await tester.pump();
    await tester.pumpWidget(_view(300, 160, ready));
    await _remove(tester);
    initialized.complete();
    await tester.pump();
    expect(notifications, 1);
    expect(_disposed(calls), [7]);
    expect(_sizes(calls, 'resize'), isEmpty);
    expect(_sizes(calls, 'create'), hasLength(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('pixel ratio changes resize an unchanged logical viewport',
      (tester) async {
    await tester.pumpWidget(_view(100, 80, (_) {}));
    await tester.pump();
    await tester.pumpWidget(_view(100, 80, (_) {}, ratio: 2));
    await tester.pump();
    expect(_sizes(calls, 'create'), [[100, 80]]);
    expect(_sizes(calls, 'resize'), [[200, 160]]);
    await _remove(tester);
  });

  testWidgets('failed creation reports once and later layout can retry',
      (tester) async {
    var attempts = 0;
    handle = (call) async {
      if (call.method == 'create') {
        attempts++;
        if (attempts == 1) throw PlatformException(code: 'create-failed');
        return 7;
      }
      return null;
    };
    await tester.pumpWidget(_view(100, 80, (_) {}));
    await tester.pump();
    expect(tester.takeException(), isA<PlatformException>());
    await tester.pumpWidget(_view(100, 80, (_) {}));
    expect(attempts, 1);
    await tester.pumpWidget(_view(120, 80, (_) {}));
    await tester.pump();
    expect(_sizes(calls, 'create'), [[100, 80], [120, 80]]);
    expect(find.byType(Texture), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _remove(tester);
  });

  testWidgets('failed resize retains the last successful physical dimensions',
      (tester) async {
    var attempts = 0;
    handle = (call) async {
      if (call.method == 'create') return 7;
      if (call.method == 'resize' && ++attempts == 1) {
        throw PlatformException(code: 'resize-failed');
      }
      return null;
    };
    await tester.pumpWidget(_view(100, 80, (_) {}));
    await tester.pump();
    await tester.pumpWidget(_view(200, 80, (_) {}));
    await tester.pump();
    expect(tester.takeException(), isA<PlatformException>());
    await tester.pumpWidget(_view(100, 80, (_) {}));
    await tester.pump();
    expect(_sizes(calls, 'resize'), [[200, 80]]);
    await tester.pumpWidget(_view(200, 80, (_) {}));
    await tester.pump();
    expect(_sizes(calls, 'resize'), [[200, 80], [200, 80]]);
    expect(tester.takeException(), isNull);
    await _remove(tester);
  });
}

Widget _view(double width, double height,
    FutureOr<void> Function(NativeWorldRenderer) ready, {double ratio = 1}) {
  return Directionality(
    textDirection: TextDirection.ltr,
    child: MediaQuery(
      data: MediaQueryData(devicePixelRatio: ratio),
      child: Center(
        child: SizedBox(
          width: width,
          height: height,
          child: NativeWorldView(key: const ValueKey('world'), onCreated: ready),
        ),
      ),
    ),
  );
}

List<List<int>> _sizes(List<MethodCall> calls, String method) => [
  for (final call in calls.where((call) => call.method == method))
    [
      (call.arguments as Map)['width'] as int,
      (call.arguments as Map)['height'] as int,
    ],
];

List<int> _disposed(List<MethodCall> calls) => [
  for (final call in calls.where((call) => call.method == 'dispose'))
    (call.arguments as Map)['textureId'] as int,
];

Future<void> _remove(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}

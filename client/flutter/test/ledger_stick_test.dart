import 'dart:math' as math;

import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:ai_world_flutter/src/shell/ledger_stick.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<List<Map<String, Object?>>> stick(WidgetTester tester, InputOwnerController Function(List<Map<String, Object?>>) owner) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final sent = <Map<String, Object?>>[];
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr,
      child: LedgerStick(input: owner(sent))));
    return sent;
  }

  testWidgets('a thumb walks where it leans, a full lean is the stick range, and lifting lets go', (tester) async {
    late InputOwnerController input;
    final sent = await stick(tester, (sent) => input = InputOwnerController(sent.add));
    final thumb = await tester.startGesture(const Offset(300, 200));
    await thumb.moveTo(const Offset(300, 200 - LedgerStick.range * 2));   // leaned past the range: held at it
    expect(sent.last['move'], [0.0, 1.0]);
    await thumb.moveTo(const Offset(300 + LedgerStick.range / 2, 200));
    expect(sent.last['move'], [0.5, 0.0]);
    await thumb.up();
    expect(sent.last['move'], [0, 0]);
    expect(input.acceptsWorld, isTrue);
  });

  testWidgets('a thumb in the tab gutter steers nothing, and nor does one under an open book', (tester) async {
    late InputOwnerController input;
    final sent = await stick(tester, (sent) => input = InputOwnerController(sent.add));
    final tabs = await tester.startGesture(const Offset(20, 300));
    await tabs.moveTo(const Offset(80, 240));
    expect(sent, isEmpty);
    await tabs.up();
    input.focus(InputOwner.book, busy: 'reading');
    final reading = await tester.startGesture(const Offset(300, 200));
    await reading.moveTo(const Offset(300, 120));
    expect(sent.last['move'], [0, 0]);
    await reading.up();
  });

  testWidgets('a second thumb does not take the stick from a first that is already steering', (tester) async {
    final sent = await stick(tester, (sent) => InputOwnerController(sent.add));
    final first = await tester.startGesture(const Offset(300, 200), pointer: 1);
    await first.moveTo(const Offset(300 - LedgerStick.range / 2, 200));
    final steering = sent.length;
    final second = await tester.startGesture(const Offset(600, 200), pointer: 2);
    await second.moveTo(const Offset(600, 100));
    expect(sent.length, steering, reason: 'the other finger turns nothing and walks nothing');
    await first.moveTo(const Offset(300 - LedgerStick.range, 200));
    expect(sent.last['move'], [-1.0, 0.0]);
    await second.up();
    await first.cancel();
    expect(sent.last['move'], [0, 0]);
  });

  testWidgets('two fingers on the world turn the camera while they twist, and pinch it', (tester) async {
    late InputOwnerController input;
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final sent = <Map<String, Object?>>[];
    final zoomed = <double>[];
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr,
      child: LedgerStick(input: input = InputOwnerController(sent.add), onZoom: zoomed.add)));
    final a = await tester.startGesture(const Offset(400, 200), pointer: 1);
    final b = await tester.startGesture(const Offset(500, 200), pointer: 2);
    expect(sent.last['move'], [0, 0], reason: 'two fingers together are not a walk');
    // clockwise on the glass, a few degrees a move: the camera turns right for as long as the hand turns
    for (var step = 1; step <= 3; step++) {
      final angle = step * 0.15;
      await b.moveTo(Offset(450 + 50 * math.cos(angle), 200 + 50 * math.sin(angle)));
      await a.moveTo(Offset(450 - 50 * math.cos(angle), 200 - 50 * math.sin(angle)));
    }
    expect(sent.last['look'], [1.0, 0.0]);
    expect(sent.last['move'], [0, 0]);
    // the hand stops turning, and the camera stops with it
    await b.moveTo(Offset(450 + 52 * math.cos(0.45), 200 + 52 * math.sin(0.45)));
    expect(sent.last['look'], [0, 0]);
    // fingers apart is zoom in: the wheel the other way
    await b.moveTo(Offset(450 + 90 * math.cos(0.45), 200 + 90 * math.sin(0.45)));
    await a.up();
    expect(zoomed, isNotEmpty);
    expect(zoomed.fold<double>(0, (sum, by) => sum + by), lessThan(-60), reason: 'about forty pixels apart, at two a pixel');
    await b.up();
    expect(input.acceptsWorld, isTrue);
    expect(sent.last['look'], [0, 0]);
  });
}

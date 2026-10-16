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

  testWidgets('a second thumb does not take the stick from the first', (tester) async {
    final sent = await stick(tester, (sent) => InputOwnerController(sent.add));
    final first = await tester.startGesture(const Offset(300, 200), pointer: 1);
    final second = await tester.startGesture(const Offset(200, 200), pointer: 2);
    await second.moveTo(const Offset(200, 100));
    expect(sent, isEmpty);
    await first.moveTo(const Offset(300 - LedgerStick.range, 200));
    expect(sent.last['move'], [-1.0, 0.0]);
    await second.up();
    await first.cancel();
    expect(sent.last['move'], [0, 0]);
  });
}

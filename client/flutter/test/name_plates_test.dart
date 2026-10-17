import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:ai_world_flutter/src/shell/name_plates.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a name hangs centred over the point the game gives, and takes no touch', (tester) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var tapped = 0;
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Stack(children: [
      Positioned.fill(child: GestureDetector(onTap: () => tapped++)),
      NamePlates(plates: const [{'id': 'ada', 'text': 'Ada 👋', 'x': 400, 'y': 200}, {'id': 'bo', 'text': 'Bo'}],
        tokens: LedgerTokens.all[LedgerTheme.stone]!),
    ])));
    final plate = tester.getRect(find.byKey(const ValueKey('plate-ada')).first);
    expect(find.text('Ada 👋'), findsOneWidget);
    expect(find.text('Bo'), findsNothing, reason: 'a name with nowhere to hang is not drawn');
    final drawn = tester.getRect(find.text('Ada 👋'));
    expect(drawn.center.dx, closeTo(400, 1), reason: 'centred on the head');
    expect(drawn.bottom, lessThanOrEqualTo(200), reason: 'above the point, not on it');
    expect(plate.left, 400);
    await tester.tapAt(drawn.center);
    expect(tapped, 1, reason: 'the world under a name still takes the touch');
  });
}

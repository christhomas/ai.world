import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:ai_world_flutter/src/shell/subject_ring.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final tokens = LedgerTokens.all[LedgerTheme.stone]!;

  Future<int> show(WidgetTester tester, Map? subject) async {
    var tapped = 0;
    await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Stack(children: [
      Positioned.fill(child: GestureDetector(onTap: () => tapped++)),
      SubjectRing(subject: subject, tokens: tokens),
    ])));
    await tester.tapAt(const Offset(400, 230));
    return tapped;
  }

  testWidgets('rings the feet of whoever is in reach and hangs their name over them, taking no touch', (tester) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final tapped = await show(tester, {'name': 'Ada Marsh', 'feet': {'x': 400, 'y': 230}, 'head': {'x': 400, 'y': 170}});
    expect(tester.getRect(find.byKey(const ValueKey('subject-ring'))), const Rect.fromLTWH(373, 222, 54, 16));
    final name = tester.getRect(find.text('Ada Marsh'));
    expect(name.center.dx, closeTo(400, 1));
    expect(name.bottom, lessThanOrEqualTo(170), reason: 'over the head');
    expect(tapped, 1, reason: 'the world under the ring still takes the touch');
  });

  testWidgets('draws nothing for nobody, or for somebody with nowhere to stand', (tester) async {
    await show(tester, null);
    expect(find.byKey(const ValueKey('subject-ring')), findsNothing);
    await show(tester, {'name': 'Bo', 'feet': {'x': 1}});
    expect(find.text('Bo'), findsNothing);
  });
}

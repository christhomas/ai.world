import 'package:ai_world_flutter/src/shell/ledger_thumb_ring.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the ring is the design size and says what it shows', (tester) async {
    await tester.pumpWidget(const Directionality(textDirection: TextDirection.ltr,
      child: Center(child: LedgerThumbRing(health: 0.72, breath: 0.68, nub: Offset(12, -8)))));
    expect(tester.getSize(find.byType(LedgerThumbRing)), const Size(104, 104));
    expect(find.bySemanticsLabel('health 72%, breath 68%'), findsOneWidget);
    // shares outside a bar are held to it rather than drawn round twice
    await tester.pumpWidget(const Directionality(textDirection: TextDirection.ltr,
      child: Center(child: LedgerThumbRing(health: 1.4, breath: -1))));
    expect(tester.takeException(), isNull);
  });
}

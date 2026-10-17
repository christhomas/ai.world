import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:ai_world_flutter/src/shell/more_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('more opens the rest of the controls, a tap does one and puts them away', (tester) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final done = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Align(alignment: Alignment.topRight,
      child: MoreControls(tokens: LedgerTokens.all[LedgerTheme.stone]!, onAction: done.add)))));
    expect(find.byKey(const ValueKey('more-ward')), findsNothing, reason: 'put away until asked for');
    await tester.tap(find.byKey(const ValueKey('more')));
    await tester.pump();
    for (final control in moreControls) {
      expect(find.bySemanticsLabel(control.label), findsOneWidget, reason: control.label);
    }
    await tester.tap(find.byKey(const ValueKey('more-ward')));
    await tester.pump();
    expect(done, ['ward']);
    expect(find.byKey(const ValueKey('more-ward')), findsNothing);
  });

  test('every control is one of the game\\'s own actions, or the console', () {
    const actions = {'interact', 'jump', 'attack', 'shoot', 'ward', 'blight', 'light', 'draught', 'inventory', 'journal',
      'roster', 'map', 'options', 'company', 'chat', 'party', 'hire', 'give', 'rally', 'photo', 'cameraMode', 'seeThrough',
      'leave', 'close'};
    for (final control in moreControls) {
      expect(actions.contains(control.action) || control.action == 'console', isTrue, reason: control.action);
    }
  });
}

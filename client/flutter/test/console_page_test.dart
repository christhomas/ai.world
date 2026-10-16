import 'package:ai_world_flutter/src/screens/console_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<(List<String>, List<int>)> console(WidgetTester tester, List<Map> lines) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final said = <String>[], done = <int>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ConsolePage(lines: lines,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, say: said.add, done: () => done.add(1)))));
    return (said, done);
  }

  testWidgets('shows what was said, newest at the foot, and sends a typed line as it was typed', (tester) async {
    final (said, done) = await console(tester, [
      {'text': 'Mira: well met', 'kind': 'chat'},
      {'text': 'TOPICS: farming, ferries', 'kind': 'sys'},
    ]);
    expect(find.text('Mira: well met'), findsOneWidget);
    expect(tester.getTopLeft(find.text('TOPICS: farming, ferries')).dy,
      greaterThan(tester.getTopLeft(find.text('Mira: well met')).dy), reason: 'the newest line is lowest');
    await tester.enterText(find.byKey(const ValueKey('console-line')), '  ?ferries ');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(said, ['?ferries']);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('console-line'))).controller!.text, isEmpty);
    await tester.tap(find.byKey(const ValueKey('console-say')));
    expect(said, ['?ferries'], reason: 'an empty line says nothing');
    await tester.tap(find.byKey(const ValueKey('console-done')));
    expect(done, [1]);
  });

  testWidgets('an empty console says how to begin', (tester) async {
    await console(tester, const []);
    expect(find.text('Nothing said yet. Type ? to ask the game what it knows.'), findsOneWidget);
  });
}

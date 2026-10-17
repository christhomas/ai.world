import 'package:ai_world_flutter/src/screens/roster_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The engine's `roster` model, as `src/game/roster-view.ts` reads a register of three.
const roster = <String, dynamic>{
  'day': 100, 'by': 'village', 'alive': 3, 'villages': 2, 'purse': 55, 'hungry': 1, 'unvisited': 4,
  'people': [
    {'id': 'p1', 'name': 'Bo', 'village': 'Alder', 'trade': 'farmer', 'age': 90, 'old': true, 'purse': 40, 'hungry': 2, 'doing': 'fishing', 'parents': '—'},
    {'id': 'p2', 'name': 'Cass', 'village': 'Alder', 'trade': 'baby', 'age': 5, 'old': false, 'purse': 12, 'hungry': 0, 'doing': '', 'parents': 'Ada & Bo'},
    {'id': 'p3', 'name': 'Ada', 'village': 'Byre', 'trade': 'smith', 'age': 40, 'old': false, 'purse': 3, 'hungry': 0, 'doing': '', 'parents': '—'},
  ],
};

void main() {
  testWidgets('asks for the roster while it is open, in the order chosen, and stops when it closes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final asked = <String?>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: RosterPage(roster: roster,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, read: asked.add))));
    expect(asked, ['village']);
    expect(find.text('Day 100 · 3 alive in 2 villages · 55 gold between them · 1 going without'), findsOneWidget);
    expect(find.textContaining('4 more villages have not been visited yet'), findsOneWidget);
    expect(find.text('Bo (old)'), findsOneWidget, reason: 'old age is said, as the page says it');
    expect(find.text('Alder · farmer · 90 · 2d hungry · fishing'), findsOneWidget);
    expect(tester.getSize(find.byKey(const ValueKey('person-p2'))).height, 44);
    await tester.tap(find.byKey(const ValueKey('sort-purse')));
    await tester.tap(find.byKey(const ValueKey('sort-purse')));
    expect(asked, ['village', 'purse'], reason: 'the same order twice asks once');
    await tester.pumpWidget(const SizedBox.shrink());
    expect(asked, ['village', 'purse', null]);
  });

  testWidgets('says it is reading before the register arrives', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: RosterPage(roster: const {},
      tokens: LedgerTokens.all[LedgerTheme.stone]!, read: (_) {}))));
    expect(find.text('Reading the register…'), findsOneWidget);
  });
}

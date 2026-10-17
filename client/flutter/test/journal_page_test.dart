import 'package:ai_world_flutter/src/screens/journal_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The engine's `journal` model, as `src/game/journal-view.ts` reads a hero a few days out.
final journal = <String, dynamic>{
  'day': 4, 'season': 'autumn', 'hp': 8, 'maxHp': 10, 'attack': 3, 'defence': 1, 'gold': 42,
  'placesFound': 2, 'errandsDone': 1, 'cellsWalked': 310,
  'errands': [
    {'id': 'q-1', 'done': false, 'what': 'find the Old Mill', 'village': 'Ashford', 'tiles': 12, 'bearing': 'NE', 'at': {'x': 9, 'z': -8}},
    {'id': 'q-2', 'done': true, 'what': 'bring 2× Bread', 'village': 'Nowhere', 'tiles': null, 'bearing': null, 'at': null},
  ],
  'found': [
    for (var i = 0; i < 30; i++) {'name': 'Stone $i', 'icon': '⭐', 'tiles': 10 + i, 'bearing': 'W', 'at': {'x': -10 - i, 'z': 0}},
  ],
  'ferries': <Map<String, dynamic>>[],
};

void main() {
  Future<void> page(WidgetTester tester, Map<String, dynamic> model, {void Function(Offset place)? show}) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JournalPage(journal: model, tokens: LedgerTokens.all[LedgerTheme.stone]!,
      show: show))));
  }

  testWidgets('owes, finds and sails as the game says, one 44px row each', (tester) async {
    await page(tester, journal);
    expect(find.text('DAY 4 · AUTUMN'), findsOneWidget);
    expect(find.text('2 places found · 1 errands finished · 310 map cells walked'), findsOneWidget);
    expect(tester.getSize(find.byKey(const ValueKey('errand-q-1'))).height, 44);
    expect(find.text('📜 find the Old Mill'), findsOneWidget);
    expect(find.text('Ashford, 12 tiles'), findsOneWidget);
    expect(find.text('NE'), findsOneWidget, reason: 'an errand points the way to the village that asked');
    expect(find.text('DONE'), findsOneWidget, reason: 'a met errand says so, and points nowhere');
  });

  testWidgets('a row that knows where it is opens the map there, and one that does not is only read', (tester) async {
    final shown = <Offset>[];
    await page(tester, journal, show: shown.add);
    await tester.tap(find.byKey(const ValueKey('errand-q-1')));
    await tester.tap(find.byKey(const ValueKey('errand-q-2')));
    await tester.tap(find.byKey(const ValueKey('found-Stone 0')));
    expect(shown, [const Offset(9, -8), const Offset(-10, 0)]);
  });

  testWidgets('a long list of finds scrolls to its last', (tester) async {
    await page(tester, journal);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('found-Stone 29')), 44);
    expect(find.text('39 tiles'), findsOneWidget);
  });

  testWidgets('a new hero has nothing owed or found, and the page says so', (tester) async {
    await page(tester, const {'day': 1, 'season': 'spring', 'errands': [], 'found': [], 'ferries': []});
    expect(find.text('Nothing promised. Village elders stand near their wells.'), findsOneWidget);
    expect(find.text('Nothing yet. Follow the roads.'), findsOneWidget);
    expect(find.text('No crossings known.'), findsOneWidget);
  });
}

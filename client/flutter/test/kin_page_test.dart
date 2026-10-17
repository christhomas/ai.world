import 'package:ai_world_flutter/src/screens/kin_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The engine's `kin` model, as `src/game/kin-view.ts` lays out a small descent: a mother nobody has a
/// record of, her daughter, and a man in the churchyard with a name too long for his card.
Map<String, dynamic> descent(int unrolled) => {
  'unrolled': unrolled, 'village': 'Ashford', 'headline': 'Ashford: 3 of them over 2 generations',
  'people': [
    {'id': 'a', 'name': 'Bea Marsh', 'standing': 'remembered', 'x': 0, 'y': 0,
      'record': ['Bea Marsh', 'no trade · remembered only as a parent', 'parent of Ada Marsh']},
    {'id': 'b', 'name': 'Ada Marsh', 'standing': 'living', 'x': 0, 'y': 1,
      'record': ['Ada Marsh', 'miller · living', '30 years old', 'child of Bea Marsh']},
    {'id': 'c', 'name': 'Wolfram Bartholomew-Underhill-Fairweather', 'standing': 'buried', 'x': 1, 'y': 1,
      'record': ['Wolfram Bartholomew-Underhill-Fairweather', 'smith · died on day 40', '70 years old when they died']},
  ],
  'ties': [{'child': 'b', 'parent': 'a'}],
};

void main() {
  final tokens = LedgerTokens.all[LedgerTheme.stone]!;

  Future<void> show(WidgetTester tester, Map<String, dynamic> kin) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: KinPage(kin: kin, tokens: tokens))));
    await tester.pump();
  }

  testWidgets('draws the descent, and says what the clerk has on whoever is tapped', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await show(tester, descent(1));
    expect(find.text('THE DESCENT OF ASHFORD'), findsOneWidget);
    expect(find.text('Ashford: 3 of them over 2 generations'), findsOneWidget);
    expect(find.text('Tap somebody to see what the clerk has on them.'), findsOneWidget);
    expect(tester.takeException(), isNull, reason: 'a long name is cut short on its card, not spilled over it');

    await tester.tap(find.byKey(const ValueKey('kin-b')));
    await tester.pump();
    expect(find.text('miller · living'), findsOneWidget);
    expect(find.text('child of Bea Marsh'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kin-c')));
    await tester.pump();
    expect(find.text('70 years old when they died'), findsOneWidget);
    expect(find.text('miller · living'), findsNothing, reason: 'one person at a time');
    await tester.tap(find.byKey(const ValueKey('kin-c')));
    await tester.pump();
    expect(find.text('Tap somebody to see what the clerk has on them.'), findsOneWidget, reason: 'tapped again, put down');
  });

  testWidgets('a descent laid out again starts with nobody chosen', (tester) async {
    await show(tester, descent(1));
    await tester.tap(find.byKey(const ValueKey('kin-b')));
    await tester.pump();
    expect(find.text('miller · living'), findsOneWidget);
    await show(tester, descent(2));
    expect(find.text('miller · living'), findsNothing);
  });

  testWidgets('an empty book says so rather than drawing nothing', (tester) async {
    await show(tester, const {'unrolled': 1, 'village': 'Nowhere', 'headline': 'Nobody has kept a record at Nowhere',
      'people': [], 'ties': []});
    expect(find.text('Nobody has kept a record at Nowhere'), findsOneWidget);
    expect(find.text('The clerk has an empty book.'), findsOneWidget);
  });
}

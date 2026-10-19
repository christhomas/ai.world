import 'package:ai_world_flutter/src/screens/pack_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The engine's `pack` model, as `src/game/pack.ts` reads a hero with a stick in hand.
const pack = <String, dynamic>{
  'gold': 25, 'hp': 10, 'maxHp': 10, 'attack': 2, 'defence': 0,
  'worn': [
    {'slot': 'head', 'slotName': 'Head', 'icon': '🪖', 'id': null, 'name': null, 'emoji': null, 'note': ''},
    {'slot': 'hand', 'slotName': 'Hand', 'icon': '🗡', 'id': 'stick', 'name': 'Stick', 'emoji': '🪵', 'note': '+1 attack'},
  ],
  'carried': [
    {'id': 'bread', 'name': 'Bread', 'emoji': '🍞', 'count': 3, 'verb': 'use', 'note': 'Restores a little health', 'price': 1},
    {'id': 'pelt', 'name': 'Pelt', 'emoji': '🟫', 'count': 1, 'verb': 'look',
      'note': 'A pelt. Worth something to a tanner, and a great deal more words than a row can hold on a phone held sideways', 'price': 4},
  ],
};

void main() {
  testWidgets('the pack shows the game rows, and a tap is the game rule for that row', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final taken = <String>[], stowed = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PackPage(pack: pack, tokens: LedgerTokens.all[LedgerTheme.stone]!,
      take: taken.add, stow: stowed.add))));
    expect(find.text('25 gold · 4 carried · 1/2 worn'), findsOneWidget);
    expect(tester.getSize(find.byKey(const ValueKey('carried-bread'))).height, 44);
    expect(find.text('USE'), findsOneWidget);
    expect(find.text('4g'), findsOneWidget, reason: 'a thing to look at shows what it is worth');
    await tester.tap(find.byKey(const ValueKey('carried-bread')));
    await tester.tap(find.byKey(const ValueKey('worn-hand')));
    await tester.tap(find.byKey(const ValueKey('worn-head')));
    expect(taken, ['bread']);
    expect(stowed, ['hand:stick'], reason: 'a worn cell names what it shows, and an empty slot has nothing to stow');
    expect(tester.takeException(), isNull, reason: 'a long note gives way rather than overflowing the row');
  });

  testWidgets('an empty pack says so', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PackPage(pack: const {'gold': 0, 'worn': [], 'carried': []},
      tokens: LedgerTokens.all[LedgerTheme.vellum]!, take: (_) {}, stow: (_) {}))));
    expect(find.text('Nothing but lint.'), findsOneWidget);
  });
}

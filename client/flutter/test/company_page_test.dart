import 'package:ai_world_flutter/src/screens/company_page.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The engine's `company` model, as `src/game/company-view.ts` reads two other travellers.
const company = <String, dynamic>{
  'me': 'Ada', 'where': 'out in the world',
  'travellers': [
    {'id': 'p1', 'name': 'Bo', 'party': true, 'where': 'here with you', 'away': 5, 'riding': 'horse'},
    {'id': 'p2', 'name': 'Cass', 'party': false, 'where': 'inside the general store', 'away': 120, 'riding': 'foot'},
  ],
};

void main() {
  testWidgets('asks for the travellers while it is open, and stops when it closes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final asked = <String?>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CompanyPage(company: company,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, read: asked.add))));
    expect(asked, ['company']);
    expect(find.text('You are Ada, out in the world.'), findsOneWidget);
    expect(find.text('🧭 Bo'), findsOneWidget, reason: 'somebody travelling with you is marked, as on the page');
    expect(find.text('here with you · on horseback'), findsOneWidget);
    expect(find.text('120 tiles'), findsOneWidget);
    expect(tester.getSize(find.byKey(const ValueKey('traveller-p2'))).height, 44);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(asked, ['company', null]);
  });

  testWidgets('says when nobody else is in the world, and when it has not heard yet', (tester) async {
    final tokens = LedgerTokens.all[LedgerTheme.stone]!;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CompanyPage(company: const {}, tokens: tokens, read: (_) {}))));
    expect(find.text('Looking about…'), findsOneWidget);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CompanyPage(
      company: const {'me': 'Ada', 'where': 'out in the world', 'travellers': []}, tokens: tokens, read: (_) {}))));
    expect(find.text('Nobody else is in this world right now.'), findsOneWidget);
  });
}

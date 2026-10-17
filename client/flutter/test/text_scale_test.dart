import 'package:ai_world_flutter/main.dart';
import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:ai_world_flutter/src/shell/ledger_action_card.dart';
import 'package:ai_world_flutter/src/shell/ledger_shell.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The player's own text size (#578): followed as far as a phone held sideways has room for it.
void main() {
  Future<TextScaler> scaledBy(WidgetTester tester, double asked) async {
    late TextScaler seen;
    tester.platformDispatcher.textScaleFactorTestValue = asked;
    await tester.pumpWidget(MaterialApp(builder: AiWorldClient.readable,
      home: Builder(builder: (context) { seen = MediaQuery.textScalerOf(context); return const SizedBox(); })));
    await tester.pump();
    return seen;
  }

  testWidgets('smaller as asked, larger by up to a third, and no further', (tester) async {
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    expect((await scaledBy(tester, 0.85)).scale(10), closeTo(8.5, 0.001));
    expect((await scaledBy(tester, 1.15)).scale(10), closeTo(11.5, 0.001));
    expect((await scaledBy(tester, 3)).scale(10), closeTo(13, 0.001));
  });

  for (final viewport in [const Size(667, 320), const Size(844, 390)]) {
    testWidgets('the HUD, the action card and a book fit at the largest text, at $viewport', (tester) async {
      await tester.binding.setSurfaceSize(viewport);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final input = InputOwnerController((_) {});
      final controller = LedgerController(input);
      final pages = <String, LedgerPageBuilder>{
        'pack': (_, t) => ListView(children: [
          for (final (i, name) in ['Hunting bow', 'A very long name for a cloak somebody once wore to a wedding'].indexed)
            LedgerRow(key: ValueKey('row-$i'), name: name, tokens: t, consequence: 'worn · 3 carried · keeps the rain off', verb: 'TAKE OFF'),
        ]),
        'options': (_, t) => LedgerThemePicker(controller: controller),
      };
      await tester.pumpWidget(MaterialApp(home: MediaQuery(
        data: MediaQueryData(size: viewport, textScaler: const TextScaler.linear(AiWorldClient.maxTextScale),
          padding: const EdgeInsets.only(left: 24, right: 16, bottom: 12)),
        child: Scaffold(body: LedgerShell(world: const SizedBox.expand(), controller: controller, pages: pages,
          place: 'The Bakker house in Blackby', readings: '87/100 · 64 BREATH', clock: '21:45 · DAY 112 · AUTUMN',
          bearings: '1,204 GOLD', actionCard: LedgerActionCard(input: input, tokens: LedgerTokens.all[LedgerTheme.stone]!,
            subject: 'TALK TO THE INNKEEPER', verbs: {'TALK · USE': () {}}))))));
      expect(tester.takeException(), isNull, reason: 'the HUD');
      for (final page in ['pack', 'options']) {
        controller.open(page);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: page);
        if (page == 'pack') expect(tester.getSize(find.byKey(const ValueKey('row-1'))).height, greaterThanOrEqualTo(44));
        controller.close();
        await tester.pumpAndSettle();
      }
    });
  }
}

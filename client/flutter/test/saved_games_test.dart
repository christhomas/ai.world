import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/kept_games.dart';
import 'package:ai_world_flutter/src/screens/saved_games.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final games = <KeptGame>[
    (slot: const GameSlot(slot: 'local-1', seed: 9, name: 'Rowan'), played: DateTime(2026, 10, 3)),
    (slot: const GameSlot(slot: 'local-2', seed: 4, name: 'Rowan', server: 'wss://world.example/play'), played: DateTime(2026, 9, 1)),
  ];

  Future<(List<String>, List<String>)> shown(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final played = <String>[], deleted = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SavedGames(games: games,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, play: (slot) => played.add(slot.slot),
      delete: (slot) => deleted.add(slot.slot), back: () {})))));
    return (played, deleted);
  }

  testWidgets('tells two games of the same name apart, and plays the one tapped', (tester) async {
    final (played, _) = await shown(tester);
    expect(find.text('your own world · played 3 Oct'), findsOneWidget);
    expect(find.text('shared, world.example · played 1 Sep'), findsOneWidget);
    expect(tester.getSize(find.byKey(const ValueKey('play-local-2'))).height, greaterThanOrEqualTo(44));
    await tester.tap(find.byKey(const ValueKey('play-local-2')));
    expect(played, ['local-2']);
  });

  testWidgets('deletes nothing until the player says yes to deleting it for good', (tester) async {
    final (_, deleted) = await shown(tester);
    await tester.tap(find.byKey(const ValueKey('delete-local-1')));
    await tester.pumpAndSettle();
    expect(find.textContaining('cannot be undone'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('delete-keep')));
    await tester.pumpAndSettle();
    expect(deleted, isEmpty, reason: 'keeping it keeps it');
    await tester.tap(find.byKey(const ValueKey('delete-local-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delete-sure')));
    await tester.pumpAndSettle();
    expect(deleted, ['local-1']);
  });
}

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

  final exported = <(String, Rect?)>[];
  Future<(List<String>, List<String>)> shown(WidgetTester tester, {bool exporting = true, String? note}) async {
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    exported.clear();
    final played = <String>[], deleted = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SavedGames(games: games,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, play: (slot) => played.add(slot.slot),
      delete: (slot) => deleted.add(slot.slot), back: () {},
      exportGame: exporting ? (slot, origin) => exported.add((slot.slot, origin)) : null, note: note)))));
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

  testWidgets('exports the game tapped, from a button as large as the others, pointing the sheet at it', (tester) async {
    final (played, deleted) = await shown(tester);
    final button = find.byKey(const ValueKey('export-local-1'));
    expect(tester.getSize(button).height, greaterThanOrEqualTo(44));
    expect(tester.getSize(button).width, tester.getSize(find.byKey(const ValueKey('play-local-1'))).width);
    final semantics = tester.ensureSemantics();
    expect(find.bySemanticsLabel("Export Rowan's game to a file"), findsOneWidget);
    semantics.dispose();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(exported.map((e) => e.$1), ['local-1']);
    expect(exported.single.$2, tester.getRect(button), reason: "an iPad's share sheet points at the button");
    expect(played, isEmpty);
    expect(deleted, isEmpty);
    expect(find.byType(AlertDialog), findsNothing, reason: 'an export loses nothing, so nothing is asked');
  });

  testWidgets('says what became of an export, and offers none where nothing can take a file', (tester) async {
    await shown(tester, note: "Exported Rowan's game to a file.");
    expect(find.text("Exported Rowan's game to a file."), findsOneWidget);
    await shown(tester, exporting: false);
    expect(find.text('EXPORT'), findsNothing);
    expect(find.byKey(const ValueKey('saved-note')), findsNothing);
  });
}

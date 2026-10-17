import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/invite.dart';
import 'package:ai_world_flutter/src/screens/options_page.dart';
import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:ai_world_flutter/src/shell/ledger_shell.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const shared = GameSlot(slot: 'shared-42-worlds.example', seed: 42, kind: 'road', server: 'wss://worlds.example:8787');

  test('a shared world is handed on as the link the page hands out, and the app follows its own', () {
    final link = OptionsPage.inviteFor(shared)!;
    expect(Uri.parse(link).origin, 'https://worlds.example:8787');
    final (invite, why) = WorldInvite.parse(link);
    expect(why, isNull);
    expect([invite!.server, invite.seed, invite.kind], ['wss://worlds.example:8787', 42, 'road']);
    expect(OptionsPage.inviteFor(const GameSlot(slot: 'alone', seed: 3)), isNull, reason: 'a world on this phone has nobody to invite');
  });

  testWidgets('leaves, sees through, says which world, and copies the invite', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final calls = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: OptionsPage(slot: shared,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, controller: LedgerController(InputOwnerController((_) {})),
      leave: () => calls.add('leave'), seeThrough: () => calls.add('see-through')))));
    await tester.tap(find.byKey(const ValueKey('see-through')));
    await tester.tap(find.byKey(const ValueKey('save-and-leave')));
    expect(calls, ['see-through', 'leave']);
    expect(find.text('Seed 42 · road'), findsOneWidget);
    expect(find.text('wss://worlds.example:8787'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('invite')));
    await tester.pump();
    expect(copied, [OptionsPage.inviteFor(shared)]);
  });

  testWidgets('sets how loud the game is, and says so', (tester) async {
    await tester.binding.setSurfaceSize(const Size(328, 600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final set = <double>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: OptionsPage(slot: shared,
      tokens: LedgerTokens.all[LedgerTheme.stone]!, controller: LedgerController(InputOwnerController((_) {})),
      leave: () {}, seeThrough: () {}, volume: 0.6, setVolume: set.add))));
    expect(find.text('60%'), findsOneWidget);
    await tester.drag(find.byType(Slider), const Offset(-400, 0));
    expect(set, isNotEmpty);
    expect(set.last, 0, reason: 'all the way down is silence');
  });
}

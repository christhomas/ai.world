import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_world_flutter/src/host_contract.dart';
import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:ai_world_flutter/src/shell/ledger_shell.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:ai_world_flutter/src/shell/ledger_action_card.dart';

void main() {
  test('theme text pairs meet contrast 4.5 on their actual opaque surfaces', () {
    for (final t in LedgerTokens.all.values) {
      for (final pair in [[t.ink, t.surface], [t.dim, t.surface], [t.accent, t.surface],
        [t.actionInk, t.action], [t.pageInk, t.page], [t.pageDim, t.page]]) {
        expect(LedgerTokens.contrast(pair[0], pair[1]), greaterThanOrEqualTo(4.5));
      }
    }
  });
  test('owner input remains contract-valid and releases holds across every parked state', () {
    final sent = <Map<String, Object?>>[];
    final input = InputOwnerController(sent.add);
    final fixture = jsonDecode(File('../../shared/mobile/fixtures/session-v1.json').readAsStringSync()) as Map;
    final step = Map<String, dynamic>.from(fixture['step'] as Map);
    for (final owner in InputOwner.values) {
      input.focus(InputOwner.world);
      input.hold('stick', move: [1, 0], guard: true, run: true);
      expect((sent.last['held'] as Map)['guard'], true);
      input.focus(owner, busy: owner == InputOwner.world ? 'talking' : owner == InputOwner.book ? 'reading' : 'typing');
      input.action('interact');
      expect(sent.last['move'], [0, 0]);
      expect(sent.last['actions'], isEmpty);
      expect(sent.last['held'], {'guard': false, 'run': false});
      final payload = Map<String, dynamic>.from(step['payload'] as Map)..['input'] = sent.last;
      validateHostRequest({...step, 'payload': payload});
      input.focus(InputOwner.world);
      expect(sent.last['move'], [0, 0]);
    }
    input.hold('guard', guard: true);
    input.lifecycle(false);
    input.hold('late-pointer', move: [1, 0]);
    expect(sent.last['move'], [0, 0]);
    input.lifecycle(true);
    expect(sent.last['held'], {'guard': false, 'run': false});
  });

  for (final viewport in [const Size(844, 390), const Size(667, 320)]) {
    testWidgets('book geometry and persistent world at $viewport across themes/notch', (tester) async {
      await tester.binding.setSurfaceSize(viewport);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final sent = <Map<String, Object?>>[];
      final controller = LedgerController(InputOwnerController(sent.add));
      final worldKey = GlobalKey<_PersistentWorldState>();
      final world = _PersistentWorld(key: worldKey);
      Rect? composition;
      final pages = <String, LedgerPageBuilder>{
        'pack': (_, t) => ListView(children: [LedgerRow(key: const ValueKey('row'), name: 'Book', tokens: t, consequence: '1 carried', verb: 'LOOK')]),
        'options': (_, t) => LedgerThemePicker(controller: controller),
      };
      await tester.pumpWidget(MaterialApp(home: MediaQuery(data: MediaQueryData(size: viewport, padding: const EdgeInsets.only(left: 24, right: 16, bottom: 12)),
        child: Scaffold(body: LedgerShell(world: world, controller: controller, pages: pages, onWorldComposition: (rect) => composition = rect)))));
      final state = worldKey.currentState;
      expect(state, isNotNull);
      controller.open('pack'); await tester.pumpAndSettle();
      final initial = tester.getRect(find.byKey(const ValueKey('ledger-book')));
      expect(initial.width, 372);
      expect(initial.left, 24);
      expect(tester.getSize(find.byKey(const ValueKey('row'))).height, 44);
      expect(composition!.left, 396);
      for (final theme in LedgerTheme.values) {
        controller.selectTheme(theme); await tester.pumpAndSettle();
        expect(tester.getRect(find.byKey(const ValueKey('ledger-book'))), initial);
        expect(worldKey.currentState, same(state));
        for (final element in tester.widgetList<SizedBox>(find.byType(SizedBox))) {
          if (element.width == 44 && element.height != null) expect(element.height, greaterThanOrEqualTo(44));
        }
      }
      controller.open('options'); await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape); await tester.pumpAndSettle();
      expect(controller.route, 'pack');
      await tester.tap(find.text('Close')); await tester.pumpAndSettle();
      expect(controller.input.owner, InputOwner.world);
      expect(worldKey.currentState, same(state));
      expect(tester.takeException(), null);
    });
  }

  testWidgets('guard pointer cancellation and book/text transitions release held input', (tester) async {
    final sent = <Map<String, Object?>>[];
    final input = InputOwnerController(sent.add);
    final controller = LedgerController(input);
    final t = LedgerTokens.all[LedgerTheme.stone]!;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LedgerShell(
      world: const ColoredBox(color: Colors.green), controller: controller,
      pages: {'pack': (_, t) => const Text('Pack contents')},
      actionCard: LedgerActionCard(input: input, tokens: t),
      typingBuilder: (_) => const TextField(autofocus: true),
    ))));
    final gesture = await tester.startGesture(tester.getCenter(find.text('GUARD')), pointer: 1);
    expect((sent.last['held'] as Map)['guard'], true);
    final second = await tester.startGesture(tester.getCenter(find.text('GUARD')), pointer: 3);
    await gesture.cancel();
    expect((sent.last['held'] as Map)['guard'], true);
    await second.cancel();
    expect((sent.last['held'] as Map)['guard'], false);
    final held = await tester.startGesture(tester.getCenter(find.text('GUARD')), pointer: 2);
    controller.open('pack'); await tester.pumpAndSettle();
    expect((sent.last['held'] as Map)['guard'], false);
    await held.up();
    controller.typing(); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'hello');
    input.hold('late hardware', guard: true);
    expect(sent.last['move'], [0, 0]);
    expect((sent.last['held'] as Map)['guard'], false);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape); await tester.pumpAndSettle();
    expect(input.owner, InputOwner.book);
    controller.close(); await tester.pumpAndSettle();
    expect(input.owner, InputOwner.world);
    expect((sent.last['held'] as Map)['guard'], false);
  });

  testWidgets('hardware hold cannot leak into a focused book or text field', (tester) async {
    final sent = <Map<String, Object?>>[];
    final input = InputOwnerController(sent.add);
    final c = LedgerController(input);
    final world = Focus(autofocus: true, onKeyEvent: (_, event) {
      if (event.logicalKey == LogicalKeyboardKey.keyC) {
        if (event is KeyDownEvent) input.hold('hardware-c', guard: true);
        if (event is KeyUpEvent) input.release('hardware-c');
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }, child: const ColoredBox(color: Colors.green));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LedgerShell(world: world, controller: c,
      pages: {'pack': (_, t) => const Text('Read only')}, typingBuilder: (_) => const TextField(autofocus: true)))));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.keyC);
    expect((sent.last['held'] as Map)['guard'], true);
    c.open('pack'); await tester.pumpAndSettle();
    await tester.sendKeyUpEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    expect((sent.last['held'] as Map)['guard'], false);
    c.typing(); await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    expect((sent.last['held'] as Map)['guard'], false);
    c.close(); await tester.pumpAndSettle();
    expect(sent.last['move'], [0, 0]);
  });

  testWidgets('loading and recoverable error park world while reconnect callback stays live', (tester) async {
    final sent = <Map<String, Object?>>[];
    final c = LedgerController(InputOwnerController(sent.add));
    var reconnects = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LedgerShell(world: const SizedBox.expand(), controller: c,
      pages: const {}, surface: SessionSurface.recoverableError, message: 'Connection lost', onReconnect: () { reconnects++; }))));
    c.input.hold('key', move: [1, 0]);
    expect(sent.last['move'], [0, 0]);
    await tester.tap(find.text('Reconnect'));
    expect(reconnects, 1);
    expect(find.text('Connection lost'), findsOneWidget);
  });
}

class _PersistentWorld extends StatefulWidget {
  const _PersistentWorld({super.key});
  @override
  State<_PersistentWorld> createState() => _PersistentWorldState();
}
class _PersistentWorldState extends State<_PersistentWorld> {
  @override
  Widget build(BuildContext context) => const ColoredBox(color: Colors.green);
}

import 'dart:ui' as ui;

import 'package:ai_world_flutter/src/screens/conversation_band.dart';
import 'package:ai_world_flutter/src/shell/input_owner.dart';
import 'package:ai_world_flutter/src/shell/ledger_shell.dart';
import 'package:ai_world_flutter/src/shell/ledger_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Two columns, red then blue, as `src/mobile/portraits.ts` sends a face.
const twoColumns = <String, dynamic>{'w': 2, 'h': 2, 'colours': ['#ff0000', '#00f'],
  'still': [0, 0, 1, 2, 0, 1, 0, 1, 2, 1], 'talking': [0, 0, 2, 2, 1]};

Map<String, dynamic> shelf(int rows, {bool atChoices = true}) => {
  'speaker': 'Mira', 'emoji': '🧑', 'shown': 'What will it be?', 'done': true, 'page': 0, 'pages': 1,
  'choice': 1, 'atChoices': atChoices, 'waiting': null, 'face': 'v-12/baker/adult', 'heroFace': null,
  'choices': [
    {'label': 'Never mind', 'note': null, 'adjusts': false},
    {'label': 'Sell 1 pelt', 'note': '4g each', 'adjusts': true},
    for (var i = 2; i < rows; i++) {'label': 'Loaf $i', 'note': 'fills a belly', 'adjusts': false},
  ],
};

void main() {
  final t = LedgerTokens.all[LedgerTheme.stone]!;
  final calls = <String>[];
  Future<void> band(WidgetTester tester, Map<String, dynamic> talk, {Map<String, Map<String, dynamic>> faces = const {}}) async {
    calls.clear();
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Align(alignment: Alignment.bottomCenter,
      child: SizedBox(width: 492, child: ConversationBand(talk: talk, portraits: faces, tokens: t,
        onAdvance: () => calls.add('on'), onChoose: (row) => calls.add('choose $row'),
        onNudge: (row, dir) => calls.add('nudge $row:$dir')))))));
  }

  testWidgets('says who is talking with their own face, and a tap on the words goes on', (tester) async {
    await band(tester, shelf(2, atChoices: false), faces: {'v-12/baker/adult': twoColumns});
    expect(find.text('MIRA'), findsOneWidget);
    expect(find.text('What will it be?'), findsOneWidget);
    expect(find.byKey(const ValueKey('portrait-v-12/baker/adult')), findsOneWidget);
    expect(find.text('🧑'), findsNothing, reason: 'a drawn face, not the emoji');
    expect(find.byKey(const ValueKey('choice-0')), findsNothing, reason: 'no answers before the words are all there');
    await tester.tap(find.byKey(const ValueKey('talk-on')));
    expect(calls, ['on']);
  });

  testWidgets('somebody with no drawn face keeps the emoji the game has always given them', (tester) async {
    await band(tester, {...shelf(2, atChoices: false), 'face': null});
    expect(find.text('🧑'), findsOneWidget);
  });

  testWidgets('answers are their own list: a tap takes a row, and − and + change a number in place', (tester) async {
    await band(tester, shelf(2), faces: {'v-12/baker/adult': twoColumns});
    await tester.tap(find.byKey(const ValueKey('choice-0')));
    await tester.tap(find.byKey(const ValueKey('nudge-1-1')));
    await tester.tap(find.byKey(const ValueKey('nudge-1--1')));
    expect(calls, ['choose 0', 'nudge 1:1', 'nudge 1:-1']);
    expect(find.byKey(const ValueKey('nudge-0-1')), findsNothing, reason: 'a row with no number has no − or +');
    expect(find.text('4g each'), findsOneWidget);
    expect(find.text('▶'), findsOneWidget);
  });

  testWidgets('a seventeen-row shelf scrolls under the words without pushing them away', (tester) async {
    await band(tester, shelf(17));
    final words = tester.getRect(find.text('What will it be?'));
    expect(tester.getSize(find.byType(ListView)).height, lessThanOrEqualTo(44 * 4.5));
    await tester.scrollUntilVisible(find.byKey(const ValueKey('choice-16')), 44, scrollable: find.byType(Scrollable).last);
    // all the way into view, as a thumb would bring it, rather than half of it under the edge
    await tester.ensureVisible(find.byKey(const ValueKey('choice-16')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('choice-16')));
    expect(calls, ['choose 16']);
    expect(tester.getRect(find.text('What will it be?')), words);
  });

  test('a face is drawn whole, rectangle by rectangle, with no smoothing between them', () async {
    expect(PortraitPainter.colourOf('#00f'), const Color(0xff0000ff));
    expect(PortraitPainter.colourOf('#a1b2c3'), const Color(0xffa1b2c3));
    Future<List<int>> drawn({bool talking = false}) async {
      final recorder = ui.PictureRecorder();
      PortraitPainter(twoColumns, talking: talking).paint(Canvas(recorder), const Size(4, 4));
      final image = await recorder.endRecording().toImage(4, 4);
      final bytes = (await image.toByteData())!;
      // the top row's four pixels, as 0xRRGGBBAA
      return [for (var x = 0; x < 4; x++) bytes.getUint32(x * 4)];
    }
    expect(await drawn(), [0xff0000ff, 0xff0000ff, 0x0000ffff, 0x0000ffff]);
    expect(await drawn(talking: true), [0x0000ffff, 0x0000ffff, 0x0000ffff, 0x0000ffff]);
  });

  testWidgets('while somebody talks the world is parked, and the words still take a thumb', (tester) async {
    final sent = <Map<String, Object?>>[];
    final c = LedgerController(InputOwnerController(sent.add));
    var on = 0;
    await tester.binding.setSurfaceSize(const Size(844, 390));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LedgerShell(world: const SizedBox.expand(), controller: c, pages: const {},
      conversation: ConversationBand(talk: shelf(2, atChoices: false), portraits: const {}, tokens: t,
        onAdvance: () => on++, onChoose: (_) {}, onNudge: (_, _) {})))));
    c.talking(true);
    await tester.pump();
    c.input.hold('stick', move: [0, 1]);
    expect(sent.last['busy'], 'talking');
    expect(sent.last['move'], [0, 0], reason: 'a thumb on the stick cannot run down the answers');
    expect(find.text('CONTROLS PARKED'), findsNothing, reason: 'the words are what has the controls');
    await tester.tap(find.byKey(const ValueKey('talk-on')));
    expect(on, 1);
    c.talking(false);
    expect(c.input.acceptsWorld, isTrue);
  });
}

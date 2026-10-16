import 'package:flutter/material.dart';

import '../shell/ledger_tokens.dart';

/// A face the game painted (`src/mobile/portraits.ts`): the rectangles the page's canvas is filled
/// with, scaled whole and never smoothed, so a face in the app is the face on the page.
class PortraitPainter extends CustomPainter {
  PortraitPainter(this.portrait, {this.talking = false});
  final Map<String, dynamic> portrait;
  final bool talking;

  static Color colourOf(String hex) {
    var digits = hex.startsWith('#') ? hex.substring(1) : hex;
    if (digits.length == 3) digits = digits.split('').map((d) => '$d$d').join();
    return Color(0xff000000 | int.parse(digits, radix: 16));
  }

  @override
  void paint(Canvas canvas, Size size) {
    final w = (portrait['w'] as num).toDouble(), h = (portrait['h'] as num).toDouble();
    final colours = [for (final c in portrait['colours'] as List) colourOf('$c')];
    final fills = (portrait[talking ? 'talking' : 'still'] as List).cast<num>();
    canvas.save();
    canvas.scale(size.width / w, size.height / h);
    final brush = Paint()..isAntiAlias = false;
    for (var i = 0; i + 4 < fills.length; i += 5) {
      brush.color = colours[fills[i + 4].toInt()];
      canvas.drawRect(Rect.fromLTWH(fills[i].toDouble(), fills[i + 1].toDouble(), fills[i + 2].toDouble(), fills[i + 3].toDouble()), brush);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(PortraitPainter oldDelegate) => oldDelegate.portrait != portrait || oldDelegate.talking != talking;
}

/// What is being said, and the answers to it (#574; design/mobile/README.md, "A shop").
///
/// The words stay on the glass, in a band across the world: the speaker's own portrait at 72×84 in
/// a 2px `#8fa0ff` border, their name in gold, the line at 14.5px. The answers are a separate list
/// of 44px rows under it that scrolls on its own, which is what lets a seventeen-item shelf fit on a
/// phone. Every shop, quest, hire and shrine in the game speaks through this, because they are all
/// conversations in `src/game/interact`; the rows, prices and what a row does are the game's.
class ConversationBand extends StatelessWidget {
  const ConversationBand({super.key, required this.talk, required this.portraits, required this.tokens,
    required this.onAdvance, required this.onChoose, required this.onNudge});
  /// The engine's `conversation` model.
  final Map<String, dynamic> talk;
  /// Every face the engine has sent this session, by key.
  final Map<String, Map<String, dynamic>> portraits;
  final LedgerTokens tokens;
  final VoidCallback onAdvance;
  final ValueChanged<int> onChoose;
  final void Function(int row, int dir) onNudge;

  static const glass = Color(0xb8060916), glassDeep = Color(0xe6060916);
  static const frame = Color(0xff8fa0ff), gold = Color(0xffffd76a), words = Color(0xffeef2ff);
  /// The page's portrait grid, 48×56, scaled half again: whole device pixels at a phone's density.
  static const face = Size(72, 84);

  Widget _face(String? key, String emoji, {bool talking = false, bool back = false}) {
    final picture = key == null ? null : portraits[key];
    return Opacity(opacity: back ? 0.55 : 1, child: Container(
      width: face.width + 4, height: face.height + 4,
      decoration: BoxDecoration(border: Border.all(color: frame, width: 2), color: glassDeep),
      child: picture == null
        ? Center(child: Text(emoji, style: const TextStyle(fontSize: 34)))
        : CustomPaint(key: ValueKey('portrait-$key'), size: face, painter: PortraitPainter(picture, talking: talking))));
  }

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    final choices = (talk['choices'] as List? ?? const []).cast<Map>();
    final shown = '${talk['shown'] ?? ''}';
    final arriving = talk['done'] != true;
    final waiting = talk['waiting'] as String?;
    final speaker = '${talk['speaker'] ?? ''}';
    final lit = (talk['choice'] as num?)?.toInt() ?? 0;
    final speech = Semantics(button: true, label: '$speaker says: $shown. Tap to go on', excludeSemantics: true, onTap: onAdvance,
      child: GestureDetector(key: const ValueKey('talk-on'), behavior: HitTestBehavior.opaque, onTap: onAdvance,
        child: DecoratedBox(
          decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [glass, glassDeep])),
          child: Padding(padding: const EdgeInsets.all(10), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            // the mouth moves while the words are still arriving, as the page's does
            _face(talk['face'] as String?, '${talk['emoji'] ?? ''}', talking: arriving && (shown.length ~/ 3).isOdd),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(speaker.toUpperCase(), style: t.numbers(10, gold, spacing: 2)),
              const SizedBox(height: 4),
              ConstrainedBox(constraints: const BoxConstraints(maxHeight: 66),
                child: SingleChildScrollView(reverse: true, child: Text(shown, style: t.face(14.5, words).copyWith(height: 1.5)))),
              if (waiting != null) Text(waiting.toUpperCase(), style: t.numbers(9, gold)),
              if (talk['atChoices'] != true) Align(alignment: Alignment.centerRight,
                child: Text(arriving ? '…' : 'ON ▸', style: t.numbers(11, gold))),
            ])),
            if (talk['heroFace'] != null) ...[
              const SizedBox(width: 12),
              // whoever is not talking steps back
              _face(talk['heroFace'] as String?, '', back: true),
            ],
          ])))));
    if (talk['atChoices'] != true || choices.isEmpty) return speech;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      speech,
      ConstrainedBox(constraints: const BoxConstraints(maxHeight: 44 * 4.5), child: ColoredBox(color: t.page, child: ListView(
        shrinkWrap: true, padding: const EdgeInsets.only(right: 12),
        children: [for (var i = 0; i < choices.length; i++) _row(i, Map<String, dynamic>.from(choices[i]), i == lit)]))),
    ]);
  }

  Widget _row(int i, Map<String, dynamic> choice, bool lit) {
    final t = tokens;
    final note = choice['note'] as String?;
    Widget step(String sign, int dir) => Semantics(button: true, label: '${dir < 0 ? 'Fewer' : 'More'}: ${choice['label']}',
      excludeSemantics: true, onTap: () => onNudge(i, dir),
      child: SizedBox(width: 44, height: 44, child: InkWell(key: ValueKey('nudge-$i-$dir'), onTap: () => onNudge(i, dir),
        child: Center(child: Text(sign, style: t.numbers(17, t.pageInk, weight: FontWeight.w600, spacing: 0))))));
    return SizedBox(height: 44, child: DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule))),
      child: Row(children: [
        Expanded(child: Semantics(button: true, label: '${choice['label']}${note == null ? '' : ', $note'}', excludeSemantics: true,
          onTap: () => onChoose(i),
          child: InkWell(key: ValueKey('choice-$i'), onTap: () => onChoose(i), child: Padding(padding: const EdgeInsets.only(left: 12),
            child: Row(children: [
              SizedBox(width: 14, child: Text(lit ? '▶' : '', style: t.numbers(10, t.pageInk, spacing: 0))),
              Flexible(flex: 3, child: Text('${choice['label']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: t.face(14.5, t.pageInk))),
              if (note != null) ...[
                const SizedBox(width: 8),
                Flexible(flex: 2, child: Text(note, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.numbers(11, t.pageDim, spacing: 0))),
              ],
            ]))))),
        if (choice['adjusts'] == true) ...[step('−', -1), step('+', 1)],
      ])));
  }
}

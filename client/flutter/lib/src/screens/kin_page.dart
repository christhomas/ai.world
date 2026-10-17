import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../shell/ledger_tokens.dart';

/// A village's descent, as the clerk at the town hall unrolls it once he is paid (#575): the
/// `kin` model `src/game/kin-view.ts` makes for the page's lineage panel, drawn as the page draws
/// it — people where the layout puts them, an elbow from each parent to each child — and moved about
/// with the hands, as the map is. Tapping somebody shows what the clerk has on them.
class KinPage extends StatefulWidget {
  const KinPage({super.key, required this.kin, required this.tokens});
  /// The engine's `kin` model.
  final Map<String, dynamic> kin;
  final LedgerTokens tokens;

  /// Tree units to pixels before any zoom: a person is 0.86 by 0.42 of one, and a generation 1.5.
  static const unit = 110.0;
  static const card = Size(0.86 * unit, 0.42 * unit), row = 1.5 * unit;

  @override
  State<KinPage> createState() => _KinPageState();
}

class _KinPageState extends State<KinPage> {
  final _view = TransformationController();
  String? _chosen;
  Object? _framed;

  @override
  void didUpdateWidget(KinPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // laid out again, perhaps another village's: nobody is chosen on a new unrolling
    if (widget.kin['unrolled'] != oldWidget.kin['unrolled']) _chosen = null;
  }

  @override
  void dispose() {
    _view.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final kin = widget.kin;
    final people = (kin['people'] as List? ?? const []).cast<Map>();
    final chosen = people.where((p) => p['id'] == _chosen).firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('THE DESCENT OF ${'${kin['village'] ?? ''}'.toUpperCase()}', style: t.face(17, t.pageInk, weight: FontWeight.w500, spacing: 3)),
          const SizedBox(height: 4),
          Text('${kin['headline'] ?? ''}', style: t.numbers(11, t.pageDim, spacing: 0)),
        ]))),
      Expanded(child: people.isEmpty
        ? Padding(padding: const EdgeInsets.all(12), child: Text('The clerk has an empty book.', style: t.face(14.5, t.pageDim)))
        : LayoutBuilder(builder: (context, room) => _tree(people, room.biggest))),
      // the same height whoever is chosen, so the tree does not move under the finger that chose them
      SizedBox(height: 96, child: DecoratedBox(decoration: BoxDecoration(border: Border(top: BorderSide(color: t.rule, width: 1))),
        child: SingleChildScrollView(key: const ValueKey('kin-record'), padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
          child: chosen == null
            ? Text('Tap somebody to see what the clerk has on them.', style: t.numbers(11, t.pageDim, spacing: 0))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final (i, line) in (chosen['record'] as List? ?? const []).indexed)
                  Text('$line', style: i == 0 ? t.face(14.5, t.pageInk, weight: FontWeight.w500) : t.numbers(11, t.pageDim, spacing: 0)),
              ])))),
    ]);
  }

  Widget _tree(List<Map> people, Size room) {
    final xs = people.map((p) => (p['x'] as num).toDouble()), ys = people.map((p) => (p['y'] as num).toDouble());
    final left = xs.reduce(math.min) - 1, top = ys.reduce(math.min);
    final width = (xs.reduce(math.max) - left + 1) * KinPage.unit;
    final height = (ys.reduce(math.max) - top) * KinPage.row + KinPage.card.height + KinPage.unit;
    Offset at(Map p) => Offset(((p['x'] as num) - left) * KinPage.unit,
      ((p['y'] as num) - top) * KinPage.row + KinPage.unit / 2 + KinPage.card.height / 2);
    // the whole tree on the screen, which is how it should first appear: once for each unrolling
    if (_framed != widget.kin['unrolled']) {
      _framed = widget.kin['unrolled'];
      final s = math.min(room.width / width, room.height / height).clamp(0.2, 1.0);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _view.value = Matrix4.diagonal3Values(s, s, 1)..setTranslationRaw((room.width - width * s) / 2, math.max(0.0, (room.height - height * s) / 2), 0);
      });
    }
    final where = {for (final p in people) '${p['id']}': at(p)};
    return ClipRect(child: InteractiveViewer(transformationController: _view, constrained: false, minScale: 0.2, maxScale: 3,
      boundaryMargin: EdgeInsets.all(math.max(room.width, room.height)),
      child: SizedBox(width: width, height: height, child: Stack(children: [
        Positioned.fill(child: CustomPaint(painter: _Ties(where, (widget.kin['ties'] as List? ?? const []).cast<Map>()))),
        for (final p in people)
          Positioned(left: where['${p['id']}']!.dx - KinPage.card.width / 2, top: where['${p['id']}']!.dy - KinPage.card.height / 2,
            width: KinPage.card.width, height: KinPage.card.height,
            child: _Person(key: ValueKey('kin-${p['id']}'), person: p, chosen: p['id'] == _chosen,
              onTap: () => setState(() => _chosen = p['id'] == _chosen ? null : '${p['id']}'))),
      ]))));
  }
}

/// The living, the buried and the remembered, told apart at a glance as the page's panel tells them.
const _paper = {'living': Color(0xfff8f1df), 'buried': Color(0xffd8c9aa), 'remembered': Color(0xffc1b493)};

class _Person extends StatelessWidget {
  const _Person({super.key, required this.person, required this.chosen, required this.onTap});
  final Map person;
  final bool chosen;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = '${person['name']}'.split(' ');
    final remembered = person['standing'] == 'remembered';
    final ink = remembered ? const Color(0xff6f624c) : const Color(0xff2a2418);
    const text = TextStyle(fontSize: 11, height: 1.15, fontFamily: 'monospace');
    return Semantics(button: true, selected: chosen, label: '${person['name']}, ${person['standing']}', excludeSemantics: true, onTap: onTap,
      child: GestureDetector(onTap: onTap, child: DecoratedBox(
        decoration: BoxDecoration(color: _paper[person['standing']] ?? _paper['living'], borderRadius: BorderRadius.circular(9),
          border: chosen ? Border.all(color: const Color(0xff8a2a14), width: 3) : null),
        child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(name.first, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.copyWith(color: ink)),
          if (name.length > 1) Text(name.skip(1).join(' '), maxLines: 1, overflow: TextOverflow.ellipsis, style: text.copyWith(color: ink)),
        ])))));
  }
}

/// An elbow from each parent down to each child: half way down, across, and down again, which is
/// how a family tree has been drawn since long before there was a screen to draw it on.
class _Ties extends CustomPainter {
  _Ties(this.where, this.ties);
  final Map<String, Offset> where;
  final List<Map> ties;

  @override
  void paint(Canvas canvas, Size size) {
    final pen = Paint()..color = const Color(0x616b3f1d)..strokeWidth = 2..style = PaintingStyle.stroke;
    for (final tie in ties) {
      final child = where['${tie['child']}'], parent = where['${tie['parent']}'];
      if (child == null || parent == null) continue;
      final from = parent.dy + KinPage.card.height / 2, to = child.dy - KinPage.card.height / 2, mid = (from + to) / 2;
      canvas.drawPath(Path()
        ..moveTo(parent.dx, from)
        ..lineTo(parent.dx, mid)
        ..lineTo(child.dx, mid)
        ..lineTo(child.dx, to), pen);
    }
  }

  @override
  bool shouldRepaint(_Ties old) => old.where != where || old.ties != ties;
}

import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The drawn controls of `src/ui/glyphs.ts`, copied rather than redrawn (design/mobile/README.md):
/// one 24×24 grid, one 2px round stroke in whatever colour the control is set in, filled only where
/// the source fills. `ledger_glyphs_test.dart` holds these to the source, part by part.
enum LedgerGlyph { map, pack, book, sliders, turnLeft, turnRight, more, close, sword, shield, bow }

/// One mark on the grid: an SVG path, a rounded rectangle, or a circle.
sealed class GlyphPart {
  const GlyphPart({this.filled = false, this.strokeWidth = 2});
  final bool filled;
  final double strokeWidth;
  Path toPath();
}

final class GlyphPath extends GlyphPart {
  const GlyphPath(this.d, {super.filled, super.strokeWidth});
  final String d;
  @override
  Path toPath() => parseSvgPath(d);
}

final class GlyphRect extends GlyphPart {
  const GlyphRect(this.x, this.y, this.width, this.height, this.radius, {super.filled});
  final double x, y, width, height, radius;
  @override
  Path toPath() => Path()..addRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, y, width, height), Radius.circular(radius)));
}

final class GlyphCircle extends GlyphPart {
  const GlyphCircle(this.cx, this.cy, this.r, {super.filled});
  final double cx, cy, r;
  @override
  Path toPath() => Path()..addOval(Rect.fromCircle(center: Offset(cx, cy), radius: r));
}

/// Verbatim from `src/ui/glyphs.ts`.
const ledgerGlyphs = <LedgerGlyph, List<GlyphPart>>{
  LedgerGlyph.map: [GlyphPath('M3 6.5 9 3.5l6 3 6-3v14l-6 3-6-3-6 3z'), GlyphPath('M9 3.5v14M15 6.5v14')],
  LedgerGlyph.pack: [
    GlyphRect(4.5, 7, 15, 14, 3.5), GlyphPath('M10 7V5.6a2 2 0 0 1 4 0V7'), GlyphPath('M4.5 13h15'), GlyphPath('M10.5 17h3'),
  ],
  LedgerGlyph.book: [
    GlyphPath('M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z'), GlyphPath('M12 6.5v13'),
  ],
  LedgerGlyph.sliders: [
    GlyphPath('M3 6h11M18 6h3M3 12h4M11 12h10M3 18h13M20 18h1'),
    GlyphCircle(16, 6, 2, filled: true), GlyphCircle(9, 12, 2, filled: true), GlyphCircle(18, 18, 2, filled: true),
  ],
  LedgerGlyph.turnLeft: [GlyphPath('M20 14A8 8 0 0 0 4 14'), GlyphPath('M1.5 11.5 4 14l2.5-2.5')],
  LedgerGlyph.turnRight: [GlyphPath('M4 14A8 8 0 0 1 20 14'), GlyphPath('M17.5 11.5 20 14l2.5-2.5')],
  LedgerGlyph.more: [GlyphCircle(5, 12, 1.8, filled: true), GlyphCircle(12, 12, 1.8, filled: true), GlyphCircle(19, 12, 1.8, filled: true)],
  LedgerGlyph.close: [GlyphPath('M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5')],
  LedgerGlyph.sword: [
    GlyphPath('M20.8 3.2 13.1 14.1 9.9 10.9z', filled: true), GlyphPath('M8.5 10.7 13.4 15.5'), GlyphPath('M10.9 13.1 8.8 15.2'),
    GlyphCircle(7.7, 16.3, 1.4),
  ],
  LedgerGlyph.shield: [GlyphPath('M12 3.2 19.5 6v6c0 4.6-3.2 7.9-7.5 8.9C7.7 19.9 4.5 16.6 4.5 12V6z')],
  LedgerGlyph.bow: [
    GlyphPath('M8 3a9.5 9.5 0 0 1 0 18'), GlyphPath('M8 3v18', strokeWidth: 1), GlyphPath('M6.5 12h12'), GlyphPath('m14.5 8.5 4 3.5-4 3.5'),
  ],
};

/// A glyph at any size, in one colour, as crisp as the screen it is on.
class LedgerIcon extends StatelessWidget {
  const LedgerIcon(this.glyph, {super.key, this.size = 21, required this.color, this.label});
  final LedgerGlyph glyph;
  final double size;
  final Color color;
  final String? label;
  @override
  Widget build(BuildContext context) => Semantics(label: label, excludeSemantics: label == null,
    child: SizedBox.square(dimension: size, child: CustomPaint(painter: _GlyphPainter(glyph, color))));
}

class _GlyphPainter extends CustomPainter {
  _GlyphPainter(this.glyph, this.color);
  final LedgerGlyph glyph;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    for (final part in ledgerGlyphs[glyph]!) {
      canvas.drawPath(part.toPath(), Paint()
        ..color = color
        ..style = part.filled ? PaintingStyle.fill : PaintingStyle.stroke
        ..strokeWidth = part.strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round);
    }
  }
  @override
  bool shouldRepaint(_GlyphPainter old) => old.glyph != glyph || old.color != color;
}

/// The SVG path grammar the glyphs use: moves, lines, horizontal and vertical runs, cubic curves and
/// elliptical arcs, absolute and relative, with implicit repeats; and closing.
Path parseSvgPath(String d) {
  // every letter is a command, so one this reader does not know is refused rather than skipped
  final tokens = RegExp(r'-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z]').allMatches(d).map((m) => m.group(0)!).toList();
  final path = Path();
  var at = 0;
  var command = '';
  var x = 0.0, y = 0.0, startX = 0.0, startY = 0.0;
  double number() {
    if (at >= tokens.length) throw FormatException('Path ends mid-command: $d');
    return double.parse(tokens[at++]);
  }
  bool flag() => number() != 0;
  bool numberNext() => at < tokens.length && !RegExp(r'^[A-Za-z]$').hasMatch(tokens[at]);
  while (at < tokens.length) {
    if (!numberNext()) command = tokens[at++];
    final relative = command == command.toLowerCase();
    final ox = relative ? x : 0.0, oy = relative ? y : 0.0;
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + number(); y = oy + number();
        path.moveTo(x, y);
        startX = x; startY = y;
        // further pairs after a move are lines, in the same sense
        command = relative ? 'l' : 'L';
      case 'L':
        x = ox + number(); y = oy + number();
        path.lineTo(x, y);
      case 'H':
        x = ox + number();
        path.lineTo(x, y);
      case 'V':
        y = oy + number();
        path.lineTo(x, y);
      case 'C':
        final c1x = ox + number(), c1y = oy + number(), c2x = ox + number(), c2y = oy + number();
        x = ox + number(); y = oy + number();
        path.cubicTo(c1x, c1y, c2x, c2y, x, y);
      case 'A':
        final rx = number(), ry = number(), rotation = number(), large = flag(), sweep = flag();
        x = ox + number(); y = oy + number();
        path.arcToPoint(Offset(x, y), radius: Radius.elliptical(rx, ry), rotation: rotation,
          largeArc: large, clockwise: sweep);
      case 'Z':
        path.close();
        x = startX; y = startY;
      default:
        throw FormatException('Unsupported path command $command in $d');
    }
  }
  return path;
}

/// The bounds a glyph's marks cover on its grid, for the tests and anyone sizing one.
Rect glyphBounds(LedgerGlyph glyph) => ledgerGlyphs[glyph]!
  .map((part) => part.toPath().getBounds())
  .reduce((a, b) => Rect.fromLTRB(math.min(a.left, b.left), math.min(a.top, b.top), math.max(a.right, b.right), math.max(a.bottom, b.bottom)));

import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The walk ring (design/mobile/README.md, "Thumb ring"): a 104px box holding the hero's health
/// as an outer arc and his breath as an inner one, both from twelve o'clock, around the nub a
/// thumb pushes. It is drawn where the thumb lands; its home is only where it rests.
class LedgerThumbRing extends StatelessWidget {
  const LedgerThumbRing({super.key, required this.health, required this.breath, this.nub = Offset.zero,
    this.healthColour = const Color(0xff7be08f), this.breathColour = const Color(0xff7fb8ff), this.label});
  /// Shares of a full bar, nought to one.
  final double health, breath;
  /// Where the nub has been pushed, in logical pixels from the centre.
  final Offset nub;
  final Color healthColour, breathColour;
  final String? label;
  static const double box = 104;

  @override
  Widget build(BuildContext context) => Semantics(label: label ?? 'health ${(health * 100).round()}%, breath ${(breath * 100).round()}%',
    child: SizedBox.square(dimension: box, child: CustomPaint(painter: _RingPainter(
      health.clamp(0, 1).toDouble(), breath.clamp(0, 1).toDouble(), nub, healthColour, breathColour))));
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.health, this.breath, this.nub, this.healthColour, this.breathColour);
  final double health, breath;
  final Offset nub;
  final Color healthColour, breathColour;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final track = Paint()..color = const Color(0x570a0d1c);
    final trackRule = Paint()
      ..color = const Color(0x24ffffff)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawCircle(centre, 46, track);
    canvas.drawCircle(centre, 46, trackRule);
    void arc(double radius, double width, double share, Color colour) {
      if (share <= 0) return;
      canvas.drawArc(Rect.fromCircle(center: centre, radius: radius), -math.pi / 2, share * 2 * math.pi, false, Paint()
        ..color = colour
        ..style = PaintingStyle.stroke
        ..strokeWidth = width);
    }
    arc(46, 5, health, healthColour);
    arc(37, 3, breath, breathColour);
    final at = centre + nub;
    canvas.drawCircle(at, 20, Paint()..color = const Color(0x33d6ddff));
    canvas.drawCircle(at, 20, Paint()
      ..color = const Color(0x57d6ddff)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.health != health || old.breath != breath || old.nub != nub
    || old.healthColour != healthColour || old.breathColour != breathColour;
}

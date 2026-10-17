import 'package:flutter/widgets.dart';

import 'ledger_tokens.dart';

/// Whoever is in reach, marked in the world (#571; design/mobile/README.md, "somebody in reach"): a
/// 54×16 gold ellipse at their feet and their name in 10px mono over their head, where the game says
/// they stand on the screen (`src/render/in-reach.ts`). It takes no touches.
class SubjectRing extends StatelessWidget {
  const SubjectRing({super.key, required this.subject, required this.tokens});
  /// The engine's `subject`: a `name`, and `feet` and `head` each an `x` and a `y`; null for nobody.
  final Map? subject;
  final LedgerTokens tokens;

  static const gold = Color(0xffe0b84a);

  static Offset? _point(Object? at) =>
    at is Map && at['x'] is num && at['y'] is num ? Offset((at['x'] as num).toDouble(), (at['y'] as num).toDouble()) : null;

  @override
  Widget build(BuildContext context) {
    final feet = _point(subject?['feet']), head = _point(subject?['head']);
    if (feet == null || head == null) return const SizedBox.shrink();
    return IgnorePointer(child: Stack(fit: StackFit.expand, children: [
      Positioned(key: const ValueKey('subject-ring'), left: feet.dx - 27, top: feet.dy - 8, width: 54, height: 16,
        child: const CustomPaint(painter: _Ring())),
      Positioned(key: const ValueKey('subject-name'), left: head.dx, top: head.dy,
        child: FractionalTranslation(translation: const Offset(-0.5, -1),
          child: Text('${subject!['name']}', maxLines: 1, style: tokens.numbers(10, gold, spacing: 1)))),
    ]));
  }
}

class _Ring extends CustomPainter {
  const _Ring();

  @override
  void paint(Canvas canvas, Size size) => canvas.drawOval(Offset.zero & size,
    Paint()..color = SubjectRing.gold..style = PaintingStyle.stroke..strokeWidth = 2);

  @override
  bool shouldRepaint(_Ring old) => false;
}

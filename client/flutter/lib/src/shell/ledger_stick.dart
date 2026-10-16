import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import 'input_owner.dart';
import 'ledger_thumb_ring.dart';

/// The walk stick (design/mobile/README.md, "Walk"; #571).
///
/// A thumb put down anywhere in the field draws the ring where it lands, except in the tab gutter
/// (x 0–44 from y 62 down), so a steering thumb can never open the pack. Leaning the nub sends the
/// lean as the contract's `move` (right and forward, each -1 to 1, the full 54px range being 1); the
/// engine walks it in the page stick's eight sectors with the page stick's dead zone, so a thumb here
/// and a thumb on the page are the same press. Lifting it, or losing it, lets go.
class LedgerStick extends StatefulWidget {
  const LedgerStick({super.key, required this.input, this.health = 1, this.breath = 1});
  final InputOwnerController input;
  /// Shares of a full bar, shown on the ring.
  final double health, breath;
  /// How far the nub travels, in logical pixels: a full lean.
  static const double range = 54;
  static const double gutter = 44, gutterTop = 62;

  @override
  State<LedgerStick> createState() => _LedgerStickState();
}

class _LedgerStickState extends State<LedgerStick> {
  int? _pointer;
  Offset? _origin;
  Offset _nub = Offset.zero;

  Object get _token => ('stick', _pointer);

  void _down(PointerDownEvent event) {
    if (_pointer != null || !widget.input.acceptsWorld) return;
    final at = event.localPosition;
    if (at.dx < LedgerStick.gutter && at.dy > LedgerStick.gutterTop) return;
    setState(() { _pointer = event.pointer; _origin = at; _nub = Offset.zero; });
  }

  void _move(PointerMoveEvent event) {
    if (event.pointer != _pointer || _origin == null) return;
    var lean = event.localPosition - _origin!;
    if (lean.distance > LedgerStick.range) lean = lean / lean.distance * LedgerStick.range;
    setState(() => _nub = lean);
    widget.input.hold(_token, move: [
      (lean.dx / LedgerStick.range).clamp(-1.0, 1.0),
      (-lean.dy / LedgerStick.range).clamp(-1.0, 1.0),
    ]);
  }

  void _up(PointerEvent event) {
    if (event.pointer != _pointer) return;
    widget.input.release(_token);
    setState(() { _pointer = null; _origin = null; _nub = Offset.zero; });
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, size) {
    const half = LedgerThumbRing.box / 2;
    // resting at its home, bottom-left above the tabs' end, until a thumb puts it somewhere
    final centre = _origin ?? Offset(24 + half, math.max(half, size.maxHeight - 20 - half));
    return Semantics(label: 'Walk: put a thumb down and lean it', child: Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: _down, onPointerMove: _move, onPointerUp: _up, onPointerCancel: _up,
      child: Stack(fit: StackFit.expand, children: [
        Positioned(left: centre.dx - half, top: centre.dy - half,
          child: IgnorePointer(child: LedgerThumbRing(health: widget.health, breath: widget.breath, nub: _nub))),
      ])));
  });
}

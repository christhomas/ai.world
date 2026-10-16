import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import 'input_owner.dart';
import 'ledger_thumb_ring.dart';

/// The walk stick and the camera (design/mobile/README.md, "Walk"; #571).
///
/// A thumb put down anywhere in the field draws the ring where it lands, except in the tab gutter
/// (x 0–44 from y 62 down), so a steering thumb can never open the pack. Leaning the nub sends the
/// lean as the contract's `move` (right and forward, each -1 to 1, the full 54px range being 1); the
/// engine walks it in the page stick's eight sectors with the page stick's dead zone, so a thumb here
/// and a thumb on the page are the same press. Lifting it, or losing it, lets go.
///
/// The camera is a gesture, as it is on the page (`src/ui/twist.ts`): two fingers on the world. A
/// second finger put down before the first has leaned past the dead zone makes the two of them the
/// camera instead of a walk. Twisting them holds the turn for as long as the hand keeps turning,
/// with the page's thresholds, and is sent as `look[0]`; pinching them is the page's pinch, the wheel
/// distance `onZoom` is given. A thumb already steering keeps the stick, whatever else lands.
class LedgerStick extends StatefulWidget {
  const LedgerStick({super.key, required this.input, this.health = 1, this.breath = 1, this.onZoom});
  final InputOwnerController input;
  /// Shares of a full bar, shown on the ring.
  final double health, breath;
  /// A pinch, as the wheel distance a page's pinch turns into: positive is out.
  final ValueChanged<double>? onZoom;
  /// How far the nub travels, in logical pixels: a full lean.
  static const double range = 54;
  /// Inside this, a thumb has not started to steer (the design's 14px dead zone).
  static const double deadZone = 14;
  static const double gutter = 44, gutterTop = 62;
  /// How far two fingers must turn, in radians between moves, to start turning, and to keep on.
  static const double twist = 0.05, still = 0.006;
  /// The wheel a pixel of pinch is worth, as on the page (`Input.PINCH_WHEEL_PER_PIXEL`).
  static const double wheelPerPixel = 2;

  @override
  State<LedgerStick> createState() => _LedgerStickState();
}

class _LedgerStickState extends State<LedgerStick> {
  int? _pointer;
  Offset? _origin;
  Offset _nub = Offset.zero;
  /// The two fingers turning the camera, where each is now.
  final Map<int, Offset> _camera = {};
  double? _was, _gap;
  int _turning = 0;
  double _pinch = 0;
  Timer? _flush;

  Object get _token => ('stick', _pointer);
  static const Object _cameraToken = 'camera';

  void _down(PointerDownEvent event) {
    if (!widget.input.acceptsWorld) return;
    final at = event.localPosition;
    if (at.dx < LedgerStick.gutter && at.dy > LedgerStick.gutterTop) return;
    if (_pointer == null && _camera.isEmpty) {
      setState(() { _pointer = event.pointer; _origin = at; _nub = Offset.zero; });
      return;
    }
    if (_pointer != null) {
      // a thumb already steering keeps the stick; one that has not is half of a camera gesture
      if (_nub.distance >= LedgerStick.deadZone) return;
      _camera[_pointer!] = _origin! + _nub;
      widget.input.release(_token);
      setState(() { _pointer = null; _origin = null; _nub = Offset.zero; });
    }
    if (_camera.length >= 2) return;
    _camera[event.pointer] = at;
    _was = null;
    _gap = null;
  }

  void _move(PointerMoveEvent event) {
    if (_camera.containsKey(event.pointer)) {
      _camera[event.pointer] = event.localPosition;
      _turn();
      return;
    }
    if (event.pointer != _pointer || _origin == null) return;
    var lean = event.localPosition - _origin!;
    if (lean.distance > LedgerStick.range) lean = lean / lean.distance * LedgerStick.range;
    setState(() => _nub = lean);
    widget.input.hold(_token, move: [
      (lean.dx / LedgerStick.range).clamp(-1.0, 1.0),
      (-lean.dy / LedgerStick.range).clamp(-1.0, 1.0),
    ]);
  }

  /// Two fingers moved: a turn of the hand is a held turn of the camera, and a change in the gap
  /// between them is a pinch.
  void _turn() {
    if (_camera.length != 2) {
      _stopTurning();
      return;
    }
    final [a, b] = _camera.values.toList();
    final angle = math.atan2(b.dy - a.dy, b.dx - a.dx);
    final gap = (b - a).distance;
    final was = _was, before = _gap;
    _was = angle;
    _gap = gap;
    if (was == null || before == null) return;
    // the short way round, or a hand turning through the bottom of the circle reads as a full turn
    var by = angle - was;
    while (by > math.pi) { by -= math.pi * 2; }
    while (by < -math.pi) { by += math.pi * 2; }
    final enough = _turning != 0 ? LedgerStick.still : LedgerStick.twist;
    // clockwise on the glass turns the country clockwise under it, as a paper map turns
    final turning = by.abs() < enough ? 0 : (by > 0 ? 1 : -1);
    if (turning != _turning) {
      _turning = turning;
      if (turning == 0) {
        widget.input.release(_cameraToken);
      } else {
        widget.input.hold(_cameraToken, look: [turning.toDouble(), 0]);
      }
    }
    // fingers apart is zoom in, which is the wheel scrolled the other way
    _pinch += (before - gap) * LedgerStick.wheelPerPixel;
    _flush ??= Timer(const Duration(milliseconds: 80), _sendZoom);
  }

  void _sendZoom() {
    _flush = null;
    if (_pinch != 0) widget.onZoom?.call(_pinch);
    _pinch = 0;
  }

  void _stopTurning() {
    if (_turning == 0) return;
    _turning = 0;
    widget.input.release(_cameraToken);
  }

  void _up(PointerEvent event) {
    if (_camera.remove(event.pointer) != null) {
      _was = null;
      _gap = null;
      if (_camera.length < 2) _stopTurning();
      _flush?.cancel();
      _sendZoom();
      return;
    }
    if (event.pointer != _pointer) return;
    widget.input.release(_token);
    setState(() { _pointer = null; _origin = null; _nub = Offset.zero; });
  }

  @override
  void dispose() {
    _flush?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, size) {
    const half = LedgerThumbRing.box / 2;
    // resting at its home, bottom-left above the tabs' end, until a thumb puts it somewhere
    final centre = _origin ?? Offset(24 + half, math.max(half, size.maxHeight - 20 - half));
    return Semantics(label: 'Walk: put a thumb down and lean it. Turn the camera with two fingers', child: Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: _down, onPointerMove: _move, onPointerUp: _up, onPointerCancel: _up,
      child: Stack(fit: StackFit.expand, children: [
        Positioned(left: centre.dx - half, top: centre.dy - half,
          child: IgnorePointer(child: LedgerThumbRing(health: widget.health, breath: widget.breath, nub: _nub))),
      ])));
  });
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../native_world_renderer.dart';
import '../photo_capture.dart';
import 'ledger_tokens.dart';

/// The shutter and the way back, over the same live world. A slow capture can be put away, and a
/// cancelled share can be tried again without leaving the game.
class PhotoControls extends StatefulWidget {
  const PhotoControls({super.key, required this.tokens, required this.snapshot, required this.close, this.isCurrent});
  final LedgerTokens tokens;
  final Future<RenderSnapshot?> Function() snapshot;
  final VoidCallback close;
  final bool Function()? isCurrent;

  @override
  State<PhotoControls> createState() => _PhotoControlsState();
}

class _PhotoControlsState extends State<PhotoControls> {
  bool _taking = false;
  bool _retired = false;

  void _close() {
    _retired = true;
    widget.close();
  }

  Future<void> _take() async {
    if (_taking || _retired) return;
    setState(() => _taking = true);
    bool current() => mounted && !_retired && (widget.isCurrent?.call() ?? true);
    final result = await const PhotoCapture().captureAndShare(widget.snapshot, isCurrent: current);
    if (!mounted) return;
    if (!current()) return;
    setState(() => _taking = false);
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(result.message),
      behavior: SnackBarBehavior.floating, margin: const EdgeInsets.fromLTRB(12, 0, 12, 64)));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final style = TextButton.styleFrom(foregroundColor: t.ink, backgroundColor: t.surface,
      minimumSize: const Size(44, 44), shape: const RoundedRectangleBorder());
    return PopScope(canPop: false, onPopInvokedWithResult: (didPop, _) { if (!didPop) _close(); },
      child: Focus(autofocus: true, onKeyEvent: (_, event) {
        if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) {
          _close();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      }, child: Stack(fit: StackFit.expand, children: [
        Positioned(top: 8, right: 8, child: TextButton(key: const ValueKey('photo-exit'), style: style,
          onPressed: _close, child: Text('EXIT PHOTO', style: t.numbers(11, t.ink)))),
        Positioned(bottom: 8, left: 0, right: 0, child: Center(child: TextButton(
          key: const ValueKey('photo-shutter'), style: style, onPressed: _taking ? null : _take,
          child: Text(_taking ? 'TAKING PHOTO…' : 'TAKE AND SHARE PHOTO', style: t.numbers(11, t.ink))))),
      ])));
  }
}

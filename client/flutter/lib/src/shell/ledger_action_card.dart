import 'package:flutter/material.dart';
import 'input_owner.dart';
import 'ledger_tokens.dart';

/// Callbacks come from real registered session actions; no unsupported action is invented.
class LedgerActionCard extends StatelessWidget {
  const LedgerActionCard({super.key, required this.input, required this.tokens,
    this.subject = 'NOTHING IN REACH', this.verbs = const {}, this.onPrimaryPress});
  final InputOwnerController input;
  final LedgerTokens tokens;
  final String subject;
  final Map<String, VoidCallback> verbs;
  final VoidCallback? onPrimaryPress;
  Widget _press(String label, double height, VoidCallback callback) => Semantics(button: true, label: label,
    onTap: () { if (input.acceptsWorld) callback(); },
    child: Listener(onPointerDown: (_) { if (input.acceptsWorld) callback(); },
      child: SizedBox(height: height, child: ColoredBox(color: tokens.surface,
        child: Center(child: Text(label, style: TextStyle(color: tokens.ink, fontSize: 12.5)))))));
  @override
  Widget build(BuildContext context) => SizedBox(width: 208, child: Column(mainAxisSize: MainAxisSize.min, children: [
    SizedBox(height: 28, child: ColoredBox(color: tokens.surface,
      child: Center(child: Text(subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: tokens.accent, fontSize: 10))))),
    for (final verb in verbs.entries.take(3)) _press(verb.key, 44, verb.value),
    Row(children: [
      if (onPrimaryPress != null) Expanded(child: _press('SWING', 62, onPrimaryPress!)),
      Semantics(button: true, label: 'Hold guard', child: Listener(
        onPointerDown: (event) => input.hold(('guard', event.pointer), guard: true),
        onPointerUp: (event) => input.release(('guard', event.pointer)),
        onPointerCancel: (event) => input.release(('guard', event.pointer)),
        child: SizedBox(width: 62, height: 62, child: ColoredBox(color: tokens.surface,
          child: Center(child: Text('GUARD', style: TextStyle(color: tokens.ink, fontSize: 11))))))),
    ]),
  ]));
}

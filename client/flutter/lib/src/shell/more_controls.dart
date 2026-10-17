import 'package:flutter/material.dart';

import 'ledger_glyphs.dart';
import 'ledger_tokens.dart';

/// One control behind "more": the game's own action by name (`PLAYER_ACTION_KEYS`), what it shows,
/// and what a screen reader says.
typedef MoreControl = ({String action, String glyph, String label});

/// The rest of the keyboard, one tap away (#571), as the page's touch controls keep it
/// (`src/ui/touch.ts`, `MORE_BUTTONS`): none of these is wanted mid-stride, so none earns a
/// permanent square of a phone screen. Loosing an arrow and jumping are here too, because the
/// handoff's action card holds only the reflex pair. `console` opens the console and `company` the
/// travellers page, rather than acting. Photo mode is not here until the phone can take a picture.
const moreControls = <MoreControl>[
  (action: 'shoot', glyph: '🏹', label: 'Loose an arrow'),
  (action: 'jump', glyph: '⤒', label: 'Jump'),
  (action: 'ward', glyph: '🛡', label: 'Ward'),
  (action: 'blight', glyph: '✴', label: 'Blight'),
  (action: 'light', glyph: '🔆', label: 'Witchlight'),
  (action: 'draught', glyph: '🔮', label: 'Drink a warding draught'),
  (action: 'hire', glyph: '🗡', label: 'Your company'),
  (action: 'give', glyph: '🤝', label: 'Give, trade or duel'),
  (action: 'party', glyph: '🧭', label: 'Party'),
  (action: 'company', glyph: '👥', label: 'Travellers'),
  (action: 'rally', glyph: '📍', label: 'Rally point'),
  (action: 'cameraMode', glyph: '🎥', label: 'Free camera'),
  (action: 'console', glyph: '›_', label: 'Console'),
];

/// The "more" button, and the controls it opens: a tap on one does it and puts them away again.
class MoreControls extends StatefulWidget {
  const MoreControls({super.key, required this.tokens, required this.onAction});
  final LedgerTokens tokens;
  final ValueChanged<String> onAction;

  @override
  State<MoreControls> createState() => _MoreControlsState();
}

class _MoreControlsState extends State<MoreControls> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final more = Semantics(button: true, label: _open ? 'Put the other controls away' : 'More controls', excludeSemantics: true,
      onTap: () => setState(() => _open = !_open),
      child: SizedBox(width: 44, height: 44, child: Material(color: t.surface, child: InkWell(key: const ValueKey('more'),
        onTap: () => setState(() => _open = !_open),
        child: Center(child: _open ? LedgerIcon(LedgerGlyph.close, color: t.accent) : LedgerIcon(LedgerGlyph.more, color: t.ink))))));
    if (!_open) return more;
    return Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
      more,
      const SizedBox(height: 4),
      ConstrainedBox(constraints: const BoxConstraints(maxWidth: 4 * 48.0, maxHeight: 4 * 48.0),
        child: SingleChildScrollView(child: Wrap(spacing: 4, runSpacing: 4, alignment: WrapAlignment.end, children: [
          for (final control in moreControls)
            Semantics(button: true, label: control.label, excludeSemantics: true, onTap: () => _do(control.action),
              child: SizedBox(width: 44, height: 44, child: Material(color: t.surface, child: InkWell(
                key: ValueKey('more-${control.action}'), onTap: () => _do(control.action),
                child: Center(child: Text(control.glyph, style: t.numbers(17, t.ink, spacing: 0))))))),
        ]))),
    ]);
  }

  void _do(String action) {
    setState(() => _open = false);
    widget.onAction(action);
  }
}

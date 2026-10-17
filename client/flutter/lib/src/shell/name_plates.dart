import 'package:flutter/widgets.dart';

import 'ledger_tokens.dart';

/// Other players' names over their heads in a shared world (#576): where the game says each hangs
/// in the viewport (`src/render/other-bodies.ts`), centred above that point, on a slab of the
/// theme's surface so a name never sits on the world alone. They take no touches.
class NamePlates extends StatelessWidget {
  const NamePlates({super.key, required this.plates, required this.tokens});
  /// The HUD's `plates`: each an `id`, the `text` and where it hangs, `x` and `y`.
  final List<Map> plates;
  final LedgerTokens tokens;

  @override
  Widget build(BuildContext context) => IgnorePointer(child: Stack(fit: StackFit.expand, children: [
    for (final plate in plates)
      if (plate['x'] is num && plate['y'] is num)
        Positioned(key: ValueKey('plate-${plate['id']}'), left: (plate['x'] as num).toDouble(), top: (plate['y'] as num).toDouble(),
          child: FractionalTranslation(translation: const Offset(-0.5, -1),
            child: ColoredBox(color: tokens.surface, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Text('${plate['text']}', maxLines: 1, style: tokens.numbers(10, tokens.ink, spacing: 1)))))),
  ]));
}

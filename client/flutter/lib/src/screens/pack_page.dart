import 'package:flutter/material.dart';

import '../shell/ledger_shell.dart';
import '../shell/ledger_tokens.dart';

/// The rucksack (#573; design/mobile/README.md, "The book — your pack"): what is worn, in six
/// 44px cells, and what is carried, in the 44px row grammar. The rows are the game's own
/// (`src/game/pack.ts`), and a tap is the game's own rule for that row: wear it, use it, or look at
/// it; a worn cell is stowed. This page decides nothing.
class PackPage extends StatelessWidget {
  const PackPage({super.key, required this.pack, required this.tokens, required this.take, required this.stow});
  /// The engine's `pack` model.
  final Map<String, dynamic> pack;
  final LedgerTokens tokens;
  final ValueChanged<String> take, stow;

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    final worn = (pack['worn'] as List? ?? const []).cast<Map>();
    final carried = (pack['carried'] as List? ?? const []).cast<Map>();
    final wearing = worn.where((slot) => slot['id'] != null).length;
    final count = carried.fold<int>(0, (n, thing) => n + ((thing['count'] as num?)?.toInt() ?? 0));
    Widget label(String text) => Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Text(text, style: t.numbers(9, t.pageDim, spacing: 2)));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8), child: Row(children: [
          Text('RUCKSACK', style: t.face(17, t.pageInk, weight: FontWeight.w500, spacing: 3)),
          const Spacer(),
          Text('${pack['gold'] ?? 0} gold · $count carried · $wearing/${worn.length} worn', style: t.numbers(12, t.pageInk, spacing: 0)),
        ]))),
      label('WORN'),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Wrap(spacing: 4, runSpacing: 4, children: [
        for (final slot in worn)
          Semantics(button: slot['id'] != null, label: slot['id'] == null ? '${slot['slotName']}: empty' : '${slot['slotName']}: ${slot['name']}, stow',
            child: SizedBox(key: ValueKey('worn-${slot['slot']}'), width: 44, height: 44, child: InkWell(
              onTap: slot['id'] == null ? null : () => stow('${slot['slot']}'),
              child: DecoratedBox(decoration: BoxDecoration(
                  color: slot['id'] == null ? null : const Color(0xffffe9b8),
                  border: Border.all(color: slot['id'] == null ? t.pageDim : t.rule)),
                child: Center(child: Text('${slot['emoji'] ?? slot['icon'] ?? ''}', style: const TextStyle(fontSize: 18))))))),
      ])),
      label('CARRIED'),
      Expanded(child: carried.isEmpty
        ? Padding(padding: const EdgeInsets.all(12), child: Text('Nothing but lint.', style: t.face(14.5, t.pageDim)))
        : ListView(padding: const EdgeInsets.only(right: 12), children: [
            for (final thing in carried)
              LedgerRow(key: ValueKey('carried-${thing['id']}'), tokens: t,
                name: '${thing['emoji']} ${thing['name']}${(thing['count'] as num? ?? 1) > 1 ? ' ×${thing['count']}' : ''}',
                consequence: '${thing['note'] ?? ''}',
                verb: thing['verb'] == 'look' ? '${thing['price']}g' : '${thing['verb']}'.toUpperCase(),
                onPressed: () => take('${thing['id']}')),
          ])),
    ]);
  }
}

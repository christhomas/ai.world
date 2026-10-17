import 'package:flutter/material.dart';

import '../shell/ledger_shell.dart';
import '../shell/ledger_tokens.dart';

/// The journal (#575): the hero in a line, then the errands owed with where each leads, the places
/// found nearest first, and the ferries. The handoff left the journal undrawn, so it is a page of
/// the same book in the 44px row grammar. The rows are the game's own (`src/game/journal-view.ts`),
/// so it shows exactly what the page's journal does and nothing that has not been found. A row that
/// knows where it is opens the map there.
class JournalPage extends StatelessWidget {
  const JournalPage({super.key, required this.journal, required this.tokens, this.show});
  /// The engine's `journal` model.
  final Map<String, dynamic> journal;
  final LedgerTokens tokens;
  /// Open the map on a place, in the world's tiles.
  final void Function(Offset place)? show;

  VoidCallback? _showing(Object? at) {
    final show = this.show;
    if (show == null || at is! Map || at['x'] is! num || at['z'] is! num) return null;
    final place = Offset((at['x'] as num).toDouble(), (at['z'] as num).toDouble());
    return () => show(place);
  }

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    List<Map> rows(String key) => (journal[key] as List? ?? const []).cast<Map>();
    final errands = rows('errands'), found = rows('found'), ferries = rows('ferries');
    Widget label(String text) => Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Text(text, style: t.numbers(9, t.pageDim, spacing: 2)));
    Widget empty(String text) => Padding(padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: Text(text, style: t.face(14.5, t.pageDim)));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('JOURNAL', style: t.face(17, t.pageInk, weight: FontWeight.w500, spacing: 3)),
            const SizedBox(width: 12),
            // the day gives way before the title does on a narrow page
            Expanded(child: Text('DAY ${journal['day'] ?? 1} · ${'${journal['season'] ?? ''}'.toUpperCase()}', textAlign: TextAlign.end,
              maxLines: 1, overflow: TextOverflow.ellipsis, style: t.numbers(12, t.pageInk, spacing: 0))),
          ]),
          const SizedBox(height: 4),
          Text('${journal['hp'] ?? 0}/${journal['maxHp'] ?? 0} hearts · ⚔ ${journal['attack'] ?? 0} · 🛡 ${journal['defence'] ?? 0} · '
              '${journal['gold'] ?? 0} gold', style: t.numbers(11, t.pageDim, spacing: 0)),
          Text('${journal['placesFound'] ?? 0} places found · ${journal['errandsDone'] ?? 0} errands finished · '
              '${journal['cellsWalked'] ?? 0} map cells walked', style: t.numbers(11, t.pageDim, spacing: 0)),
        ]))),
      Expanded(child: ListView(padding: const EdgeInsets.only(right: 12), children: [
        label('ERRANDS'),
        if (errands.isEmpty) empty('Nothing promised. Village elders stand near their wells.'),
        for (final errand in errands)
          LedgerRow(key: ValueKey('errand-${errand['id']}'), tokens: t,
            chip: errand['done'] == true ? const Color(0xff3d6b34) : const Color(0xff8a6a3d),
            name: '${errand['done'] == true ? '✅' : '📜'} ${errand['what']}',
            consequence: errand['tiles'] == null ? '${errand['village']}' : '${errand['village']}, ${errand['tiles']} tiles',
            verb: errand['done'] == true ? 'DONE' : '${errand['bearing'] ?? ''}', onPressed: _showing(errand['at'])),
        label('PLACES FOUND'),
        if (found.isEmpty) empty('Nothing yet. Follow the roads.'),
        for (final place in found)
          LedgerRow(key: ValueKey('found-${place['name']}'), tokens: t,
            name: '${place['icon']} ${place['name']}', consequence: '${place['tiles']} tiles', verb: '${place['bearing']}',
            onPressed: _showing(place['at'])),
        label('FERRIES'),
        if (ferries.isEmpty) empty('No crossings known.'),
        for (final line in ferries)
          LedgerRow(key: ValueKey('ferry-${line['from']}-${line['to']}'), tokens: t,
            name: '⛵ ${line['from']} ↔ ${line['to']}', consequence: '${line['where']}', verb: '${line['nextArrival']}'),
      ])),
    ]);
  }
}

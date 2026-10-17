import 'package:flutter/material.dart';

import '../shell/ledger_shell.dart';
import '../shell/ledger_tokens.dart';

/// The roster (#575): everybody on the register, how they are getting on, in the order asked —
/// the rows `src/game/roster-view.ts` reads for the page's roster. It is long, so the game sends it
/// only while this page is open: opening asks for it, a sort asks again, and closing stops it.
class RosterPage extends StatefulWidget {
  const RosterPage({super.key, required this.roster, required this.tokens, required this.read});
  /// The engine's `roster` model.
  final Map<String, dynamic> roster;
  final LedgerTokens tokens;
  /// Ask for the roster in an order, or stop asking with null.
  final ValueChanged<String?> read;

  static const orders = ['village', 'name', 'age', 'purse', 'hunger'];

  @override
  State<RosterPage> createState() => _RosterPageState();
}

class _RosterPageState extends State<RosterPage> {
  String _by = 'village';

  @override
  void initState() {
    super.initState();
    widget.read(_by);
  }

  @override
  void dispose() {
    widget.read(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final r = widget.roster;
    final people = (r['people'] as List? ?? const []).cast<Map>();
    final unvisited = (r['unvisited'] as num?)?.toInt() ?? 0;
    final villages = (r['villages'] as num?)?.toInt() ?? 0;
    final hungry = (r['hungry'] as num?)?.toInt() ?? 0;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('THE ROSTER', style: t.face(17, t.pageInk, weight: FontWeight.w500, spacing: 3)),
          const SizedBox(height: 4),
          Text('Day ${r['day'] ?? '—'} · ${r['alive'] ?? 0} alive in $villages ${villages == 1 ? 'village' : 'villages'} · '
              '${r['purse'] ?? 0} gold between them${hungry > 0 ? ' · $hungry going without' : ''}',
            style: t.numbers(11, t.pageDim, spacing: 0)),
          if (unvisited > 0) Text('$unvisited more ${unvisited == 1 ? 'village has' : 'villages have'} not been visited yet — '
              'nobody is on the register until somebody goes there.', style: t.numbers(10, t.pageDim, spacing: 0)),
        ]))),
      SizedBox(height: 44, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
        for (final by in RosterPage.orders)
          Semantics(button: true, selected: by == _by, label: 'Sort by $by', excludeSemantics: true,
            onTap: () => _sort(by), child: SizedBox(width: 72, height: 44, child: InkWell(key: ValueKey('sort-$by'), onTap: () => _sort(by),
              child: Center(child: Text(by.toUpperCase(), style: t.numbers(10, by == _by ? t.pageInk : t.pageDim,
                weight: by == _by ? FontWeight.w600 : FontWeight.w400)))))),
      ])),
      Expanded(child: people.isEmpty
        ? Padding(padding: const EdgeInsets.all(12), child: Text(r.isEmpty ? 'Reading the register…' : 'Nobody is on the register yet.',
            style: t.face(14.5, t.pageDim)))
        : ListView(padding: const EdgeInsets.only(right: 12), children: [
            for (final p in people)
              LedgerRow(key: ValueKey('person-${p['id']}'), tokens: t,
                chip: p['hungry'] == 0 ? const Color(0xff3d6b34) : const Color(0xff8a2a14),
                name: '${p['name']}${p['old'] == true ? ' (old)' : ''}',
                consequence: [
                  '${p['village']}', '${p['trade']}', '${p['age']}',
                  if (p['hungry'] != 0) '${p['hungry']}d hungry',
                  if ('${p['doing'] ?? ''}'.isNotEmpty) '${p['doing']}',
                ].join(' · '),
                verb: '${p['purse']}g'),
          ])),
    ]);
  }

  void _sort(String by) {
    if (by == _by) return;
    setState(() => _by = by);
    widget.read(by);
  }
}

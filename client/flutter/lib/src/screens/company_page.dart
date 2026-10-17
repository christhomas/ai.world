import 'package:flutter/material.dart';

import '../shell/ledger_shell.dart';
import '../shell/ledger_tokens.dart';

/// The travellers (#576): everybody else in this world, nearest first, where each is and how far
/// off — the rows `src/game/company-view.ts` reads for the page's list. People move, so the game
/// sends it only while this page is open: opening asks for it and closing stops it.
class CompanyPage extends StatefulWidget {
  const CompanyPage({super.key, required this.company, required this.tokens, required this.read});
  /// The engine's `company` model.
  final Map<String, dynamic> company;
  final LedgerTokens tokens;
  /// Ask for the travellers, or stop asking with null.
  final ValueChanged<String?> read;

  @override
  State<CompanyPage> createState() => _CompanyPageState();
}

class _CompanyPageState extends State<CompanyPage> {
  @override
  void initState() {
    super.initState();
    widget.read('company');
  }

  @override
  void dispose() {
    widget.read(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final c = widget.company;
    final travellers = (c['travellers'] as List? ?? const []).cast<Map>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.rule, width: 2))),
        child: Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('TRAVELLERS', style: t.face(17, t.pageInk, weight: FontWeight.w500, spacing: 3)),
          const SizedBox(height: 4),
          if (c.isNotEmpty) Text('You are ${c['me']}, ${c['where']}.', style: t.numbers(11, t.pageDim, spacing: 0)),
        ]))),
      Expanded(child: travellers.isEmpty
        ? Padding(padding: const EdgeInsets.all(12), child: Text(c.isEmpty ? 'Looking about…' : 'Nobody else is in this world right now.',
            style: t.face(14.5, t.pageDim)))
        : ListView(padding: const EdgeInsets.only(right: 12), children: [
            for (final p in travellers)
              LedgerRow(key: ValueKey('traveller-${p['id']}'), tokens: t,
                // the compass is the page's mark for somebody travelling with you
                chip: p['party'] == true ? const Color(0xff3d6b34) : const Color(0xff8a6a3d),
                name: '${p['party'] == true ? '🧭 ' : ''}${p['name']}',
                consequence: [
                  '${p['where']}',
                  if (p['riding'] == 'horse') 'on horseback',
                  if (p['riding'] == 'boat') 'under sail',
                ].join(' · '),
                verb: '${p['away']} tiles'),
          ])),
    ]);
  }
}

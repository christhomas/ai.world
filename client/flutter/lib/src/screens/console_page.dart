import 'package:flutter/material.dart';

import '../shell/ledger_tokens.dart';

/// The console (#576; design/mobile/README.md, "TYPING: the console only"): what the game has said
/// in it, newest at the foot, and a line to type into. The game reads the line as the page's
/// console does — `?` asks it, `/` is a gesture or a command, anything else is said out loud to
/// whoever is in the world — so this page only sends it.
class ConsolePage extends StatefulWidget {
  const ConsolePage({super.key, required this.lines, required this.tokens, required this.say, required this.done});
  /// The HUD's `chat`: each a `text` and a `kind`, `chat` or `sys`.
  final List<Map> lines;
  final LedgerTokens tokens;
  final ValueChanged<String> say;
  final VoidCallback done;

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  final _line = TextEditingController();

  void _send() {
    final text = _line.text.trim();
    if (text.isEmpty) return;
    widget.say(text.length > 500 ? text.substring(0, 500) : text);
    _line.clear();
  }

  @override
  void dispose() {
    _line.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    return SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 8), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('CONSOLE', style: t.numbers(11, t.accent, spacing: 2)),
          const Spacer(),
          Text('? ASKS · / ACTS · ANYTHING ELSE IS SAID', style: t.numbers(9, t.dim, spacing: 1)),
          SizedBox(width: 44, height: 44, child: InkWell(key: const ValueKey('console-done'), onTap: widget.done,
            child: Center(child: Text('✕', style: t.numbers(15, t.ink, spacing: 0))))),
        ]),
        Expanded(child: widget.lines.isEmpty
          ? Center(child: Text('Nothing said yet. Type ? to ask the game what it knows.', style: t.face(14.5, t.dim)))
          : ListView(reverse: true, children: [
              for (final line in widget.lines.reversed)
                Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('${line['text']}',
                  style: line['kind'] == 'sys' ? t.numbers(12, t.dim, spacing: 0) : t.face(14.5, t.ink))),
            ])),
        Row(children: [
          Expanded(child: TextField(key: const ValueKey('console-line'), controller: _line, autofocus: true,
            maxLength: 500, style: t.face(14.5, t.ink), textInputAction: TextInputAction.send,
            decoration: InputDecoration(counterText: '', hintText: 'Say something, or ? to ask', hintStyle: t.face(14.5, t.dim)),
            onSubmitted: (_) => _send())),
          SizedBox(width: 72, height: 44, child: TextButton(key: const ValueKey('console-say'), onPressed: _send,
            style: TextButton.styleFrom(backgroundColor: t.action, foregroundColor: t.actionInk, shape: const RoundedRectangleBorder()),
            child: Text('SAY', style: t.numbers(12, t.actionInk, spacing: 2)))),
        ]),
      ])));
  }
}

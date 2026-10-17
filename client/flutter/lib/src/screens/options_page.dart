import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../game_session.dart';
import '../shell/ledger_shell.dart';
import '../shell/ledger_tokens.dart';

/// Options (#578): what the page's options panel offers that means something on a phone, in the
/// book's rows. Leaving keeps the game; see-through is the game's own switch, the one its `2` key
/// throws; the world line says which world this is; a shared world can be handed on as the same
/// invite link the page copies; and the theme picker is the shell's.
class OptionsPage extends StatelessWidget {
  const OptionsPage({super.key, required this.slot, required this.tokens, required this.controller,
    required this.leave, required this.seeThrough});
  final GameSlot slot;
  final LedgerTokens tokens;
  final LedgerController controller;
  final VoidCallback leave, seeThrough;

  /// The link that puts somebody else in this world, as `inviteTo` in `src/game/joining.ts` builds
  /// it: the page served beside the world server, the seed, and the server. A link that does not
  /// say grows endless country, so a road world says so.
  static String? inviteFor(GameSlot slot) {
    final server = Uri.tryParse(slot.server ?? '');
    if (server == null || server.host.isEmpty) return null;
    final page = Uri(scheme: server.scheme == 'wss' ? 'https' : 'http', host: server.host,
      port: server.hasPort ? server.port : null, path: '/',
      queryParameters: {'seed': '${slot.seed}', if (slot.kind == 'road') 'world': 'road', 'server': slot.server!});
    return page.toString();
  }

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    final invite = inviteFor(slot);
    Widget label(String text) => Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Text(text, style: t.numbers(9, t.pageDim, spacing: 2)));
    return ListView(padding: const EdgeInsets.only(right: 12), children: [
      label('GAME'),
      LedgerRow(key: const ValueKey('save-and-leave'), tokens: t, name: 'Save and return to the title', verb: 'LEAVE', onPressed: leave),
      LedgerRow(key: const ValueKey('see-through'), tokens: t, name: 'See through walls',
        consequence: 'what stands between you and the camera', verb: 'SWITCH', onPressed: seeThrough),
      label('WORLD'),
      LedgerRow(key: const ValueKey('open-roster'), tokens: t, name: 'The roster',
        consequence: 'everybody on the register, and how they are getting on', verb: 'READ',
        onPressed: () => controller.open('roster')),
      LedgerRow(key: const ValueKey('world-line'), tokens: t, name: 'Seed ${slot.seed} · ${slot.kind}',
        consequence: slot.server ?? 'alone, on this phone'),
      if (invite != null)
        LedgerRow(key: const ValueKey('invite'), tokens: t, name: 'Copy an invite link', consequence: invite, verb: 'COPY',
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: invite));
            if (context.mounted) {
              ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Invite link copied')));
            }
          }),
      label('THEME'),
      SizedBox(height: 300, child: LedgerThemePicker(controller: controller)),
    ]);
  }
}

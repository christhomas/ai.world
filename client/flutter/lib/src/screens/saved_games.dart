import 'package:flutter/material.dart';

import '../game_session.dart';
import '../kept_games.dart';
import '../shell/ledger_tokens.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// Export a kept game to a file; `origin` is the button's place on the screen, for the share sheet.
typedef ExportGame = void Function(GameSlot slot, Rect? origin);

/// The games kept on this phone, on the title (#572, #577): each one to play again, to export to a
/// file that outlives a reinstall or moves to another phone, or to delete once the player has said
/// yes to a question that says plainly it cannot be undone.
class SavedGames extends StatelessWidget {
  const SavedGames({super.key, required this.games, required this.tokens, required this.play, required this.delete,
    required this.back, this.exportGame, this.note});
  final List<KeptGame> games;
  final LedgerTokens tokens;
  final ValueChanged<GameSlot> play;
  final ValueChanged<GameSlot> delete;
  /// Absent where nothing can take a file, and then there is no EXPORT.
  final ExportGame? exportGame;
  /// What became of the last export, said under the list.
  final String? note;
  final VoidCallback back;

  /// Where a game is played, and when it last was: two games by the same name are told apart by these.
  static String describe(KeptGame game) {
    final server = game.slot.server;
    final where = server == null ? 'your own world' : 'shared, ${Uri.tryParse(server)?.host ?? server}';
    final at = game.played;
    return '$where · played ${at.day} ${_months[at.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Text('SAVED GAMES', style: t.face(17, t.ink, weight: FontWeight.w500, spacing: 4)),
      const SizedBox(height: 8),
      ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420, maxHeight: 4 * 44.0),
        child: ListView(shrinkWrap: true, children: [
          for (final game in games)
            SizedBox(key: ValueKey('saved-${game.slot.slot}'), height: 44, child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                Text(game.slot.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.face(14.5, t.ink)),
                Text(describe(game), maxLines: 1, overflow: TextOverflow.ellipsis, style: t.numbers(10, t.dim, spacing: 0)),
              ])),
              _button('PLAY', "Play ${game.slot.name}'s game", ValueKey('play-${game.slot.slot}'), () => play(game.slot)),
              const SizedBox(width: 4),
              if (exportGame case final send?) ...[
                Builder(builder: (context) => _button('EXPORT', "Export ${game.slot.name}'s game to a file",
                  ValueKey('export-${game.slot.slot}'), () => send(game.slot, _place(context)))),
                const SizedBox(width: 4),
              ],
              _button('DELETE', "Delete ${game.slot.name}'s game", ValueKey('delete-${game.slot.slot}'), () => _confirm(context, game.slot)),
            ])),
        ])),
      if (note case final note?) Padding(padding: const EdgeInsets.only(top: 8),
        child: Text(note, key: const ValueKey('saved-note'), style: t.numbers(11, t.dim, spacing: 0))),
      const SizedBox(height: 8),
      SizedBox(width: 240, height: 44, child: TextButton(key: const ValueKey('saved-back'), onPressed: back,
        child: Text('BACK', style: t.numbers(12.5, t.ink, spacing: 2)))),
    ]);
  }

  Widget _button(String label, String meaning, Key key, VoidCallback onPressed) => Semantics(button: true, label: meaning,
    excludeSemantics: true, onTap: onPressed,
    child: SizedBox(width: 72, height: 44, child: TextButton(key: key, onPressed: onPressed,
      style: TextButton.styleFrom(backgroundColor: tokens.surface, padding: EdgeInsets.zero, shape: const RoundedRectangleBorder()),
      child: Text(label, style: tokens.numbers(11, tokens.ink, spacing: 1)))));

  /// Where a button is on the screen: an iPad's share sheet is a popover and must point at something.
  static Rect? _place(BuildContext context) {
    final box = context.findRenderObject();
    return box is RenderBox && box.hasSize ? box.localToGlobal(Offset.zero) & box.size : null;
  }

  Future<void> _confirm(BuildContext context, GameSlot slot) async {
    final t = tokens;
    final sure = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      backgroundColor: t.surface,
      title: Text("Delete ${slot.name}'s game?", style: t.face(17, t.ink)),
      content: Text('The hero and the world are gone for good. This cannot be undone.', style: t.numbers(12, t.ink, spacing: 0)),
      actions: [
        TextButton(key: const ValueKey('delete-keep'), onPressed: () => Navigator.of(context).pop(false),
          child: Text('KEEP IT', style: t.numbers(12, t.ink, spacing: 1))),
        TextButton(key: const ValueKey('delete-sure'), onPressed: () => Navigator.of(context).pop(true),
          child: Text('DELETE', style: t.numbers(12, t.accent, spacing: 1))),
      ],
    ));
    if (sure == true) delete(slot);
  }
}

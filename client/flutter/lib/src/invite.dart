import 'game_session.dart';

/// An invite to a shared world, as the page hands them out (`src/game/joining.ts`, `inviteTo`):
/// a link with the world server's address in `server` and the seed underneath it in `seed`, and
/// `world` saying which country it grows when it is `road` or `endless`. A link that does not say
/// grows `endless`, as the page does (`kindOf` in `src/save/store.ts`).
class WorldInvite {
  const WorldInvite({required this.server, required this.seed, this.kind = 'endless'});
  final String server;
  final int seed;
  final String kind;

  /// The invite in a link somebody pasted, or why it is not one the app can follow. A bare
  /// `wss://` address is not enough on its own: the seed is what says which world to grow.
  static (WorldInvite?, String?) parse(String text) {
    final link = Uri.tryParse(text.trim());
    if (link == null || !link.hasScheme) return (null, 'Paste the invite link somebody sent you.');
    final server = link.queryParameters['server'];
    final world = link.queryParameters['world'];
    final seed = int.tryParse(link.queryParameters['seed'] ?? '');
    if (server == null) return (null, 'That link has no world server in it.');
    final address = Uri.tryParse(server);
    if (address == null || (address.scheme != 'wss' && address.scheme != 'ws') || address.host.isEmpty) {
      return (null, 'The world server in that link is not a wss:// address.');
    }
    if (seed == null) {
      return (null, world == null || world == 'road' || world == 'endless'
        ? 'That link does not say which world to grow.'
        : 'Named worlds like “$world” cannot be joined from the app yet.');
    }
    return (WorldInvite(server: server, seed: seed, kind: world == 'road' ? 'road' : 'endless'), null);
  }

  /// The slot this world's hero is kept in: one per server and seed, so the same invite followed
  /// twice is the same hero, and two worlds never share one.
  GameSlot slot({String name = 'Traveller'}) {
    final host = Uri.parse(server).host.toLowerCase().replaceAll(RegExp('[^a-z0-9.-]'), '');
    final named = 'shared-$seed-$host';
    return GameSlot(slot: named.length > 48 ? named.substring(0, 48) : named, seed: seed, kind: kind, name: name, server: server);
  }
}

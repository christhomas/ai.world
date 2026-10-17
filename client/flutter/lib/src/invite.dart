import 'dart:convert';
import 'dart:io';

import 'game_session.dart';

/// Asks a world server what a named world is (`GET /world?name=`) and gives back its answer.
typedef DescribeWorld = Future<Map<String, dynamic>> Function(Uri endpoint);

/// An invite to a shared world, as the page hands them out (`src/game/joining.ts`, `inviteTo`):
/// a link with the world server's address in `server`, and either the seed underneath it in `seed`,
/// with `world` saying which country it grows when it is `road` or `endless`, or a named world's
/// name in `world` and no seed at all. A link that does not say grows `endless`, as the page does
/// (`kindOf` in `src/save/store.ts`).
///
/// A named world is the server's to describe (#565): which seed, which country, and what it was
/// authored with. Until it has been asked, the invite has a name and no seed.
class WorldInvite {
  const WorldInvite({required this.server, required this.seed, this.kind = 'endless', this.name});
  final String server;
  /// Null for a named world nobody has asked the server about yet.
  final int? seed;
  final String kind;
  /// A named world's name, as the invite spelled it.
  final String? name;

  /// The invite in a link somebody pasted, or why it is not one the app can follow. A bare
  /// `wss://` address is not enough on its own: the seed, or a world's name, is what says which world.
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
      if (world == null || world == 'road' || world == 'endless' || world.trim().isEmpty) {
        return (null, 'That link does not say which world to grow.');
      }
      return (WorldInvite(server: server, seed: null, name: world), null);
    }
    return (WorldInvite(server: server, seed: seed, kind: world == 'road' ? 'road' : 'endless'), null);
  }

  /// Where the server says what a named world is: the same host, over https for a wss server.
  static Uri endpoint(String server, String name) {
    final address = Uri.parse(server);
    return Uri(scheme: address.scheme == 'wss' ? 'https' : 'http', host: address.host,
      port: address.hasPort ? address.port : null, path: '/world', queryParameters: {'name': name});
  }

  /// The named world as its server described it: its seed and its country, under its own spelling.
  WorldInvite described(Map<String, dynamic> world) {
    final seed = world['seed'], kind = world['kind'], spelled = world['name'];
    if (seed is! int || spelled is! String || spelled.isEmpty) {
      throw WorldRefused('The server did not say what “$name” is.');
    }
    return WorldInvite(server: server, seed: seed, kind: kind == 'road' || kind == 'mesh' ? 'road' : 'endless', name: spelled);
  }

  /// The slot this world's hero is kept in: one per server and seed, or per server and name for a
  /// named world, so the same invite followed twice is the same hero, and two worlds never share one.
  GameSlot slot({String name = 'Traveller'}) {
    final seed = this.seed;
    if (seed == null) throw StateError('Ask the server what “${this.name}” is first');
    final host = Uri.parse(server).host.toLowerCase().replaceAll(RegExp('[^a-z0-9.-]'), '');
    // a name is only unique on the server that issued it, and it may be spelled in anything, so it
    // is kept by a fingerprint of the name as the page keys it, lowercased (`boot.ts`)
    final world = this.name;
    final named = world == null ? 'shared-$seed-$host' : 'named-${_fingerprint(world.toLowerCase())}-$host';
    return GameSlot(slot: named.length > 48 ? named.substring(0, 48) : named, seed: seed, kind: kind, name: name,
      server: server, world: world);
  }

  /// FNV-1a over the name's UTF-8, as eight hex digits.
  static String _fingerprint(String text) {
    var hash = 0x811c9dc5;
    for (final byte in utf8.encode(text)) {
      hash = ((hash ^ byte) * 0x01000193) & 0xffffffff;
    }
    return hash.toRadixString(16).padLeft(8, '0');
  }
}

/// Why a named world could not be opened, in words for the player.
class WorldRefused implements Exception {
  const WorldRefused(this.message);
  final String message;
  @override
  String toString() => message;
}

/// The app's own way of asking: over https, refusing anything but a world it can read.
Future<Map<String, dynamic>> describeWorld(Uri endpoint) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
  try {
    final request = await client.getUrl(endpoint).timeout(const Duration(seconds: 15));
    final response = await request.close().timeout(const Duration(seconds: 15));
    final text = await response.transform(utf8.decoder).join().timeout(const Duration(seconds: 15));
    final body = text.isEmpty ? null : jsonDecode(text);
    if (response.statusCode != 200) {
      final why = body is Map ? body['error'] : null;
      throw WorldRefused(why is String ? why : 'Could not open world “${endpoint.queryParameters['name']}”.');
    }
    if (body is! Map) throw const WorldRefused('The world server did not answer with a world.');
    return Map<String, dynamic>.from(body);
  } finally {
    client.close(force: true);
  }
}

import 'dart:convert';
import 'package:flutter/services.dart';
import 'host_contract.dart';

/// An owned bundled engine in the app's own JavaScript VM: the hero alone (`open`), or the whole
/// shared game (`openGame`, #563). Requests and replies are the shared host contract either way.
class StateEngine {
  StateEngine._(this.session, this.sourceSha, this._token, this._channel);
  static const _native = MethodChannel('world.ai/state-engine');
  final String session;
  final String sourceSha;
  final String _token;
  final MethodChannel _channel;
  int _sequence = 0;
  bool _retired = false;
  Future<void>? _disposal;
  Future<void> _tail = Future<void>.value();
  bool get isRetired => _retired;

  static Future<StateEngine> open(String session, {Object? savedHero, AssetBundle? assets, MethodChannel? channel}) =>
    _open(session, manifestPath: 'assets/engine/manifest.json', sourcePath: 'assets/engine/engine.js',
      scope: 'hero-state', arguments: {'savedHero': savedHero == null ? null : jsonEncode(savedHero)},
      assets: assets, channel: channel);

  /// The whole game: `options` names the seed, kind of world, save slot, hero and viewport (see
  /// `src/mobile/game-engine.ts`). Nothing in it is fetched; the bundle was built with the app.
  static Future<StateEngine> openGame(String session, Map<String, Object?> options,
      {AssetBundle? assets, MethodChannel? channel}) =>
    _open(session, manifestPath: 'assets/engine/game-manifest.json', sourcePath: 'assets/engine/game.js',
      scope: 'game', arguments: {'entry': 'AiWorldGameEngine', 'options': jsonEncode(options)},
      assets: assets, channel: channel);

  static Future<StateEngine> _open(String session, {required String manifestPath, required String sourcePath,
      required String scope, required Map<String, Object?> arguments, AssetBundle? assets, MethodChannel? channel}) async {
    HostRequestGate(session);
    final bundle = assets ?? rootBundle;
    final manifest = jsonDecode(await bundle.loadString(manifestPath)) as Map<String, dynamic>;
    if (manifest['contractVersion'] != hostContractVersion || manifest['scope'] != scope ||
        manifest['sourceSha'] is! String || !RegExp(r'^[0-9a-f]{40}$').hasMatch(manifest['sourceSha'] as String) ||
        manifest['bundleSha256'] is! String || !RegExp(r'^[0-9a-f]{64}$').hasMatch(manifest['bundleSha256'] as String)) {
      throw const FormatException('Invalid engine manifest');
    }
    final source = await bundle.load(sourcePath);
    final native = channel ?? _native;
    final token = await native.invokeMethod<String>('create', {
      'session': session, 'source': source.buffer.asUint8List(source.offsetInBytes, source.lengthInBytes),
      'bundleSha256': manifest['bundleSha256'],
      ...arguments,
    });
    if (token == null || token.isEmpty) throw StateError('Native engine did not return an owner');
    return StateEngine._(session, manifest['sourceSha'] as String, token, native);
  }

  /// Native application-support/files directory, outside temporary and shared storage.
  static Future<String> storageRoot() async {
    final path = await _native.invokeMethod<String>('storageRoot');
    if (path == null || path.isEmpty) throw StateError('Native storage root unavailable');
    return path;
  }

  Future<Map<String, dynamic>> request(String type, Map<String, dynamic> payload) {
    if (_retired) return Future.error(StateError('Engine retired'));
    final sequence = _sequence;
    final value = validateHostRequest({'version': hostContractVersion, 'session': session,
      'sequence': sequence, 'id': 'request:$sequence', 'type': type, 'payload': payload});
    _sequence++;
    final result = _tail.then((_) async {
      if (_retired) throw StateError('Engine retired');
      final text = await _channel.invokeMethod<String>('request', {'token': _token, 'request': jsonEncode(value)});
      if (_retired) throw StateError('Engine retired');
      final reply = jsonDecode(text ?? '') as Map<String, dynamic>;
      if (reply['version'] != hostContractVersion || reply['session'] != session ||
          reply['sequence'] != sequence || reply['requestId'] != value['id'] ||
          !const ['result', 'error'].contains(reply['type']) || reply['payload'] is! Map) {
        throw const FormatException('Invalid engine result');
      }
      return reply;
    });
    // A lost native reply leaves sequence consumption unknown. Retire rather than guess/replay.
    _tail = result.then<void>((_) {}, onError: (Object error, StackTrace stack) {
      _retired = true;
    });
    return result;
  }

  Future<void> dispose() {
    if (_disposal != null) return _disposal!;
    _retired = true;
    return _disposal = _tail.then((_) => _channel.invokeMethod<void>('dispose', {'token': _token}));
  }
}

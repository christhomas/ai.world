import 'dart:convert';
import 'dart:io';
import 'state_engine.dart';
import 'storage/checkpoint_store.dart';

/// Durable hero-state composition. World authority, position and scene/session ports remain open.
class InstalledHeroSession {
  InstalledHeroSession._(this.engine, this.store);
  static final _owned = <String>{};
  final StateEngine engine;
  final CheckpointStore store;
  Future<void> _tail = Future<void>.value();
  Future<void>? _closing;
  bool _closed = false;
  num _renderTime = 0;
  String _lifecycle = 'active';

  static Future<InstalledHeroSession> open(String session, StorageScope scope, {Directory? root,
    WriteFailure? writeFailure}) async {
    if (scope.domain != 'player') throw ArgumentError('Hero checkpoints require player scope');
    final store = await CheckpointStore.open(root ?? Directory(await StateEngine.storageRoot()), scope, failure: writeFailure);
    if (!_owned.add(store.directory.path)) {
      throw const StorageFailure(StorageError.conflict, 'Hero slot already has an owner');
    }
    try {
      final saved = await store.load('hero');
      Object? hero;
      if (saved != null) {
        if (saved is! Map || saved['format'] != 'hero-state' || saved['schema'] != 1 || saved['hero'] is! Map) {
          throw const StorageFailure(StorageError.schema, 'Unsupported hero checkpoint; preserve this slot');
        }
        hero = saved['hero'];
      }
      final engine = await StateEngine.open(session, savedHero: hero);
      final owner = InstalledHeroSession._(engine, store);
      try {
        owner._presentation(await engine.request('start', {'mode': 'local', 'world': scope.world}));
        return owner;
      } catch (_) {
        await engine.dispose();
        rethrow;
      }
    } catch (_) {
      _owned.remove(store.directory.path);
      rethrow;
    }
  }

  Map<String, dynamic> _presentation(Map<String, dynamic> reply) {
    if (reply['type'] != 'result') throw StateError('Hero request failed: ${reply['payload']}');
    final state = Map<String, dynamic>.from(reply['payload']['state'] as Map);
    _renderTime = state['renderTimeMs'] as num;
    return Map<String, dynamic>.from(state['models']['hero'] as Map);
  }

  Future<T> _serial<T>(Future<T> Function() operation) {
    final pending = _tail.then((_) => operation());
    _tail = pending.then<void>((_) {}, onError: (Object error, StackTrace stack) {});
    return pending;
  }

  Future<Map<String, dynamic>> request(String type, Map<String, dynamic> payload) {
    if (_closed || _closing != null) return Future.error(StateError('Hero session closing or retired'));
    if (!const ['action', 'step', 'lifecycle', 'resync'].contains(type)) {
      return Future.error(ArgumentError('Session owns start and disposal'));
    }
    final snapshot = jsonDecode(jsonEncode(payload)) as Map<String, dynamic>;
    return _serial(() async {
      final hero = _presentation(await engine.request(type, snapshot));
      if (type == 'lifecycle') _lifecycle = snapshot['state'] as String;
      return hero;
    });
  }

  Future<void> _checkpoint() async {
    final hero = _presentation(await engine.request('resync', {'reason': 'hero-checkpoint'}));
    // JSON is detached before disk work; a future VM frame cannot mutate this accepted snapshot.
    await store.commit('hero', jsonDecode(jsonEncode({'format': 'hero-state', 'schema': 1, 'hero': hero})));
    await store.flush();
  }

  Future<void> save() {
    if (_closed || _closing != null) return Future.error(StateError('Hero session closing or retired'));
    return _serial(_checkpoint);
  }

  /// Storage failure permits retry. A retired engine releases its slot for prior-file recovery.
  Future<void> close() {
    if (_closing != null) return _closing!;
    if (_closed) return Future<void>.value();
    return _closing = _serial(() async {
      try {
        _presentation(await engine.request('lifecycle', {'state': 'background', 'renderTimeMs': _renderTime}));
        await _checkpoint();
        _closed = true;
        await engine.dispose();
        _owned.remove(store.directory.path);
      } catch (error, stack) {
        if (!_closed && !engine.isRetired) {
          try { await engine.request('lifecycle', {'state': _lifecycle, 'renderTimeMs': _renderTime}); }
          catch (_) { /* The engine fences an uncertain transport failure itself. */ }
        }
        if (engine.isRetired) {
          _closed = true;
          try { await engine.dispose(); }
          catch (_) { /* Report the original failure; the host also releases owners on detach. */ }
          _owned.remove(store.directory.path);
        } else if (!_closed) {
          _closing = null;
        }
        Error.throwWithStackTrace(error, stack);
      }
    });
  }
}

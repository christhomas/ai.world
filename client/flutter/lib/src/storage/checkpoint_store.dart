import 'dart:async';
import 'dart:convert';
import 'dart:io';

enum StorageError { invalid, io, quota, corrupt, schema, conflict }
enum WriteStage { beforeStage, afterStageFlush, afterBackup, beforeCommit }

class StorageFailure implements Exception {
  const StorageFailure(this.code, this.message);
  final StorageError code;
  final String message;
  @override
  String toString() => 'StorageFailure($code): $message';
}

/// Namespace metadata, not a second implementation of SessionSave or GameState.
class StorageScope {
  const StorageScope({required this.domain, required this.world, required this.seed,
    required this.player, this.kind = 'endless'});
  final String domain, world, player, kind;
  final int seed;
  Map<String, Object> get json => {'domain': domain, 'world': world, 'seed': seed, 'player': player, 'kind': kind};
  void validate() {
    if (!['player', 'world', 'settings', 'identity'].contains(domain) ||
        world.isEmpty || world.length > 48 || player.isEmpty || player.length > 48 ||
        world.codeUnits.any((c) => c < 32 || c > 127) || player.codeUnits.any((c) => c < 32 || c > 127) ||
        !['road', 'endless', 'mesh'].contains(kind) || seed < 0 || seed > 0xffffffff) {
      throw const StorageFailure(StorageError.invalid, 'Invalid world/player storage scope');
    }
  }
}

class Checkpoint {
  const Checkpoint(this.value, this.revision, {this.recovered = false});
  final Object? value;
  final int revision;
  final bool recovered;
}

typedef WriteFailure = FutureOr<void> Function(WriteStage stage);

/// Caller supplies an app-private directory. Never use a downloads/shared directory.
/// One owner per namespace; all operations on this instance are serialized.
class CheckpointStore {
  CheckpointStore._(this.directory, this.scope, this.failure);
  final Directory directory;
  final StorageScope scope;
  final WriteFailure? failure;
  Future<void> _tail = Future<void>.value();
  StorageFailure? _writeFailure;

  static Future<CheckpointStore> open(Directory root, StorageScope scope, {WriteFailure? failure}) async {
    scope.validate();
    try {
      if (await FileSystemEntity.type(root.path, followLinks: false) == FileSystemEntityType.link) {
        throw const StorageFailure(StorageError.invalid, 'App-private root must not be a symlink');
      }
      await root.create(recursive: true);
      final canonical = await root.resolveSymbolicLinks();
      final encoded = base64Url.encode(utf8.encode(jsonEncode([scope.world, scope.seed, scope.player, scope.kind]))).replaceAll('=', '');
      final directory = Directory('$canonical/${scope.domain}-$encoded');
      if (await FileSystemEntity.type(directory.path, followLinks: false) == FileSystemEntityType.link) {
        throw const StorageFailure(StorageError.invalid, 'Namespace must not be a symlink');
      }
      await directory.create();
      return CheckpointStore._(directory, scope, failure);
    } on FileSystemException catch (error) {
      throw _io(error);
    }
  }

  void _key(String key) {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,80}$').hasMatch(key)) {
      throw const StorageFailure(StorageError.invalid, 'Slot/record key contains unsafe characters');
    }
  }

  Future<void> _paths(String key) async {
    _key(key);
    if (await FileSystemEntity.type(directory.path, followLinks: false) != FileSystemEntityType.directory ||
        await directory.resolveSymbolicLinks() != directory.path) {
      throw const StorageFailure(StorageError.invalid, 'Namespace directory changed');
    }
    for (final suffix in ['json', 'previous', 'staged', 'backup-staged', 'lock']) {
      final type = await FileSystemEntity.type('${directory.path}/$key.$suffix', followLinks: false);
      if (type != FileSystemEntityType.notFound && type != FileSystemEntityType.file) {
        throw const StorageFailure(StorageError.invalid, 'Unsafe checkpoint path');
      }
    }
  }

  Future<T> _serial<T>(String key, Future<T> Function() operation, {bool writing = false}) {
    final pending = _tail.then((_) async {
      RandomAccessFile? lock;
      var locked = false;
      try {
        await _paths(key);
        lock = await File('${directory.path}/$key.lock').open(mode: FileMode.append);
        // Nonblocking lock: a competing process is an observable I/O error, never a lost update.
        await lock.lock(FileLock.exclusive);
        locked = true;
        await _paths(key);
        return await operation();
      } on FileSystemException catch (error) {
        throw _io(error);
      } finally {
        if (locked) await lock!.unlock();
        await lock?.close();
      }
    });
    _tail = pending.then<void>((_) {}, onError: (Object error, StackTrace stack) {
      if (writing) {
        _writeFailure = error is StorageFailure ? error : StorageFailure(StorageError.io, '$error');
      }
    });
    return pending;
  }

  Future<Object?> load(String key) async => (await inspect(key))?.value;
  Future<Checkpoint?> inspect(String key) => _serial(key, () => _load(key));

  Future<Checkpoint?> _load(String key) async {
    final current = File('${directory.path}/$key.json');
    final previous = File('${directory.path}/$key.previous');
    if (!await current.exists()) {
      return await previous.exists() ? _read(previous, key, recovered: true) : null;
    }
    try {
      return await _read(current, key);
    } on StorageFailure catch (error) {
      // A future schema is not corruption: older code must never roll it back.
      if (error.code != StorageError.corrupt || !await previous.exists()) rethrow;
      return _read(previous, key, recovered: true);
    }
  }

  Future<Checkpoint> _read(File file, String key, {bool recovered = false}) async {
    final bytes = await file.readAsBytes();
    try {
      final text = utf8.decode(bytes);
      final envelope = jsonDecode(text) as Map<String, dynamic>;
      if (envelope['schema'] is! int || envelope['contract'] is! int ||
          (envelope['schema'] as int) < 1 || (envelope['contract'] as int) < 1) {
        throw const FormatException('Missing or malformed schema metadata');
      }
      if (envelope['schema'] != 1 || envelope['contract'] != 1) {
        throw const StorageFailure(StorageError.schema, 'Unsupported checkpoint schema/host contract; preserve this file');
      }
      if (envelope.length != 4 || envelope['body'] is! String || envelope['checksum'] is! String) {
        throw const FormatException('Malformed envelope');
      }
      final body = envelope['body'] as String;
      if (_checksum(body) != envelope['checksum']) throw const FormatException('Checksum mismatch');
      final record = jsonDecode(body) as Map<String, dynamic>;
      if (record.length != 4 || record['key'] != key || jsonEncode(record['scope']) != jsonEncode(scope.json) ||
          record['revision'] is! int || (record['revision'] as int) < 1 || !record.containsKey('value')) {
        throw const FormatException('Invalid checkpoint metadata or scope');
      }
      _json(record['value']);
      return Checkpoint(record['value'], record['revision'] as int, recovered: recovered);
    } on StorageFailure {
      rethrow;
    } catch (error) {
      throw StorageFailure(StorageError.corrupt, '${file.path}: $error');
    }
  }

  Future<void> commit(String key, Object? value) {
    Object? snapshot;
    try {
      _key(key);
      _json(value);
      snapshot = jsonDecode(jsonEncode(value));
    } on StorageFailure catch (error) {
      return Future<void>.error(error);
    }
    return _write(key, snapshot);
  }

  Future<void> _write(String key, Object? value, {int? replaceRevision, bool importing = false}) {
    final pending = _serial<void>(key, () async {
      final previous = await _load(key);
      if (importing && previous != null && replaceRevision != previous.revision) {
        throw const StorageFailure(StorageError.conflict, 'Replacing a checkpoint requires its current revision confirmation');
      }
      final revision = (previous?.revision ?? 0) + 1;
      final body = jsonEncode({'scope': scope.json, 'key': key, 'revision': revision, 'value': value});
      final envelope = jsonEncode({'schema': 1, 'contract': 1, 'body': body, 'checksum': _checksum(body)});
      final current = File('${directory.path}/$key.json');
      final staged = File('${directory.path}/$key.staged');
      await failure?.call(WriteStage.beforeStage);
      await staged.writeAsString(envelope, flush: true);
      await failure?.call(WriteStage.afterStageFlush);
      if (previous != null && !previous.recovered) {
        final backup = File('${directory.path}/$key.backup-staged');
        await backup.writeAsBytes(await current.readAsBytes(), flush: true);
        await backup.rename('${directory.path}/$key.previous');
      }
      await failure?.call(WriteStage.afterBackup);
      await failure?.call(WriteStage.beforeCommit);
      await _paths(key);
      await staged.rename(current.path);
      _writeFailure = null;
    }, writing: true);
    return pending.catchError((Object error) {
      final reported = error is StorageFailure ? error : StorageFailure(StorageError.io, '$error');
      _writeFailure = reported;
      throw reported;
    });
  }

  /// Abandoning an awaiting caller does not cancel queued disk writes.
  Future<void> flush() async {
    await _tail;
    if (_writeFailure != null) throw _writeFailure!;
  }

  /// Export payload uses the existing JSON format, without storage envelope metadata.
  Future<String> exportData(String key) async {
    final checkpoint = await inspect(key);
    if (checkpoint == null) throw const StorageFailure(StorageError.invalid, 'No checkpoint to export');
    return jsonEncode(checkpoint.value);
  }

  Future<void> importData(String key, String text, {int? replaceRevision}) {
    try {
      final value = jsonDecode(text);
      _json(value);
      return _write(key, value, replaceRevision: replaceRevision, importing: true);
    } catch (error) {
      return Future<void>.error(StorageFailure(StorageError.invalid, 'Import is not structured JSON: $error'));
    }
  }
}

void _json(Object? value, [int depth = 0]) {
  if (depth > 32) throw const StorageFailure(StorageError.invalid, 'JSON exceeds host contract depth');
  if (value == null || value is String || value is bool || value is num && value.isFinite) return;
  if (value is List) {
    for (final item in value) { _json(item, depth + 1); }
    return;
  }
  if (value is Map && value.keys.every((key) => key is String)) {
    for (final item in value.values) { _json(item, depth + 1); }
    return;
  }
  throw const StorageFailure(StorageError.invalid, 'Value is not host-contract JSON');
}

StorageFailure _io(FileSystemException error) => StorageFailure(
  [28, 122].contains(error.osError?.errorCode) ? StorageError.quota : StorageError.io, error.toString());

// Corruption detector only, not an authenticity/security signature.
String _checksum(String body) {
  var hash = 0x811c9dc5;
  for (final byte in utf8.encode(body)) { hash = ((hash ^ byte) * 0x01000193) & 0xffffffff; }
  return hash.toRadixString(16).padLeft(8, '0');
}

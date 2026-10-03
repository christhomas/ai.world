import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

enum WorldTransportState { offline, connecting, ready, retrying }

class WorldTransportStatus {
  const WorldTransportStatus(this.state, this.message, {this.retryAfter});
  final WorldTransportState state;
  final String message;
  final Duration? retryAfter;
}

/// A native transport for src/net/link.ts's string | ArrayBuffer parcels.
/// Online owns joining, identity, protocol validation and authority. Reconnect is
/// opt-in so a host running Online does not start a second retry loop.
class WorldSocketConfig {
  WorldSocketConfig({
    required this.endpoint,
    this.allowInsecureDevelopment = false,
    this.automaticReconnect = false,
    this.connectTimeout = const Duration(seconds: 6),
    this.firstRetry = const Duration(seconds: 1),
    this.maxRetry = const Duration(seconds: 30),
    this.pingInterval = const Duration(seconds: 15),
    this.maxQueuedParcels = 64,
    this.maxQueuedBytes = 1048576,
    this.maxParcelBytes = 1048576,
  }) {
    final address = InternetAddress.tryParse(endpoint.host);
    final bytes = address?.rawAddress;
    final privateAddress = address?.isLoopback == true ||
        (bytes != null && bytes.length == 4 && (bytes[0] == 10 ||
          (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
          (bytes[0] == 192 && bytes[1] == 168))) ||
        (bytes != null && bytes.length == 16 && ((bytes[0] & 0xfe) == 0xfc ||
          (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80)));
    final developmentHost = endpoint.host == 'localhost' || endpoint.host.endsWith('.local') || privateAddress;
    if (endpoint.host.isEmpty || endpoint.userInfo.isNotEmpty || endpoint.hasFragment ||
        (endpoint.scheme != 'wss' && !(endpoint.scheme == 'ws' && allowInsecureDevelopment && developmentHost))) {
      throw ArgumentError('Use WSS; cleartext local/LAN sockets require explicit development opt-in.');
    }
    if (connectTimeout <= Duration.zero || firstRetry <= Duration.zero || maxRetry < firstRetry ||
        maxQueuedParcels < 1 || maxQueuedBytes < 1 || maxParcelBytes < 1) {
      throw ArgumentError('Transport timeout, retry and parcel limits must be positive.');
    }
  }

  final Uri endpoint;
  final bool allowInsecureDevelopment, automaticReconnect;
  final Duration connectTimeout, firstRetry, maxRetry;
  final Duration? pingInterval;
  final int maxQueuedParcels, maxQueuedBytes, maxParcelBytes;
}

class _Write {
  _Write(this.parcel, this.bytes);
  final Object parcel;
  final int bytes;
  final done = Completer<void>();
}

class NativeWorldSocketLink {
  NativeWorldSocketLink({required this.config, required this.onOpen,
    required this.onMessage, required this.onClose, required this.onStatus});

  final WorldSocketConfig config;
  final void Function() onOpen;
  final void Function(Object parcel) onMessage;
  final void Function(String reason) onClose;
  final void Function(WorldTransportStatus status) onStatus;
  WebSocket? _socket;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retry;
  final _writes = ListQueue<_Write>();
  _Write? _activeWrite;
  int _generation = 0, _failures = 0, _queuedBytes = 0;
  bool _wanted = false;
  bool get ready => _socket?.readyState == WebSocket.open;
  int get generation => _generation;

  /// Start one session. Construct a new link for a different endpoint/session.
  Future<void> start() async {
    if (_wanted) throw StateError('The world link is already started.');
    _wanted = true;
    _failures = 0;
    await _connect(++_generation);
  }

  bool _current(int generation) => _wanted && generation == _generation;

  Future<void> _connect(int generation) async {
    if (!_current(generation)) return;
    onStatus(const WorldTransportStatus(WorldTransportState.connecting, 'Connecting to the world.'));
    if (!_current(generation)) return;
    final connecting = WebSocket.connect(config.endpoint.toString());
    // timeout does not cancel the OS handshake; dispose a socket that arrives late.
    unawaited(connecting.then<void>((socket) {
      if (!_current(generation)) unawaited(socket.close());
    }, onError: (Object error, StackTrace stack) {}));
    try {
      final socket = await connecting.timeout(config.connectTimeout);
      if (!_current(generation)) { await socket.close(); return; }
      socket.pingInterval = config.pingInterval;
      _socket = socket;
      _subscription = socket.listen((dynamic parcel) {
        if (!_current(generation)) return;
        final Object data;
        if (parcel is String) {
          data = parcel;
        } else if (parcel is List<int>) {
          data = Uint8List.fromList(parcel);
        } else {
          _lost(generation, 'The world sent an unsupported transport parcel.'); return;
        }
        final length = data is String ? utf8.encode(data).length : (data as Uint8List).length;
        if (length > config.maxParcelBytes) {
          _lost(generation, 'The world sent a parcel larger than the transport limit.'); return;
        }
        onMessage(data);
      }, onDone: () => _lost(generation, 'Disconnected from the world.'),
        onError: (Object error) => _lost(generation, 'The connection to the world failed.'), cancelOnError: true);
      onStatus(const WorldTransportStatus(WorldTransportState.ready, 'Connected to the world transport.'));
      if (_current(generation)) onOpen();
    } on TimeoutException {
      _lost(generation, 'The world connection timed out.');
    } catch (_) {
      _lost(generation, 'Could not reach the world server.');
    }
  }

  /// No writes are accepted while disconnected and none survive reconnection.
  /// Completion means accepted by the socket sink, not confirmed by the server.
  Future<void> send(Object parcel) {
    if (!ready) return Future.error(StateError('The world link is not ready.'));
    final Object owned;
    final int size;
    if (parcel is String) { owned = parcel; size = utf8.encode(parcel).length; }
    else if (parcel is Uint8List) { owned = parcel; size = parcel.length; }
    else { return Future.error(ArgumentError('A world parcel must be text or Uint8List.')); }
    if (size > config.maxParcelBytes || _writes.length + (_activeWrite == null ? 0 : 1) >= config.maxQueuedParcels ||
        _queuedBytes + size > config.maxQueuedBytes) {
      return Future.error(StateError('The world transport send queue is full.'));
    }
    final write = _Write(owned is Uint8List ? Uint8List.fromList(owned) : owned, size);
    _queuedBytes += size;
    _writes.add(write);
    if (_activeWrite == null) unawaited(_flush(_socket!, _generation));
    return write.done.future;
  }

  Future<void> _flush(WebSocket socket, int generation) async {
    while (_current(generation) && _writes.isNotEmpty) {
      final write = _writes.removeFirst();
      _activeWrite = write;
      try {
        await socket.addStream(Stream<Object>.value(write.parcel));
        if (_current(generation) && !write.done.isCompleted) write.done.complete();
      } catch (_) { _lost(generation, 'The world could not receive the parcel.'); }
      if (!_current(generation)) return;
      _queuedBytes -= write.bytes;
      _activeWrite = null;
    }
  }

  void _failWrites() {
    final active = _activeWrite;
    if (active != null && !active.done.isCompleted) active.done.completeError(StateError('The world session ended before the parcel was sent.'));
    for (final write in _writes) {
      if (!write.done.isCompleted) write.done.completeError(StateError('The world session ended before the parcel was sent.'));
    }
    _writes.clear(); _activeWrite = null; _queuedBytes = 0;
  }

  void _lost(int generation, String reason) {
    if (!_current(generation)) return;
    _generation++;
    final socket = _socket; _socket = null;
    unawaited(_subscription?.cancel()); _subscription = null;
    if (socket != null) unawaited(socket.close());
    _failWrites();
    onClose(reason);
    if (!_wanted) return;
    if (!config.automaticReconnect) {
      _wanted = false;
      onStatus(WorldTransportStatus(WorldTransportState.offline, reason));
      return;
    }
    // Bounded exponential delay; successful TCP opens alone do not reset a flapping session.
    final multiplier = 1 << (_failures < 20 ? _failures : 20);
    _failures++;
    final micros = config.firstRetry.inMicroseconds * multiplier;
    final delay = Duration(microseconds: micros < config.maxRetry.inMicroseconds ? micros : config.maxRetry.inMicroseconds);
    final next = _generation;
    _retry = Timer(delay, () { if (_current(next)) unawaited(_connect(next)); });
    onStatus(WorldTransportStatus(WorldTransportState.retrying, reason, retryAfter: delay));
  }

  /// The shared engine can reset backoff after its join is accepted.
  void admitted() { _failures = 0; }

  /// Manual leave fences callbacks immediately and disables every pending retry.
  Future<void> close() async {
    _wanted = false; _generation++;
    _retry?.cancel(); _retry = null;
    final socket = _socket; _socket = null;
    final subscription = _subscription; _subscription = null;
    _failWrites();
    onStatus(const WorldTransportStatus(WorldTransportState.offline, 'Left the world.'));
    await subscription?.cancel();
    await socket?.close();
  }
}

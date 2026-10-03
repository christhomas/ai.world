import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_world_flutter/src/chunk_parcel.dart';
import 'package:ai_world_flutter/src/network/world_socket_link.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _until(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 4));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) fail('Socket precondition did not arrive.');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

WorldSocketConfig _config(HttpServer server, {bool retry = false, Duration timeout = const Duration(seconds: 1), int maxBytes = 1048576, int maxParcels = 64}) =>
    WorldSocketConfig(endpoint: Uri.parse('ws://127.0.0.1:${server.port}/world'),
      allowInsecureDevelopment: true, automaticReconnect: retry, connectTimeout: timeout,
      firstRetry: const Duration(milliseconds: 20), maxRetry: const Duration(milliseconds: 40),
      maxQueuedBytes: maxBytes, maxQueuedParcels: maxParcels);

NativeWorldSocketLink _link(WorldSocketConfig config, {void Function()? opened,
  void Function(Object)? message, void Function(String)? closed,
  void Function(WorldTransportStatus)? status}) => NativeWorldSocketLink(
    config: config, onOpen: opened ?? () {}, onMessage: message ?? (_) {},
    onClose: closed ?? (_) {}, onStatus: status ?? (_) {});

Uint8List _chunk() {
  const tiles = 18 * 18;
  final bytes = Uint8List(20 + tiles * 36);
  final data = ByteData.sublistView(bytes);
  for (final entry in <int, int>{0: 2, 1: 3, 2: -2, 3: 18, 4: 0}.entries) {
    data.setInt32(entry.key * 4, entry.value, Endian.little);
  }
  data.setFloat32(20, 7.25, Endian.little);
  return bytes;
}

void main() {
  test('production requires WSS and explicit local or LAN development opt-in', () {
    expect(WorldSocketConfig(endpoint: Uri.parse('wss://world.example/world')).endpoint.scheme, 'wss');
    for (final endpoint in ['ws://127.0.0.1/world', 'ws://192.168.1.2/world', 'https://world.example/world']) {
      expect(() => WorldSocketConfig(endpoint: Uri.parse(endpoint)), throwsArgumentError);
    }
    expect(WorldSocketConfig(endpoint: Uri.parse('ws://192.168.1.2/world'), allowInsecureDevelopment: true).endpoint.host, '192.168.1.2');
    expect(() => WorldSocketConfig(endpoint: Uri.parse('ws://public.example/world'), allowInsecureDevelopment: true), throwsArgumentError);
    expect(() => WorldSocketConfig(endpoint: Uri.parse('wss://operator:secret@world.example/world')), throwsArgumentError);
  });

  test('actual sockets preserve ordered text and binary ground parcels without interpreting payloads', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final peers = <WebSocket>[];
    addTearDown(() async { for (final peer in peers) { await peer.close(); } await server.close(force: true); });
    server.listen((request) async {
      final peer = await WebSocketTransformer.upgrade(request); peers.add(peer);
      peer.listen(peer.add);
    });
    final heard = <Object>[];
    final link = _link(_config(server), message: heard.add);
    addTearDown(link.close);
    await expectLater(link.send('unready'), throwsStateError);
    await link.start();
    expect(link.ready, isTrue);
    final chunk = _chunk();
    expect(ChunkParcel.decode(chunk), isNotNull);
    await link.send('{"type":"join","version":25,"playerId":"same-player"}');
    await link.send(chunk);
    await link.send('deliberately malformed JSON');
    await link.send(Uint8List.fromList([2, 0]));
    await _until(() => heard.length == 4);
    expect(heard.first, '{"type":"join","version":25,"playerId":"same-player"}');
    expect(heard[1], isA<Uint8List>());
    expect(heard[1], orderedEquals(chunk));
    final decoded = ChunkParcel.decode(heard[1] as Uint8List)!;
    expect((decoded.cx, decoded.cz, decoded.height.first), (3, -2, 7.25));
    expect(heard[2], 'deliberately malformed JSON');
    expect(heard[3], orderedEquals([2, 0]));
    expect(ChunkParcel.decode(heard[3] as Uint8List), isNull);
  });

  test('handshake rejection retries with bounded backoff and exposes a player-facing reason', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final peers = <WebSocket>[];
    addTearDown(() async { for (final peer in peers) { await peer.close(); } await server.close(force: true); });
    var requests = 0;
    server.listen((request) async {
      requests++;
      if (requests <= 2) { request.response.statusCode = 403; await request.response.close(); }
      else { peers.add(await WebSocketTransformer.upgrade(request)); }
    });
    final statuses = <WorldTransportStatus>[];
    final reasons = <String>[];
    final link = _link(_config(server, retry: true), status: statuses.add, closed: reasons.add);
    addTearDown(link.close);
    await link.start();
    await _until(() => link.ready);
    expect(requests, 3);
    expect(reasons, hasLength(2));
    expect(reasons.every((reason) => reason.isNotEmpty), isTrue);
    final waits = statuses.where((s) => s.state == WorldTransportState.retrying).map((s) => s.retryAfter).toList();
    expect(waits, [const Duration(milliseconds: 20), const Duration(milliseconds: 40)]);
  });

  test('network loss reconnects without replaying economic writes and manual leave stops retry', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final peers = <WebSocket>[];
    final received = <String>[];
    addTearDown(() async { for (final peer in peers) { await peer.close(); } await server.close(force: true); });
    server.listen((request) async {
      final peer = await WebSocketTransformer.upgrade(request); peers.add(peer);
      peer.listen((dynamic message) { received.add(message as String); });
    });
    var opened = 0;
    final link = _link(_config(server, retry: true), opened: () { opened++; });
    addTearDown(link.close);
    await link.start();
    await _until(() => peers.length == 1);
    await link.send('{"type":"buy","item":"apple"}');
    await _until(() => received.length == 1);
    await peers.first.close();
    await _until(() => opened == 2 && peers.length == 2);
    expect(received, ['{"type":"buy","item":"apple"}']);
    await link.close();
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(opened, 2);
    expect(link.ready, isFalse);
    await expectLater(link.send('after leave'), throwsStateError);
  });

  test('late handshake from a timed-out session cannot publish messages into its replacement', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final delayed = Completer<HttpRequest>();
    final release = Completer<void>();
    final peers = <WebSocket>[];
    var requests = 0;
    addTearDown(() async { if (!release.isCompleted) release.complete(); for (final peer in peers) { await peer.close(); } await server.close(force: true); });
    server.listen((request) async {
      requests++;
      final first = requests == 1;
      if (first) { delayed.complete(request); await release.future; }
      try {
        final peer = await WebSocketTransformer.upgrade(request); peers.add(peer);
        peer.add(first ? 'old session' : 'current session');
        peer.listen((dynamic _) {}, onError: (Object _) {});
      } catch (_) { /* The timed-out transport may already have closed the handshake. */ }
    });
    final heard = <Object>[];
    final reasons = <String>[];
    final link = _link(_config(server, timeout: const Duration(milliseconds: 80)), message: heard.add, closed: reasons.add);
    addTearDown(link.close);
    await link.start();
    await delayed.future;
    expect(reasons, ['The world connection timed out.']);
    final oldGeneration = link.generation;
    await link.start();
    await _until(() => heard.isNotEmpty);
    release.complete();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(link.generation, greaterThan(oldGeneration));
    expect(heard, ['current session']);
  });

  test('actual-socket outgoing queues reject excess bytes and parcels before unbounded buffering', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    WebSocket? peer;
    addTearDown(() async { await peer?.close(); await server.close(force: true); });
    server.listen((request) async { peer = await WebSocketTransformer.upgrade(request); peer!.listen((dynamic _) {}); });
    final link = _link(_config(server, maxBytes: 4, maxParcels: 1));
    addTearDown(link.close);
    await link.start();
    await expectLater(link.send('12345'), throwsStateError);
    final first = link.send('a');
    await expectLater(link.send('b'), throwsStateError);
    await first;
    await expectLater(link.send(<int>[1]), throwsArgumentError);
  });
}

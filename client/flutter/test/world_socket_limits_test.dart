import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:ai_world_flutter/src/network/world_socket_link.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _until(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 4));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) fail('Real socket precondition did not arrive');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

NativeWorldSocketLink _link(int port, List<Object> heard, List<String> closed,
    {bool retry = false, int limit = 8, Duration timeout = const Duration(seconds: 2)}) => NativeWorldSocketLink(
  config: WorldSocketConfig(endpoint: Uri.parse('ws://127.0.0.1:$port/world'),
    allowInsecureDevelopment: true, automaticReconnect: retry, maxParcelBytes: limit,
    connectTimeout: timeout, firstRetry: const Duration(milliseconds: 20),
    maxRetry: const Duration(milliseconds: 40), pingInterval: null),
  onOpen: () {}, onMessage: heard.add, onClose: closed.add, onStatus: (_) {},
);

// The SDK performs the real server handshake. Capture its detached socket only
// so the server fixture can send valid fragmentation and malicious frame headers.
class _WireRequest implements HttpRequest {
  _WireRequest(this.request, this.capture);
  final HttpRequest request;
  final void Function(Socket) capture;
  @override
  String get method => request.method;
  @override
  HttpHeaders get headers => request.headers;
  @override
  HttpResponse get response => _WireResponse(request.response, capture);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
class _WireResponse implements HttpResponse {
  _WireResponse(this.response, this.capture);
  final HttpResponse response;
  final void Function(Socket) capture;
  @override
  HttpHeaders get headers => response.headers;
  @override
  set statusCode(int value) { response.statusCode = value; }
  @override
  Future<Socket> detachSocket({bool writeHeaders = true}) async {
    final socket = await response.detachSocket(writeHeaders: writeHeaders);
    capture(socket);
    return socket;
  }
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  for (final retry in [false, true]) {
    test('stalled upgrade releases its underlying connection; retry=$retry', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final sockets = <Socket>[];
      var active = 0, ended = 0, maximum = 0, requests = 0;
      addTearDown(() async { for (final socket in sockets) { socket.destroy(); } await server.close(); });
      server.listen((socket) {
        sockets.add(socket); active++;
        if (active > maximum) maximum = active;
        var received = '', counted = false;
        socket.listen((bytes) {
          received += utf8.decode(bytes);
          if (!counted && received.startsWith('GET /world ')) { requests++; counted = true; }
        },
          onDone: () { active--; ended++; socket.destroy(); });
        // Intentionally never send the HTTP upgrade response.
      });
      final reasons = <String>[];
      final link = _link(server.port, [], reasons, retry: retry, timeout: const Duration(milliseconds: 80));
      addTearDown(link.close);
      await link.start();
      await _until(() => ended >= (retry ? 3 : 1));
      expect(requests, greaterThanOrEqualTo(retry ? 3 : 1));
      expect(maximum, 1);
      expect(reasons.every((reason) => reason == 'The world connection timed out.'), true);
      await link.close();
      await _until(() => active == 0);
      final attempts = sockets.length;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(sockets.length, attempts);
    });
  }

  test('manual leave aborts a handshake before its timeout', () async {
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final accepted = Completer<Socket>();
    final requestSeen = Completer<void>(), disconnected = Completer<void>();
    addTearDown(() async { if (accepted.isCompleted) (await accepted.future).destroy(); await server.close(); });
    server.listen((socket) {
      accepted.complete(socket);
      socket.listen((_) { if (!requestSeen.isCompleted) requestSeen.complete(); },
        onDone: () { disconnected.complete(); socket.destroy(); });
    });
    final link = NativeWorldSocketLink(
      config: WorldSocketConfig(endpoint: Uri.parse('ws://127.0.0.1:${server.port}/world'),
        allowInsecureDevelopment: true, connectTimeout: const Duration(seconds: 5)),
      onOpen: () => fail('Abandoned handshake opened'), onMessage: (_) => fail('Abandoned message'),
      onClose: (_) => fail('Abandoned handshake emitted a close callback'), onStatus: (_) {},
    );
    addTearDown(link.close);
    final starting = link.start();
    await requestSeen.future.timeout(const Duration(seconds: 2));
    await link.close();
    await disconnected.future.timeout(const Duration(seconds: 2));
    await starting.timeout(const Duration(seconds: 2));
    expect(link.ready, false);
  });

  for (final attack in ['oversized-frame', 'fragment-total', 'uint64-length']) {
    test('raw $attack is rejected before its oversized payload arrives', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final wire = Completer<Socket>();
      WebSocket? peer;
      addTearDown(() async { if (wire.isCompleted) (await wire.future).destroy(); await peer?.close(); await server.close(force: true); });
      server.listen((request) async {
        peer = await WebSocketTransformer.upgrade(_WireRequest(request, wire.complete));
        peer!.listen((_) {}, onError: (Object _) {});
      });
      final heard = <Object>[], reasons = <String>[];
      final link = _link(server.port, heard, reasons);
      addTearDown(link.close);
      await link.start();
      expect(link.ready, true);
      final socket = await wire.future;
      if (attack == 'fragment-total') {
        socket.add([0x02, 5, 1, 2, 3, 4, 5]);
        await socket.flush();
        socket.add([0x80, 4]); // Sum 9 > limit 8; no continuation payload sent.
      } else if (attack == 'uint64-length') {
        socket.add([0x82, 127, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      } else {
        socket.add([0x82, 126, 0, 9]); // Announces size 9 without allocating/sending it.
      }
      await socket.flush();
      await _until(() => reasons.isNotEmpty);
      expect(heard, isEmpty);
      expect(link.ready, false);
    });
  }

  test('valid fragmented messages at the limit retain bytes and reset their budget', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final wire = Completer<Socket>();
    WebSocket? peer;
    addTearDown(() async { if (wire.isCompleted) (await wire.future).destroy(); await peer?.close(); await server.close(force: true); });
    server.listen((request) async {
      peer = await WebSocketTransformer.upgrade(_WireRequest(request, wire.complete));
      peer!.listen((_) {}, onError: (Object _) {});
    });
    final heard = <Object>[];
    final link = _link(server.port, heard, []);
    addTearDown(link.close);
    await link.start();
    expect(link.ready, true);
    final socket = await wire.future;
    // Split a frame's header across TCP writes, then send a separate text message.
    socket.add([0x02]); await socket.flush();
    socket.add([4, 1, 2, 3, 4, 0x80, 4, 5, 6, 7, 8]); await socket.flush();
    await _until(() => heard.length == 1);
    socket.add([0x81, 2, 79, 75]); await socket.flush();
    await _until(() => heard.length == 2);
    expect(heard[0], isA<Uint8List>());
    expect(heard[0], orderedEquals([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(heard[1], 'OK');
    expect(link.ready, true);
  });
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// A per-attempt SDK HTTP client. TLS and WebSocket handshake validation stay in
/// dart:io; only the detached, decrypted byte stream is budgeted before decoding.
/// Compression must be disabled so wire bytes equal uncompressed message bytes.
class BoundedUpgradeClient implements HttpClient {
  BoundedUpgradeClient(this.maxMessageBytes) : _client = HttpClient();
  final int maxMessageBytes;
  final HttpClient _client;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _UpgradeRequest(await _client.openUrl(method, url), maxMessageBytes);
  @override
  void close({bool force = false}) => _client.close(force: force);
  // This adapter is private to WebSocket.connect's documented customClient port.
  // Unexpected SDK HTTP calls fail explicitly rather than bypassing the guard.
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _UpgradeRequest implements HttpClientRequest {
  _UpgradeRequest(this.request, this.limit);
  final HttpClientRequest request;
  final int limit;
  @override
  HttpHeaders get headers => request.headers;
  @override
  Future<HttpClientResponse> close() async => _UpgradeResponse(await request.close(), limit);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _UpgradeResponse implements HttpClientResponse {
  _UpgradeResponse(this.response, this.limit);
  final HttpClientResponse response;
  final int limit;
  @override
  HttpHeaders get headers => response.headers;
  @override
  int get statusCode => response.statusCode;
  @override
  Future<Socket> detachSocket() async => _BudgetSocket(await response.detachSocket(), limit);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _BudgetSocket extends Stream<Uint8List> implements Socket {
  _BudgetSocket(this.socket, int limit) : bytes = socket.transform(_MessageBudget(limit, socket.destroy));
  final Socket socket;
  final Stream<Uint8List> bytes;
  @override
  StreamSubscription<Uint8List> listen(void Function(Uint8List)? onData,
      {Function? onError, void Function()? onDone, bool? cancelOnError}) =>
      bytes.listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  @override
  void add(List<int> data) => socket.add(data);
  @override
  void addError(Object error, [StackTrace? stackTrace]) => socket.addError(error, stackTrace);
  @override
  Future<void> addStream(Stream<List<int>> stream) => socket.addStream(stream);
  @override
  Future<void> flush() => socket.flush();
  @override
  Future<dynamic> close() => socket.close();
  @override
  Future<dynamic> get done => socket.done;
  @override
  void destroy() => socket.destroy();
  @override
  Encoding get encoding => socket.encoding;
  @override
  set encoding(Encoding value) { socket.encoding = value; }
  @override
  void write(Object? object) => socket.write(object);
  @override
  void writeln([Object? object = '']) => socket.writeln(object);
  @override
  void writeAll(Iterable<dynamic> objects, [String separator = '']) => socket.writeAll(objects, separator);
  @override
  void writeCharCode(int charCode) => socket.writeCharCode(charCode);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Retains at most ten header bytes, never payload bytes. Checks each announced
/// frame length and the sum of fragments before forwarding any new payload to
/// the SDK's message accumulator. Control frames do not reset the message budget.
class _MessageBudget extends StreamTransformerBase<Uint8List, Uint8List> {
  _MessageBudget(this.limit, this.abort);
  final int limit;
  final void Function() abort;
  @override
  Stream<Uint8List> bind(Stream<Uint8List> stream) {
    final header = <int>[];
    var remaining = 0, messageBytes = 0;
    var fragmented = false, finalFrame = false, dataFrame = false, failed = false;
    void finish() {
      if (dataFrame) {
        fragmented = !finalFrame;
        if (finalFrame) messageBytes = 0;
      }
      header.clear();
    }
    return stream.transform(StreamTransformer<Uint8List, Uint8List>.fromHandlers(
      handleData: (chunk, sink) {
        if (failed) return;
        try {
          var at = 0;
          while (at < chunk.length) {
            if (remaining != 0) {
              final available = chunk.length - at;
              final consumed = remaining < available ? remaining : available;
              remaining -= consumed; at += consumed;
              if (remaining == 0) finish();
              continue;
            }
            header.add(chunk[at++]);
            if (header.length < 2) continue;
            final short = header[1] & 0x7f;
            final width = short == 126 ? 2 : short == 127 ? 8 : 0;
            if (header.length < 2 + width) continue;
            final opcode = header[0] & 0x0f;
            finalFrame = (header[0] & 0x80) != 0;
            dataFrame = opcode <= 2;
            if ((header[0] & 0x70) != 0 || (header[1] & 0x80) != 0 ||
                ![0, 1, 2, 8, 9, 10].contains(opcode) ||
                (!dataFrame && !finalFrame)) {
              throw const WebSocketException('Invalid uncompressed server frame');
            }
            var length = width == 0 ? short : 0;
            final frameLimit = dataFrame ? limit : 125;
            for (var i = 2; i < header.length; i++) {
              // Check before multiplying, including malicious 64-bit lengths.
              if (length > frameLimit ~/ 256 ||
                  (length == frameLimit ~/ 256 && header[i] > frameLimit % 256)) {
                throw const WebSocketException('World frame exceeds byte limit');
              }
              length = length * 256 + header[i];
            }
            if (length > frameLimit) throw const WebSocketException('World frame exceeds byte limit');
            if (dataFrame) {
              if ((opcode == 0) != fragmented) throw const WebSocketException('Invalid world fragmentation');
              if (opcode != 0) messageBytes = 0;
              if (length > limit - messageBytes) throw const WebSocketException('World message exceeds byte limit');
              messageBytes += length;
            }
            remaining = length;
            if (remaining == 0) finish();
          }
          sink.add(chunk);
        } catch (error, stack) {
          failed = true;
          abort();
          sink.addError(error, stack);
          sink.close();
        }
      },
    ));
  }
}

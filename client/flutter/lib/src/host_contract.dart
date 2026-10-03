import 'dart:typed_data';

/// In-process app contract. Independent of the shared-world network protocol.
const hostContractVersion = 1;
const _maxSafe = 9007199254740991;

Map<String, dynamic> validateHostRequest(dynamic value) {
  Never fail(String code) => throw FormatException(code);
  bool text(dynamic v) => v is String && v.isNotEmpty && v.length <= 256;
  bool integer(dynamic v) => v is num && v.isFinite && v >= 0 && v <= _maxSafe && v == v.truncateToDouble();
  bool finite(dynamic v) => v is num && v.isFinite;
  bool exact(Map<dynamic, dynamic> v, List<String> keys) => v.length == keys.length && keys.every(v.containsKey);
  bool pair(dynamic v) => v is List && v.length == 2 && v.every((dynamic n) => finite(n) && n >= -1 && n <= 1);
  bool json(dynamic v, [int depth = 0]) {
    if (depth > 32) return false;
    if (v == null || v is String || v is bool || finite(v)) return true;
    if (v is List) return v.every((dynamic x) => json(x, depth + 1));
    return v is Map && v.keys.every((dynamic k) => k is String) && v.values.every((dynamic x) => json(x, depth + 1));
  }
  if (value is! Map || !exact(value, ['version', 'session', 'sequence', 'id', 'type', 'payload'])) fail('invalid');
  if (value['version'] != hostContractVersion) fail('version');
  if (!text(value['session']) || !integer(value['sequence']) || !text(value['id']) || value['payload'] is! Map) fail('invalid');
  final p = value['payload'] as Map;
  bool valid;
  switch (value['type']) {
    case 'start': valid = exact(p, ['mode', 'world']) && ['local', 'remote'].contains(p['mode']) && text(p['world']);
    case 'load': valid = exact(p, ['key']) && text(p['key']);
    case 'action': valid = exact(p, ['action', 'target', 'args']) && text(p['action']) && (p['target'] == null || text(p['target'])) && json(p['args']);
    case 'cancel': valid = exact(p, ['requestId']) && text(p['requestId']);
    case 'resync': valid = exact(p, ['reason']) && text(p['reason']);
    case 'dispose': valid = p.isEmpty;
    case 'lifecycle': valid = exact(p, ['state', 'renderTimeMs']) && ['active', 'inactive', 'background'].contains(p['state']) && finite(p['renderTimeMs']) && p['renderTimeMs'] >= 0;
    case 'step':
      final i = p['input'];
      valid = exact(p, ['tick', 'dtSeconds', 'renderTimeMs', 'input']) && integer(p['tick']) && finite(p['dtSeconds']) && p['dtSeconds'] > 0 && p['dtSeconds'] <= 0.1 && finite(p['renderTimeMs']) && p['renderTimeMs'] >= 0 && i is Map && exact(i, ['move', 'look', 'held', 'actions', 'owner', 'busy']) && pair(i['move']) && pair(i['look']) && i['held'] is Map && exact(i['held'] as Map, ['guard', 'run']) && i['held']['guard'] is bool && i['held']['run'] is bool && i['actions'] is List && (i['actions'] as List).every(text) && (i['actions'] as List).toSet().length == (i['actions'] as List).length && ['WORLD', 'BOOK', 'TYPING'].contains(i['owner']) && [null, 'reading', 'talking', 'framing', 'typing'].contains(i['busy']);
    default: valid = false;
  }
  if (!valid) fail('invalid');
  return Map<String, dynamic>.from(value as Map);
}

class HostRequestGate {
  HostRequestGate(this.session);
  final String session;
  int _sequence = 0;
  int _tick = -1;
  num _time = 0;
  bool _disposed = false;
  final Set<String> _ids = {};
  Map<String, dynamic> accept(dynamic value) {
    final r = validateHostRequest(value);
    void require(bool condition, String code) { if (!condition) throw FormatException(code); }
    require(r['session'] == session, 'stale-session');
    require(!_disposed, 'disposed');
    require(r['sequence'] == _sequence && !_ids.contains(r['id']), 'out-of-order');
    final p = r['payload'] as Map;
    if (r['type'] == 'step') {
      require(p['tick'] == _tick + 1 && p['renderTimeMs'] >= _time, 'out-of-order');
      _tick = (p['tick'] as num).toInt(); _time = p['renderTimeMs'] as num;
    }
    if (r['type'] == 'lifecycle') {
      require(p['renderTimeMs'] >= _time, 'out-of-order'); _time = p['renderTimeMs'] as num;
    }
    _ids.add(r['id'] as String); _sequence++;
    if (r['type'] == 'dispose') _disposed = true;
    return r;
  }
}

Uint8List encodeHostScalars(List<double> values) {
  if (values.length > 1048576 || values.any((n) => !n.isFinite)) throw const FormatException('invalid');
  final bytes = Uint8List(16 + values.length * 8);
  final data = ByteData.sublistView(bytes);
  data.setUint32(0, 0x4149574d, Endian.little); data.setUint16(4, 1, Endian.little);
  data.setUint16(6, 8, Endian.little); data.setUint32(8, values.length, Endian.little);
  for (var i = 0; i < values.length; i++) { data.setFloat64(16 + i * 8, values[i], Endian.little); }
  return bytes;
}
List<double> decodeHostScalars(Uint8List bytes) {
  if (bytes.length < 16) throw const FormatException('invalid');
  final data = ByteData.sublistView(bytes);
  final count = data.getUint32(8, Endian.little);
  if (data.getUint32(0, Endian.little) != 0x4149574d || data.getUint16(4, Endian.little) != 1 || data.getUint16(6, Endian.little) != 8 || data.getUint32(12, Endian.little) != 0 || count > 1048576 || bytes.length != 16 + count * 8) throw const FormatException('invalid');
  return List.generate(count, (i) {
    final n = data.getFloat64(16 + i * 8, Endian.little);
    if (!n.isFinite) throw const FormatException('invalid'); return n;
  });
}

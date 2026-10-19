/// A packet is unusable until the engine supplies a fresh full scene.
final class SceneResyncRequired extends FormatException {
  const SceneResyncRequired(super.message);
}

/// Geometry and stable node records for one local engine (or legacy scene-feed connection).
/// Changes are staged and resolved completely before any cache state is committed.
final class SceneGeometryCache {
  Map<String, Map<String, dynamic>> _geometries = {};
  Map<String, Map<String, dynamic>> _nodes = {};
  List<String> _order = [];
  int? _generation;
  bool _needsResync = true;

  int get length => _geometries.length;
  bool get needsResync => _needsResync;

  /// A native reset or rejected submission makes every following delta unsafe.
  void invalidate() { _needsResync = true; }

  T resolve<T>(Map<String, dynamic> json,
      T Function(Map<String, dynamic> frame, List<Map<String, dynamic>> nodes) build) {
    final versioned = json.containsKey('version') || json.containsKey('generation') || _generation != null;
    try {
      final frame = json['frame'] is Map ? Map<String, dynamic>.from(json['frame'] as Map) : json;
      final generation = json['generation'];
      final full = json['full'] == true;
      if (versioned) {
        if (json['version'] != 1 || generation is! int || generation < 1 || json['full'] is! bool) {
          throw const SceneResyncRequired('Invalid scene packet version or generation');
        }
        if (_generation != null && generation <= _generation!) {
          throw const SceneResyncRequired('Stale or out-of-order scene packet');
        }
        if (!full && (_needsResync || generation != (_generation ?? 0) + 1)) {
          throw const SceneResyncRequired('Scene generation gap or reset');
        }
        _matrix((frame['camera'] as Map)['projection']);
        _matrix((frame['camera'] as Map)['world']);
      }
      final geometries = versioned && full ? <String, Map<String, dynamic>>{} : Map.of(_geometries);
      final definitions = json['geometries'];
      if (definitions != null) {
        for (final entry in (definitions as Map).entries) {
          if (versioned && geometries.containsKey(entry.key)) {
            throw SceneResyncRequired('Scene geometry ${entry.key} was redefined');
          }
          geometries[entry.key as String] = Map<String, dynamic>.from(entry.value as Map);
        }
      }
      final released = ((json['released'] as List?) ?? const []).cast<String>().toSet();
      var records = <String, Map<String, dynamic>>{};
      var order = <String>[];
      List<Map<String, dynamic>> nodes;
      if (versioned) {
        records = full ? {} : Map.of(_nodes);
        final touched = <String>{};
        final removed = (json['removed'] as List).cast<String>();
        final changes = (json['changes'] as List).cast<Map>();
        if (full && (removed.isNotEmpty || changes.isNotEmpty || json['order'] == null)) {
          throw const SceneResyncRequired('A full scene must define its complete node inventory');
        }
        for (final key in removed) {
          if (!touched.add(key) || records.remove(key) == null) {
            throw SceneResyncRequired('Unknown or duplicate scene removal $key');
          }
        }
        for (final raw in (frame['nodes'] as List).cast<Map>()) {
          final node = Map<String, dynamic>.from(raw);
          final key = _key(node);
          if (!touched.add(key)) throw SceneResyncRequired('Duplicate scene node $key');
          records[key] = node;
        }
        for (final raw in changes) {
          final change = Map<String, dynamic>.from(raw);
          final key = _key(change);
          if (!touched.add(key) || !records.containsKey(key)) {
            throw SceneResyncRequired('Unknown or duplicate scene change $key');
          }
          if (change.keys.any((key) => !const {'id', 'part', 'world', 'visible', 'instanceMatrices'}.contains(key)) ||
              (!change.containsKey('world') && !change.containsKey('visible') && !change.containsKey('instanceMatrices'))) {
            throw const SceneResyncRequired('Invalid node change');
          }
          records[key] = {...records[key]!, ...change};
        }
        order = json['order'] == null ? List.of(_order) : (json['order'] as List).cast<String>().toList();
        if (order.length != records.length || order.toSet().length != order.length || order.any((key) => !records.containsKey(key))) {
          throw const SceneResyncRequired('Scene order does not match its nodes');
        }
        final parents = <String, int>{};
        nodes = [];
        for (final key in order) {
          final node = records[key]!;
          final parent = node['parent'];
          if (parent != null && (parent is! String || !parents.containsKey(parent))) {
            throw SceneResyncRequired('Unknown or out-of-order parent of $key');
          }
          _matrix(node['world']);
          if (node['kind'] == 'instances' || node.containsKey('instanceMatrices')) {
            final matrices = node['instanceMatrices'];
            if (matrices is! List || matrices.length % 16 != 0 || matrices.any((n) => n is! num || !n.isFinite)) {
              throw const SceneResyncRequired('Invalid instance transforms');
            }
          }
          if (node['visible'] is! bool) throw const SceneResyncRequired('Invalid node visibility');
          nodes.add(_geometry({...node, 'parent': parent == null ? -1 : parents[parent]}, geometries, released));
          parents[key] = nodes.length - 1;
        }
      } else {
        nodes = (frame['nodes'] as List).map((raw) =>
          _geometry(Map<String, dynamic>.from(raw as Map), geometries, released)).toList();
      }
      // Parsing the globals is part of the transaction too.
      final result = build(frame, nodes);
      for (final id in released) { geometries.remove(id); }
      _geometries = geometries;
      if (versioned) {
        _nodes = records;
        _order = order;
        _generation = generation as int;
        _needsResync = false;
      }
      return result;
    } catch (error) {
      if (!versioned) rethrow;
      _needsResync = true;
      if (error is SceneResyncRequired) rethrow;
      throw SceneResyncRequired('Invalid scene packet: $error');
    }
  }

  static String _key(Map<String, dynamic> node) {
    final id = node['id'], part = node['part'];
    if (id is! int || id < 0 || (part != null && (part is! int || part < 0))) {
      throw const SceneResyncRequired('Invalid stable scene node id');
    }
    return part == null ? '$id' : '$id.$part';
  }

  static void _matrix(Object? raw) {
    if (raw is! List || raw.length != 16 || raw.any((n) => n is! num || !n.isFinite)) {
      throw const SceneResyncRequired('Scene matrix must have 16 finite elements');
    }
  }

  static Map<String, dynamic> _geometry(Map<String, dynamic> node,
      Map<String, Map<String, dynamic>> geometries, Set<String> released) {
    final id = node['geometryId'];
    if (id == null) return node;
    final geometry = geometries[id];
    if (geometry == null || released.contains(id)) {
      throw SceneResyncRequired('Frame refers to unknown or released geometry $id');
    }
    return {...node, ...geometry};
  }
}

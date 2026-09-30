import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:convert';

import 'colour.dart';
import 'native_world_renderer.dart';
import 'render_mesh.dart';

/// Dart's consumer of the engine-owned FrameDescription in src/core/scene.ts.
/// The JSON form uses ordinary arrays for typed geometry buffers.
final class SceneFrame {
  factory SceneFrame.fromJson(
    Map<String, dynamic> json, {
    SceneGeometryCache? geometryCache,
  }) {
    final packet = json['frame'] is Map
        ? Map<String, dynamic>.from(json['frame'] as Map)
        : json;
    geometryCache?.accept(json['geometries']);
    final nodes = (packet['nodes'] as List).map((raw) {
      final node = Map<String, dynamic>.from(raw as Map);
      final geometryId = node['geometryId'] as String?;
      if (geometryId == null) return node;
      final geometry = geometryCache?.lookup(geometryId);
      if (geometry == null) {
        throw FormatException('Frame refers to unknown geometry $geometryId');
      }
      return <String, dynamic>{...node, ...geometry};
    }).toList();
    return SceneFrame._(
      camera: Map<String, dynamic>.from(packet['camera'] as Map),
      background: packet['background'] as int?,
      coast: packet['coast'] == null
          ? null
          : Map<String, dynamic>.from(packet['coast'] as Map),
      cutaway: packet['cutaway'] == null
          ? null
          : Map<String, dynamic>.from(packet['cutaway'] as Map),
      season: packet['season'] == null
          ? null
          : SeasonTint.fromJson(
              Map<String, dynamic>.from(packet['season'] as Map),
            ),
      fog: packet['fog'] == null
          ? null
          : Map<String, dynamic>.from(packet['fog'] as Map),
      nodes: nodes,
    );
  }

  const SceneFrame._({
    required this.camera,
    required this.background,
    required this.coast,
    required this.cutaway,
    required this.season,
    required this.fog,
    required this.nodes,
  });

  final Map<String, dynamic> camera;
  final int? background;
  final Map<String, dynamic>? coast;
  final Map<String, dynamic>? cutaway;

  /// Colours every material whose effects name 'season'; null draws them untinted.
  final SeasonTint? season;
  final Map<String, dynamic>? fog;
  final List<Map<String, dynamic>> nodes;
}

/// The frame's season: `FrameDescription.season` in src/core/scene.ts.
///
/// WebGL draws it as a shader uniform, `mix(colour * multiply, snow, frost)`
/// on the unlit colour. Here it is the same sum on the colour baked into each
/// vertex, so the native renderers draw autumn and winter without knowing
/// either exists.
final class SeasonTint {
  const SeasonTint({
    required this.multiply,
    required this.frost,
    required this.snow,
  });

  factory SeasonTint.fromJson(Map<String, dynamic> json) {
    final multiply = _numbers(json['multiply']);
    if (multiply.length != 3) {
      throw const FormatException('Season multiply must have three channels');
    }
    return SeasonTint(
      multiply: multiply,
      frost: (json['frost'] as num?)?.toDouble() ?? 0,
      snow: (json['snow'] as num?)?.toInt() ?? 0xffffff,
    );
  }

  /// Linear, and free to pass one.
  final List<double> multiply;

  /// How far toward [snow] the colour is blended, nought to one.
  final double frost;

  /// sRGB hex, like every other authored colour in the frame.
  final int snow;

  /// One linear colour channel, tinted.
  double apply(double colour, int channel, List<double> snowLinear) =>
      colour * multiply[channel] * (1 - frost) + snowLinear[channel] * frost;

  Map<String, Object> toJson() => <String, Object>{
    'multiply': multiply,
    'frost': frost,
    'snow': snow,
  };
}

/// Keeps immutable mesh data once per WebSocket connection. The server sends
/// each geometry the first time it appears, then subsequent frames only carry
/// its digest plus changing transforms and materials.
final class SceneGeometryCache {
  final Map<String, Map<String, dynamic>> _geometries = {};

  void accept(Object? raw) {
    if (raw == null) return;
    final geometries = Map<String, dynamic>.from(raw as Map);
    for (final entry in geometries.entries) {
      _geometries[entry.key] = Map<String, dynamic>.from(entry.value as Map);
    }
  }

  Map<String, dynamic>? lookup(String id) => _geometries[id];
}

/// Maps the same neutral frame submitted to WebGL and recording onto native buffers.
final class FlutterFramePipeline {
  FlutterFramePipeline(this.renderer);

  final NativeWorldRenderer renderer;
  final Set<String> _mounted = <String>{};
  final Map<String, String> _fingerprints = <String, String>{};

  Future<void> draw(SceneFrame frame) async {
    final camera = frame.camera;
    if (camera['orthographic'] != true) {
      throw UnsupportedError('Flutter supports orthographic scene cameras');
    }
    final projection = _numbers(camera['projection']);
    final world = _numbers(camera['world']);
    if (projection.length != 16 || world.length != 16) {
      throw FormatException('Scene camera matrices must have 16 elements');
    }
    await renderer.setSceneFrame(
      projection: Float32List.fromList(projection),
      world: Float32List.fromList(world),
      background: frame.background ?? 0x080b18,
      fog: frame.fog,
      coast: frame.coast,
      nodes: frame.nodes
          .where(
            (node) =>
                node['kind'] == 'directional' ||
                node['kind'] == 'ambient' ||
                node['kind'] == 'hemisphere' ||
                node['kind'] == 'point',
          )
          .map(nativeLight)
          .toList(),
    );
    if (frame.cutaway case final cutaway?) {
      final hero = _numbers(cutaway['hero']);
      if (hero.length != 3) {
        throw const FormatException('Cutaway hero must have three coordinates');
      }
      await renderer.setCutaway(
        CutawayState(
          enabled: cutaway['enabled'] == true,
          heroX: hero[0],
          heroY: hero[1],
          heroZ: hero[2],
        ),
      );
    } else {
      await renderer.setCutaway(
        const CutawayState(enabled: false, heroX: 0, heroY: 0, heroZ: 0),
      );
    }

    final next = <String>{};
    for (final node in frame.nodes) {
      if (node['visible'] == false) continue;
      final kind = node['kind'];
      if (kind == 'group' ||
          kind == 'ambient' ||
          kind == 'hemisphere' ||
          kind == 'directional' ||
          kind == 'point') {
        continue;
      }
      if (kind == 'prop-batch') {
        throw UnsupportedError(
          'Expand prop batches before submitting a Flutter frame',
        );
      }
      if (kind != 'mesh' && kind != 'instances' && kind != 'points') {
        throw UnsupportedError('Unknown scene node kind: $kind');
      }
      final id = _meshId(node);
      final season = _seasoned(node) ? frame.season : null;
      final fingerprint = jsonEncode(<String, Object?>{
        'geometryId': node['geometryId'],
        // Older/local test fixtures can still supply raw geometry directly.
        if (node['geometryId'] == null) ...{
          'attributes': node['attributes'],
          'indices': node['indices'],
        },
        'world': node['world'],
        'instanceMatrices': node['instanceMatrices'],
        'instanceColours': node['instanceColours'],
        'material': node['material'],
        'visible': node['visible'],
        'kind': kind,
        'castShadow': node['castShadow'],
        'receiveShadow': node['receiveShadow'],
        'renderOrder': node['renderOrder'],
        // baked into the vertices, so a new season is a new upload of what it colours
        'season': season?.toJson(),
      });
      if (!next.add(id)) {
        throw FormatException('Two scene nodes are both named $id');
      }
      if (_fingerprints[id] == fingerprint) continue;
      final mesh = _mesh(
        kind == 'points' ? _expandPoints(node) : node,
        id,
        season,
      );
      if (mesh == null) {
        next.remove(id);
        continue;
      }
      await renderer.putMesh(mesh);
      _fingerprints[id] = fingerprint;
    }
    for (final old in _mounted.difference(next)) {
      await renderer.removeMesh(old);
      _fingerprints.remove(old);
    }
    _mounted
      ..clear()
      ..addAll(next);
  }

  /// The native mesh's name: the node's own id, which it keeps while nodes
  /// before it come and go, and its part where one node was split into
  /// several. Its place in the frame would rename every later mesh whenever
  /// one left the middle, and each of them would be baked and sent again.
  static String _meshId(Map<String, dynamic> node) {
    final id = node['id'];
    if (id is! num) throw const FormatException('Scene node has no id');
    final part = node['part'] as num?;
    return part == null ? 'scene:${id.toInt()}' : 'scene:${id.toInt()}.${part.toInt()}';
  }

  /// Whether a node's material takes the frame's season.
  static bool _seasoned(Map<String, dynamic> node) {
    final paint = node['material'];
    if (paint is! Map) return false;
    return (paint['effects'] as List?)?.contains('season') == true;
  }

  RenderMesh? _mesh(Map<String, dynamic> node, String id, SeasonTint? season) {
    final attributes = Map<String, dynamic>.from(node['attributes'] as Map);
    List<double>? attribute(String name, int size) {
      final value = attributes[name];
      if (value == null) return null;
      final entry = Map<String, dynamic>.from(value as Map);
      if (entry['size'] != size) {
        throw FormatException('$name must have $size components');
      }
      return _numbers(entry['values']);
    }

    final positions = attribute('position', 3);
    if (positions == null) {
      throw const FormatException('Scene mesh has no positions');
    }
    final normals = attribute('normal', 3);
    final colours = attribute('color', 3);
    final flow = attribute('flow', 1);
    final sea = attribute('sea', 1);
    if (positions.length % 3 != 0 ||
        (normals != null && normals.length != positions.length) ||
        (colours != null && colours.length != positions.length) ||
        (flow != null && flow.length != positions.length ~/ 3) ||
        (sea != null && sea.length != positions.length ~/ 3)) {
      throw const FormatException(
        'Scene mesh attributes have different vertex counts',
      );
    }
    final count = positions.length ~/ 3;
    final rawIndices = node['indices'] == null
        ? List<int>.generate(count, (i) => i)
        : (node['indices'] as List)
              .map((value) => (value as num).toInt())
              .toList();
    if (rawIndices.length % 3 != 0 ||
        rawIndices.any((i) => i < 0 || i >= count)) {
      throw const FormatException('Scene mesh has invalid triangle indices');
    }
    final paint = Map<String, dynamic>.from(node['material'] as Map);
    final tint = linearFromHex((paint['colour'] as num?)?.toInt() ?? 0xffffff);
    final snow = season == null ? null : linearFromHex(season.snow);
    final material = paint['intent'] == 'water'
        ? RenderMesh.waterMaterial
        : (paint['effects'] as List?)?.any(
                (effect) => effect == 'cutaway' || effect == 'mountain-cutaway',
              ) ==
              true
        ? RenderMesh.cuttableMaterial
        : paint['intent'] == 'unlit' || paint['intent'] == 'points'
        ? RenderMesh.unlitMaterial
        : RenderMesh.terrainMaterial;
    final world = _numbers(node['world']);
    if (world.length != 16) {
      throw const FormatException('Scene node matrix must have 16 elements');
    }
    final matrices = node['kind'] == 'instances'
        ? _numbers(node['instanceMatrices'])
        : <double>[];
    if (matrices.length % 16 != 0) {
      throw const FormatException(
        'Instance matrices must have 16 elements each',
      );
    }
    final instanceCount = node['kind'] == 'instances'
        ? matrices.length ~/ 16
        : 1;
    final instanceColours = node['instanceColours'] == null
        ? null
        : _numbers(node['instanceColours']);
    if (instanceColours != null &&
        instanceColours.length != instanceCount * 3) {
      throw const FormatException('Instance colours have the wrong length');
    }
    if (instanceCount == 0 || rawIndices.isEmpty) return null;
    final vertices = Float32List(
      count * instanceCount * RenderMesh.floatsPerVertex,
    );
    final indices = Int32List(rawIndices.length * instanceCount);
    for (var instance = 0; instance < instanceCount; instance++) {
      final transform = node['kind'] == 'instances'
          ? _multiply(
              world,
              matrices.sublist(instance * 16, instance * 16 + 16),
            )
          : world;
      final normalTransform = _normalMatrix(transform);
      final shade = instanceColours == null
          ? const <double>[1, 1, 1]
          : instanceColours.sublist(instance * 3, instance * 3 + 3);
      for (var vertex = 0; vertex < count; vertex++) {
        final source = vertex * 3,
            target = (instance * count + vertex) * RenderMesh.floatsPerVertex;
        final x = positions[source],
            y = positions[source + 1],
            z = positions[source + 2];
        vertices[target] =
            transform[0] * x +
            transform[4] * y +
            transform[8] * z +
            transform[12];
        vertices[target + 1] =
            transform[1] * x +
            transform[5] * y +
            transform[9] * z +
            transform[13];
        vertices[target + 2] =
            transform[2] * x +
            transform[6] * y +
            transform[10] * z +
            transform[14];
        final nx = normals?[source] ?? 0,
            ny = normals?[source + 1] ?? 1,
            nz = normals?[source + 2] ?? 0;
        final normalX =
            normalTransform[0] * nx +
            normalTransform[3] * ny +
            normalTransform[6] * nz;
        final normalY =
            normalTransform[1] * nx +
            normalTransform[4] * ny +
            normalTransform[7] * nz;
        final normalZ =
            normalTransform[2] * nx +
            normalTransform[5] * ny +
            normalTransform[8] * nz;
        final length = math.sqrt(
          normalX * normalX + normalY * normalY + normalZ * normalZ,
        );
        final divisor = length == 0 ? 1 : length;
        vertices[target + 3] = normalX / divisor;
        vertices[target + 4] = normalY / divisor;
        vertices[target + 5] = normalZ / divisor;
        for (var channel = 0; channel < 3; channel++) {
          final colour =
              (paint['vertexColours'] == true
                  ? (colours?[source + channel] ?? 1.0)
                  : 1.0) *
              tint[channel] *
              shade[channel];
          vertices[target + 6 + channel] = season == null
              ? colour
              : season.apply(colour, channel, snow!);
        }
        vertices[target + 9] = material;
        vertices[target + 14] = flow?[vertex] ?? 0;
        vertices[target + 15] = sea?[vertex] ?? 0;
      }
      for (var index = 0; index < rawIndices.length; index++) {
        indices[instance * rawIndices.length + index] =
            rawIndices[index] + instance * count;
      }
    }
    return RenderMesh(
      id: id,
      vertices: vertices,
      indices: indices,
      castShadow: node['castShadow'] == true,
      receiveShadow: node['receiveShadow'] == true,
      opacity: (paint['opacity'] as num?)?.toDouble() ?? 1,
      emissive: (paint['emissive'] as num?)?.toInt() ?? 0,
      blend: (paint['effects'] as List?)?.contains('additive-blending') == true
          ? 'additive'
          : paint['transparent'] == true
          ? 'alpha'
          : 'opaque',
      depthWrite: paint['depthWrite'] != false,
      depthTest: paint['depthTest'] != false,
      doubleSided: paint['side'] == 'double',
      backSide: paint['side'] == 'back',
      renderOrder: (node['renderOrder'] as num?)?.toInt() ?? 0,
      transparent: paint['transparent'] == true,
    );
  }

  Map<String, dynamic> _expandPoints(Map<String, dynamic> node) {
    final attributes = Map<String, dynamic>.from(node['attributes'] as Map);
    final position = Map<String, dynamic>.from(attributes['position'] as Map);
    final source = _numbers(position['values']);
    if (source.length % 3 != 0) {
      throw const FormatException('Points have invalid positions');
    }
    final paint = Map<String, dynamic>.from(node['material'] as Map);
    final half = ((paint['size'] as num?)?.toDouble() ?? 1) / 2;
    final vertices = <double>[], indices = <int>[];
    for (var at = 0; at < source.length; at += 3) {
      final x = source[at], y = source[at + 1], z = source[at + 2];
      final base = vertices.length ~/ 3;
      vertices.addAll(<double>[
        x - half,
        y - half,
        z,
        x + half,
        y - half,
        z,
        x + half,
        y + half,
        z,
        x - half,
        y + half,
        z,
      ]);
      indices.addAll(<int>[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    return <String, dynamic>{
      ...node,
      'kind': 'mesh',
      'attributes': <String, dynamic>{
        'position': <String, dynamic>{'size': 3, 'values': vertices},
      },
      'indices': indices,
    };
  }
}

List<double> _numbers(Object? values) =>
    (values as List).map((value) => (value as num).toDouble()).toList();

List<double> _multiply(List<double> a, List<double> b) =>
    List<double>.generate(16, (index) {
      final row = index % 4, column = index ~/ 4;
      return List<double>.generate(
        4,
        (k) => a[k * 4 + row] * b[column * 4 + k],
      ).reduce((x, y) => x + y);
    });

/// Inverse transpose of a column-major affine transform's upper three rows.
List<double> _normalMatrix(List<double> m) {
  final a0 = m[0], a1 = m[1], a2 = m[2];
  final b0 = m[4], b1 = m[5], b2 = m[6];
  final c0 = m[8], c1 = m[9], c2 = m[10];
  final u0 = b1 * c2 - b2 * c1, u1 = b2 * c0 - b0 * c2, u2 = b0 * c1 - b1 * c0;
  final v0 = c1 * a2 - c2 * a1, v1 = c2 * a0 - c0 * a2, v2 = c0 * a1 - c1 * a0;
  final w0 = a1 * b2 - a2 * b1, w1 = a2 * b0 - a0 * b2, w2 = a0 * b1 - a1 * b0;
  final determinant = a0 * u0 + a1 * u1 + a2 * u2;
  if (determinant == 0) {
    throw const FormatException('Scene node transform is singular');
  }
  return <double>[
    u0,
    u1,
    u2,
    v0,
    v1,
    v2,
    w0,
    w1,
    w2,
  ].map((v) => v / determinant).toList();
}

import 'dart:math' as math;
import 'dart:typed_data';

import 'native_world_renderer.dart';
import 'render_mesh.dart';

/// Dart's consumer of the engine-owned FrameDescription in src/core/scene.ts.
/// The JSON form uses ordinary arrays for typed geometry buffers.
final class SceneFrame {
  SceneFrame.fromJson(Map<String, dynamic> json)
    : camera = Map<String, dynamic>.from(json['camera'] as Map),
      background = json['background'] as int?,
      coast = json['coast'] == null
          ? null
          : Map<String, dynamic>.from(json['coast'] as Map),
      cutaway = json['cutaway'] == null
          ? null
          : Map<String, dynamic>.from(json['cutaway'] as Map),
      fog = json['fog'] == null
          ? null
          : Map<String, dynamic>.from(json['fog'] as Map),
      nodes = (json['nodes'] as List)
          .map((node) => Map<String, dynamic>.from(node as Map))
          .toList();

  final Map<String, dynamic> camera;
  final int? background;
  final Map<String, dynamic>? coast;
  final Map<String, dynamic>? cutaway;
  final Map<String, dynamic>? fog;
  final List<Map<String, dynamic>> nodes;
}

/// Maps the same neutral frame submitted to WebGL and recording onto native buffers.
final class FlutterFramePipeline {
  FlutterFramePipeline(this.renderer);

  final NativeWorldRenderer renderer;
  final Set<String> _mounted = <String>{};

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
    for (var at = 0; at < frame.nodes.length; at++) {
      final node = frame.nodes[at];
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
      final id = 'scene:$at';
      final mesh = _mesh(kind == 'points' ? _expandPoints(node) : node, id);
      if (mesh == null) continue;
      next.add(id);
      await renderer.putMesh(mesh);
    }
    for (final old in _mounted.difference(next)) {
      await renderer.removeMesh(old);
    }
    _mounted
      ..clear()
      ..addAll(next);
  }

  RenderMesh? _mesh(Map<String, dynamic> node, String id) {
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
    if (positions.length % 3 != 0 ||
        (normals != null && normals.length != positions.length) ||
        (colours != null && colours.length != positions.length)) {
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
    final tint = _linear((paint['colour'] as num?)?.toInt() ?? 0xffffff);
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
          vertices[target + 6 + channel] =
              (paint['vertexColours'] == true
                  ? (colours?[source + channel] ?? 1)
                  : 1) *
              tint[channel] *
              shade[channel];
        }
        vertices[target + 9] = material;
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

List<double> _linear(int hex) => <double>[
  for (final value in <int>[(hex >> 16) & 255, (hex >> 8) & 255, hex & 255])
    value / 255 <= .04045
        ? value / 255 / 12.92
        : math.pow((value / 255 + .055) / 1.055, 2.4).toDouble(),
];

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

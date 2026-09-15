import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a streamed chunk and creature become native render buffers', () {
    final packet = _packet();
    final chunk = ChunkParcel.decode(packet);
    expect(chunk, isNotNull);
    expect((chunk!.cx, chunk.cz), (3, -2));

    final meshes = const ChunkMesher().build(chunk, seed: 72);
    expect(meshes.land, isNotNull);
    expect(meshes.water, isNotNull);
    expect(meshes.land!.vertices.length % RenderMesh.floatsPerVertex, 0);
    expect(meshes.land!.indices.every((i) => i >= 0 && i < meshes.land!.vertexCount), isTrue);

    final rig = CreatureRig.fromJson(
      'runner',
      jsonEncode({
        'from': 'quadruped',
        'with': {
          'body': [1.1, .5, .45], 'bodyY': .55, 'legH': .5, 'legW': .12,
          'head': [.35, .35, .32], 'headOffset': [.62, .7, 0],
          'bodyColor': '#8a5a35',
        },
        'parts': [
          {'cone': [.08, .3], 'at': [.75, 1.0, 0], 'color': '#e8d7ae', 'anim': 'head'},
        ],
      }),
    ).instantiate(instanceId: 'one', x: 8, y: 1, z: 8);
    expect(rig.vertexCount, greaterThan(100));
    expect(rig.indices.every((i) => i >= 0 && i < rig.vertexCount), isTrue);
    final joints = <int>{
      for (var i = 10; i < rig.vertices.length; i += RenderMesh.floatsPerVertex) rig.vertices[i].round(),
    };
    expect(joints, containsAll(<int>[RigJoint.legL.index, RigJoint.legR.index, RigJoint.head.index]));
  });

  test('wire corruption is refused rather than partially drawn', () {
    final packet = _packet();
    expect(ChunkParcel.decode(Uint8List.sublistView(packet, 0, packet.length - 1)), isNull);
    packet.buffer.asByteData().setInt32(0, 99, Endian.little);
    expect(ChunkParcel.decode(packet), isNull);
  });
  test('every repository creature model is accepted by the Flutter rig loader', () {
    final modelDir = Directory('../../models/creatures');
    final models = modelDir.listSync().whereType<File>().where((file) => file.path.endsWith('.json')).toList();
    expect(models, isNotEmpty);
    for (final model in models) {
      final id = model.uri.pathSegments.last.replaceAll('.json', '');
      final mesh = CreatureRig.fromJson(id, model.readAsStringSync()).instantiate(instanceId: 'smoke');
      expect(mesh.indices, isNotEmpty, reason: model.path);
    }
  });
  test(
    'the Flutter biped keeps both whites and both pupils on the head joint',
    () {
      final mesh = CreatureRig.fromJson(
        'person',
        jsonEncode({
          'from': 'biped',
          'with': {
            'skin': '#ffdab9',
            'hair': '#513b2c',
            'pantsColor': '#4a3a2a',
          },
        }),
      ).instantiate(instanceId: 'eyes');

      final headVertices = <List<double>>[];
      for (
        var at = 0;
        at < mesh.vertices.length;
        at += RenderMesh.floatsPerVertex
      ) {
        if (mesh.vertices[at + 10].round() == RigJoint.head.index) {
          headVertices.add(
            mesh.vertices.sublist(at, at + RenderMesh.floatsPerVertex),
          );
        }
      }
      // Four existing hair/head boxes prove this is inspecting the generated rig, not an empty fixture.
      expect(headVertices.length, greaterThanOrEqualTo(4 * 24));
      expect(headVertices.length, 8 * 24);
      expect(_verticesWithColour(headVertices, 0xf2efe6), hasLength(2 * 24));
      expect(_verticesWithColour(headVertices, 0x2a2230), hasLength(2 * 24));
      for (final vertex in headVertices) {
        expect(vertex.sublist(11, 14), closeToList(<double>[0, 1.2, 0]));
      }
    },
  );

  test(
    'an unpinned leg part swings from its top centre rather than its midpoint',
    () {
      final mesh = CreatureRig.fromJson(
        'leg',
        jsonEncode({
          'parts': [
            {
              'box': [1, 2, 1],
              'at': [2, 3, 4],
              'color': '#ffffff',
              'anim': 'legL',
            },
          ],
        }),
      ).instantiate(instanceId: 'pivot');

      expect(mesh.vertexCount, 24);
      for (
        var at = 0;
        at < mesh.vertices.length;
        at += RenderMesh.floatsPerVertex
      ) {
        expect(mesh.vertices[at + 10].round(), RigJoint.legL.index);
        expect(
          mesh.vertices.sublist(at + 11, at + 14),
          closeToList(<double>[2, 4, 4]),
        );
      }
    },
  );

  test('Android renderer failures are returned and dead-thread disposal is bounded', () {
    final source = File(
      'android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt',
    ).readAsStringSync();

    expect(source, contains('AtomicReference<Throwable?>'));
    expect(source, contains('try { releaseGl() } catch (cleanup: Throwable)'));
    expect(
      source,
      contains('ready.await(STARTUP_TIMEOUT_MS, TimeUnit.MILLISECONDS)'),
    );
    expect(
      source,
      matches(RegExp(r'failure\.get\(\)\?\.let \{[\s\S]*?throw it')),
    );
    expect(source, contains('thread.isAlive && handler.post'));
    expect(
      source,
      contains('done.await(DISPOSAL_TIMEOUT_MS, TimeUnit.MILLISECONDS)'),
    );
    expect(source, contains('if (!running) releaseGl()'));
  });
}

Matcher closeToList(List<double> expected) => predicate<List<double>>(
  (actual) =>
      actual.length == expected.length &&
      List.generate(
        actual.length,
        (index) => (actual[index] - expected[index]).abs(),
      ).every((difference) => difference < 0.00001),
  'is within 0.00001 of $expected',
);

List<List<double>> _verticesWithColour(
  List<List<double>> vertices,
  int colour,
) {
  final expected = _linear(colour);
  return vertices
      .where(
        (vertex) => List.generate(
          3,
          (index) => (vertex[index + 6] - expected[index]).abs(),
        ).every((difference) => difference < 0.00001),
      )
      .toList();
}

List<double> _linear(int hex) => <double>[
  for (final value in <int>[(hex >> 16) & 255, (hex >> 8) & 255, hex & 255])
    value / 255 <= .04045
        ? value / 255 / 12.92
        : pow((value / 255 + .055) / 1.055, 2.4).toDouble(),
];

Uint8List _packet() {
  const size = ChunkParcel.apronSize, tiles = size * size;
  const floats = tiles * 8;
  final bytes = Uint8List(20 + floats * 4 + tiles * 4);
  final data = bytes.buffer.asByteData();
  for (final (index, value) in <(int,int)>[(0,2),(1,3),(2,-2),(3,size),(4,0)]) {
    data.setInt32(index * 4, value, Endian.little);
  }
  var at = 20;
  for (var block = 0; block < 5; block++) {
    final length = block == 3 ? tiles * 4 : tiles;
    for (var i = 0; i < length; i++) {
      var value = 0.0;
      if (block == 0) value = 1;
      if (block == 3) value = 1;
      if (block == 4 && i == size + 2) value = .7;
      data.setFloat32(at, value, Endian.little);
      at += 4;
    }
  }
  for (var block = 0; block < 4; block++) {
    for (var i = 0; i < tiles; i++) {
      var value = 0;
      if (block == 0) value = TileType.ground.index;
      if (block == 0 && i == size + 2) value = TileType.water.index;
      bytes[at++] = value;
    }
  }
  return bytes;
}

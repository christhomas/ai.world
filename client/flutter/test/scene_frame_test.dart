import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a neutral game frame drives native camera, lights, coast, cutaway and geometry', () async {
    const channel = MethodChannel('world.ai/scene-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 7 : null;
        });
    final native = await NativeWorldRenderer.create(
      width: 320,
      height: 180,
      channel: channel,
    );
    final pipeline = FlutterFramePipeline(native);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    final frame = SceneFrame.fromJson(<String, dynamic>{
      'camera': <String, dynamic>{
        'orthographic': true,
        'projection': identity,
        'world': identity,
      },
      'background': 0x123456,
      'fog': null,
      'coast': <String, dynamic>{
        'x0': -2,
        'z0': 4,
        'span': 4,
        'size': 2,
        'values': <int>[0, 64, 128, 255],
      },
      'cutaway': <String, dynamic>{
        'enabled': true,
        'hero': <num>[2, 3, 4],
      },
      'nodes': <Map<String, dynamic>>[
        <String, dynamic>{
          'kind': 'ambient',
          'colour': 0xffffff,
          'intensity': 0.4,
          'visible': true,
        },
        <String, dynamic>{
          'kind': 'hemisphere',
          'colour': 0xabcdef,
          'groundColour': 0x102030,
          'intensity': 0.8,
          'visible': true,
        },
        <String, dynamic>{
          'kind': 'directional',
          'colour': 0xffffff,
          'intensity': 1.2,
          'visible': true,
          'world': identity,
          'target': <num>[0, 0, 0],
        },
        <String, dynamic>{
          'kind': 'point',
          'colour': 0xffa020,
          'intensity': 2,
          'distance': 8,
          'visible': true,
          'world': identity,
        },
        <String, dynamic>{
          'kind': 'mesh',
          'world': identity,
          'visible': true,
          'castShadow': true,
          'receiveShadow': true,
          'material': <String, dynamic>{
            'intent': 'water',
            'colour': 0xffffff,
            'opacity': 0.7,
            'transparent': true,
            'depthWrite': false,
            'side': 'double',
            'effects': <String>[],
          },
          'attributes': <String, dynamic>{
            'position': <String, dynamic>{
              'size': 3,
              'values': <num>[0, 0, 0, 1, 0, 0, 0, 0, 1],
            },
            'normal': <String, dynamic>{
              'size': 3,
              'values': <num>[0, 1, 0, 0, 1, 0, 0, 1, 0],
            },
            'color': <String, dynamic>{
              'size': 3,
              'values': <num>[1, 0, 0, 0, 1, 0, 0, 0, 1],
            },
            'sea': <String, dynamic>{
              'size': 1,
              'values': <num>[1, 1, 1],
            },
          },
          'indices': <int>[0, 1, 2],
        },
      ],
    });
    await pipeline.draw(frame);
    final scene =
        calls.singleWhere((call) => call.method == 'sceneFrame').arguments
            as Map;
    expect(scene['projection'], isA<Float32List>());
    expect(scene['background'], 0x123456);
    expect((scene['lights'] as List), hasLength(4));
    expect(((scene['coast'] as Map)['values'] as Uint8List).toList(), <int>[
      0,
      64,
      128,
      255,
    ]);
    final cutaway =
        calls.singleWhere((call) => call.method == 'cutaway').arguments as Map;
    expect(cutaway['heroX'], 2);
    final mesh =
        calls.singleWhere((call) => call.method == 'putMesh').arguments as Map;
    expect(mesh['castShadow'], true);
    expect(mesh['receiveShadow'], true);
    expect(mesh['opacity'], 0.7);
    expect(mesh['depthWrite'], false);
    expect(mesh['doubleSided'], true);
    expect(
      (mesh['vertices'] as Float32List).length,
      3 * RenderMesh.floatsPerVertex,
    );
    expect((mesh['indices'] as Int32List).toList(), <int>[0, 1, 2]);
    await pipeline.draw(
      SceneFrame.fromJson(<String, dynamic>{
        'camera': <String, dynamic>{
          'orthographic': true,
          'projection': identity,
          'world': identity,
        },
        'background': 0,
        'fog': null,
        'nodes': <dynamic>[],
      }),
    );
    expect(calls.where((call) => call.method == 'removeMesh'), hasLength(1));
    await native.dispose();
  });

  test('instance transforms, unlit intent, additive blend and points reach native buffers', () async {
    const channel = MethodChannel('world.ai/instance-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 8 : null;
        });
    final native = await NativeWorldRenderer.create(
      width: 320,
      height: 180,
      channel: channel,
    );
    final pipeline = FlutterFramePipeline(native);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const shifted = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    await pipeline.draw(
      SceneFrame.fromJson(<String, dynamic>{
        'camera': <String, dynamic>{
          'orthographic': true,
          'projection': identity,
          'world': identity,
        },
        'background': null,
        'fog': null,
        'nodes': <Map<String, dynamic>>[
          <String, dynamic>{
            'kind': 'instances',
            'world': identity,
            'visible': true,
            'castShadow': false,
            'receiveShadow': false,
            'instanceMatrices': shifted,
            'instanceColours': <num>[0.5, 1, 1],
            'material': <String, dynamic>{
              'intent': 'unlit',
              'colour': 0xffffff,
              'vertexColours': false,
              'opacity': 0.5,
              'transparent': true,
              'depthWrite': false,
              'side': 'front',
              'effects': <String>['additive-blending'],
            },
            'attributes': <String, dynamic>{
              'position': <String, dynamic>{
                'size': 3,
                'values': <num>[0, 0, 0, 1, 0, 0, 0, 1, 0],
              },
              'normal': <String, dynamic>{
                'size': 3,
                'values': <num>[0, 0, 1, 0, 0, 1, 0, 0, 1],
              },
            },
            'indices': <int>[0, 1, 2],
          },
          <String, dynamic>{
            'kind': 'points',
            'world': identity,
            'visible': true,
            'castShadow': false,
            'receiveShadow': false,
            'material': <String, dynamic>{
              'intent': 'points',
              'colour': 0xff0000,
              'size': 0.5,
              'opacity': 0.8,
              'transparent': true,
              'depthWrite': true,
              'side': 'front',
              'effects': <String>[],
            },
            'attributes': <String, dynamic>{
              'position': <String, dynamic>{
                'size': 3,
                'values': <num>[2, 3, 4],
              },
            },
          },
        ],
      }),
    );
    final meshes = calls
        .where((call) => call.method == 'putMesh')
        .map((call) => call.arguments as Map)
        .toList();
    expect(meshes, hasLength(2));
    final vertices = meshes[0]['vertices'] as Float32List;
    expect(vertices[0], 5);
    expect(vertices[6], 0.5);
    expect(vertices[9], RenderMesh.unlitMaterial);
    expect(meshes[0]['blend'], 'additive');
    expect(meshes[0]['castShadow'], false);
    expect((meshes[1]['indices'] as Int32List).length, 6);
    await native.dispose();
  });

  test('cached geometry avoids repeat uploads while style changes and water attributes reach native', () async {
    const channel = MethodChannel('world.ai/cache-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 9 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    final pipeline = FlutterFramePipeline(native);
    final cache = SceneGeometryCache();
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    Map<String, dynamic> packet({bool includeGeometry = false, bool castShadow = false}) => <String, dynamic>{
      'frame': <String, dynamic>{
        'camera': <String, dynamic>{'orthographic': true, 'projection': identity, 'world': identity},
        'nodes': <Map<String, dynamic>>[<String, dynamic>{
          'kind': 'mesh', 'geometryId': 'water-geometry', 'world': identity,
          'visible': true, 'castShadow': castShadow, 'receiveShadow': true,
          'renderOrder': 3,
          'material': <String, dynamic>{'intent': 'water', 'colour': 0xffffff,
            'opacity': 0.82, 'transparent': true, 'depthWrite': false, 'side': 'double'},
        }],
      },
      if (includeGeometry) 'geometries': <String, dynamic>{
        'water-geometry': <String, dynamic>{
          'attributes': <String, dynamic>{
            'position': <String, dynamic>{'size': 3, 'values': <num>[0, 0, 0, 1, 0, 0, 0, 0, 1]},
            'flow': <String, dynamic>{'size': 1, 'values': <num>[1, 1, 1]},
            'sea': <String, dynamic>{'size': 1, 'values': <num>[0, 1, 0]},
          },
          'indices': <int>[0, 1, 2],
        },
      },
    };
    await pipeline.draw(SceneFrame.fromJson(packet(includeGeometry: true), geometryCache: cache));
    await pipeline.draw(SceneFrame.fromJson(packet(), geometryCache: cache));
    var uploads = calls.where((call) => call.method == 'putMesh').toList();
    expect(uploads, hasLength(1));
    final first = uploads.single.arguments as Map;
    final vertices = first['vertices'] as Float32List;
    expect(vertices[14], 1);
    expect(vertices[15], 0);
    expect(vertices[RenderMesh.floatsPerVertex + 15], 1);
    expect(first['renderOrder'], 3);
    expect(first['transparent'], true);
    await pipeline.draw(SceneFrame.fromJson(packet(castShadow: true), geometryCache: cache));
    uploads = calls.where((call) => call.method == 'putMesh').toList();
    expect(uploads, hasLength(2));
    expect((uploads.last.arguments as Map)['castShadow'], true);
    await native.dispose();
  });

  /*
   * Every test above draws a frame somebody wrote. This one draws a frame the game wrote.
   *
   * `test/fixtures/interior_frame.json` is the general store in Crossroads Town, seed 3, as
   * `chore playtest-record` recorded it with nothing drawn and packed it through
   * `server/flutter-packet.ts` — the bytes the Flutter feed would send a new client, before gzip.
   * It came out of a hosted CI run's `record-only` artifact rather than an editor, so when the
   * engine's description and this parser disagree, this is where it shows. Retake it the same way.
   */
  test('a frame the game really recorded draws natively, and a second draw uploads nothing', () async {
    const channel = MethodChannel('world.ai/recorded-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 10 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    final pipeline = FlutterFramePipeline(native);
    final cache = SceneGeometryCache();
    final packet = jsonDecode(File('test/fixtures/interior_frame.json').readAsStringSync())
        as Map<String, dynamic>;
    final recorded = packet['frame'] as Map<String, dynamic>;
    final lights = (recorded['nodes'] as List)
        .where((node) => const <String>{'ambient', 'hemisphere', 'directional', 'point'}
            .contains((node as Map)['kind']))
        .length;

    await pipeline.draw(SceneFrame.fromJson(packet, geometryCache: cache));
    final scene = calls.singleWhere((call) => call.method == 'sceneFrame').arguments as Map;
    expect(scene['background'], recorded['background']);
    expect(scene['lights'] as List, hasLength(lights));
    expect((scene['projection'] as Float32List).length, 16);
    expect(calls.where((call) => call.method == 'cutaway'), hasLength(1));

    final uploads = calls
        .where((call) => call.method == 'putMesh')
        .map((call) => call.arguments as Map)
        .toList();
    // A room: its shell as meshes and its furniture as instanced props, a couple of dozen in all.
    expect(uploads.length, greaterThan(10));
    final materials = <double>{};
    for (final mesh in uploads) {
      final vertices = mesh['vertices'] as Float32List;
      final indices = mesh['indices'] as Int32List;
      expect(vertices.length % RenderMesh.floatsPerVertex, 0);
      final count = vertices.length ~/ RenderMesh.floatsPerVertex;
      expect(indices.length % 3, 0);
      expect(indices.every((i) => i >= 0 && i < count), isTrue, reason: '${mesh['meshId']}');
      expect(vertices.every((v) => v.isFinite), isTrue, reason: '${mesh['meshId']}');
      for (var at = 9; at < vertices.length; at += RenderMesh.floatsPerVertex) {
        materials.add(vertices[at]);
      }
    }
    expect(materials, containsAll(<double>[RenderMesh.terrainMaterial, RenderMesh.cuttableMaterial]));

    // The same frame again, geometry by digest alone: what the feed sends a client that has it.
    calls.clear();
    await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{'frame': recorded}, geometryCache: cache));
    expect(calls.where((call) => call.method == 'putMesh'), isEmpty);
    expect(calls.where((call) => call.method == 'removeMesh'), isEmpty);
    await native.dispose();
  });
}

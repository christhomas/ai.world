import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('baked reflections keep triangle fronts aligned with their normals', () async {
    const channel = MethodChannel('world.ai/mirrored-triangles');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 71 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    final pipeline = FlutterFramePipeline(native);
    List<double> scale(double x) => <double>[x, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1];
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    final cases = <Map<String, dynamic>>[
      {'world': scale(2), 'expected': <int>[0, 1, 2]},
      {'world': scale(-2), 'expected': <int>[0, 2, 1]},
      {'world': identity, 'instances': <double>[...identity, ...scale(-2)], 'expected': <int>[0, 1, 2, 3, 5, 4]},
      {'world': scale(-2), 'instances': scale(-2), 'expected': <int>[0, 1, 2]},
    ];
    for (var i = 0; i < cases.length; i++) {
      calls.clear();
      final data = cases[i];
      await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{
        'camera': {'orthographic': true, 'projection': identity, 'world': identity},
        'nodes': <Map<String, dynamic>>[{
          'id': i, 'kind': data.containsKey('instances') ? 'instances' : 'mesh',
          'world': data['world'],
          if (data.containsKey('instances')) 'instanceMatrices': data['instances'],
          'material': {'intent': 'lit', 'colour': 0xffffff, 'side': 'front'},
          'attributes': {
            'position': {'size': 3, 'values': <num>[0, 0, 0, 1, 0, 0, 0, 1, 0]},
            'normal': {'size': 3, 'values': <num>[0, 0, 1, 0, 0, 1, 0, 0, 1]},
          },
          'indices': <int>[0, 1, 2],
        }],
      }));
      final mesh = calls.singleWhere((call) => call.method == 'putMesh').arguments as Map;
      final indices = mesh['indices'] as Int32List;
      final vertices = mesh['vertices'] as Float32List;
      expect(indices.toList(), data['expected'], reason: 'transform case $i');
      expect(mesh['doubleSided'], false);
      // A real submitted triangle's geometric normal must point with its lighting normal.
      for (var face = 0; face < indices.length; face += 3) {
        final a = indices[face] * RenderMesh.floatsPerVertex;
        final b = indices[face + 1] * RenderMesh.floatsPerVertex;
        final c = indices[face + 2] * RenderMesh.floatsPerVertex;
        final ab = List<double>.generate(3, (k) => vertices[b + k] - vertices[a + k]);
        final ac = List<double>.generate(3, (k) => vertices[c + k] - vertices[a + k]);
        final cross = <double>[ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        final alignment = List<double>.generate(3, (k) => cross[k] * vertices[a + 3 + k]).reduce((x, y) => x + y);
        expect(alignment, greaterThan(0), reason: 'transform case $i, triangle $face');
      }
    }
    await native.dispose();
  });

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
          'id': 5,
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

  /*
   * three.js takes every authored hex as sRGB and lights in linear (#499): `Color.setHex` decodes,
   * `WebGLLights` multiplies by intensity, and a frame's `linearColour` is used before its clamped
   * hex (`bindLightMount`). The bridges only shade, so this is where all of that is decided for them.
   */
  test('lights and emissive reach the native bridges linear, as three.js lights them', () async {
    const channel = MethodChannel('world.ai/light-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 9 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    await FlutterFramePipeline(native).draw(SceneFrame.fromJson(<String, dynamic>{
      'camera': <String, dynamic>{'orthographic': true, 'projection': identity, 'world': identity},
      'background': 0x123456,
      'fog': null,
      'nodes': <Map<String, dynamic>>[
        <String, dynamic>{'kind': 'ambient', 'colour': 0x808080, 'intensity': 0.5, 'visible': true},
        // the autumn sun's case: a computed colour warmer than its hex can say
        <String, dynamic>{
          'kind': 'hemisphere', 'colour': 0xffe0a0, 'linearColour': <num>[1.3, 0.8, 0.35],
          'groundColour': 0x402010, 'intensity': 2, 'visible': true,
        },
        <String, dynamic>{
          'kind': 'directional', 'colour': 0xffa020, 'intensity': 3, 'visible': true,
          'world': identity, 'target': <num>[0, 0, 0],
        },
        <String, dynamic>{
          'kind': 'point', 'colour': 0xffffff, 'intensity': 14, 'distance': 9, 'decay': 1.4,
          'visible': true, 'world': identity,
        },
        <String, dynamic>{
          'kind': 'point', 'colour': 0xffffff, 'intensity': 1, 'distance': 0,
          'visible': true, 'world': identity,
        },
        <String, dynamic>{
          'id': 6,
          'kind': 'mesh',
          'world': identity,
          'visible': true,
          'castShadow': false,
          'receiveShadow': false,
          'material': <String, dynamic>{
            'intent': 'lit', 'colour': 0x808080, 'emissive': 0xff8040, 'opacity': 1,
            'transparent': false, 'depthWrite': true, 'side': 'front', 'effects': <String>[],
          },
          'attributes': <String, dynamic>{
            'position': <String, dynamic>{'size': 3, 'values': <num>[0, 0, 0, 1, 0, 0, 0, 0, 1]},
          },
          'indices': <int>[0, 1, 2],
        },
      ],
    }));
    final scene = calls.singleWhere((call) => call.method == 'sceneFrame').arguments as Map;
    final lights = (scene['lights'] as List).cast<Map>();
    List<double> channels(Object? values) => (values as List).cast<num>().map((v) => v.toDouble()).toList();
    final grey = _linear(0x80);
    expect(grey, closeTo(0.2158605, 1e-6));

    // a hex is sRGB, decoded before the intensity scales it
    expect(channels(lights[0]['linear']), closeToList(<double>[grey * .5, grey * .5, grey * .5]));
    // the unclamped channels win over the hex, and the ground's hex is decoded like any other
    expect(channels(lights[1]['linear']), closeToList(<double>[2.6, 1.6, 0.7]));
    expect(channels(lights[1]['linearGround']),
        closeToList(<double>[_linear(0x40) * 2, _linear(0x20) * 2, _linear(0x10) * 2]));
    expect(channels(lights[2]['linear']),
        closeToList(<double>[3, _linear(0xa0) * 3, _linear(0x20) * 3]));
    // point lights carry their decay, and one without takes three.js's default of two
    expect(channels(lights[3]['linear']), closeToList(<double>[14, 14, 14]));
    expect(lights[3]['decay'], 1.4);
    expect(lights[3]['distance'], 9);
    expect(lights[4]['decay'], 2);
    expect(lights[4]['distance'], 0);

    // emissive is added to linear light in three.js, so it leaves Dart decoded too
    final mesh = calls.singleWhere((call) => call.method == 'putMesh').arguments as Map;
    expect(channels(mesh['emissive']), closeToList(<double>[1, _linear(0x80), _linear(0x40)]));
    // and the mesh's own colour is decoded by the same sum, not a second copy of it
    final vertices = mesh['vertices'] as Float32List;
    expect(vertices.sublist(6, 9), closeToList(<double>[grey, grey, grey]));
    expect(linearFromHex(0xff8040), closeToList(<double>[1, _linear(0x80), _linear(0x40)]));
    await native.dispose();
  });

  /*
   * three.js adds up every light of each kind (#512), so each bridge sums what it is sent and needs
   * to be sent all of it: a second ambient, hemisphere or directional light, and a hidden one too,
   * since hiding is the bridges' to honour. Nothing is merged, dropped or reordered on the way.
   */
  test('every light in a frame reaches the native bridges, however many of a kind there are', () async {
    const channel = MethodChannel('world.ai/every-light-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 11 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    List<double> at(double x, double y, double z) =>
        <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
    final nodes = <Map<String, dynamic>>[
      <String, dynamic>{'id': 1, 'kind': 'ambient', 'colour': 0xffffff, 'intensity': 0.25, 'visible': true},
      <String, dynamic>{'id': 2, 'kind': 'ambient', 'colour': 0x808080, 'intensity': 2, 'visible': true},
      <String, dynamic>{
        'id': 3, 'kind': 'hemisphere', 'colour': 0xffffff, 'groundColour': 0x000000,
        'intensity': 1, 'visible': true,
      },
      <String, dynamic>{
        'id': 4, 'kind': 'hemisphere', 'colour': 0x808080, 'groundColour': 0xffffff,
        'intensity': 0.5, 'visible': true,
      },
      <String, dynamic>{
        'id': 5, 'kind': 'directional', 'colour': 0xffffff, 'intensity': 2.6, 'visible': true,
        'castShadow': true, 'world': at(38, 72, 22), 'target': <num>[0, 0, 0],
      },
      <String, dynamic>{
        'id': 6, 'kind': 'directional', 'colour': 0x808080, 'intensity': 1, 'visible': true,
        'castShadow': false, 'world': at(-10, 5, 0), 'target': <num>[0, 0, 0],
      },
      <String, dynamic>{
        'id': 7, 'kind': 'directional', 'colour': 0xffffff, 'intensity': 9, 'visible': false,
        'castShadow': false, 'world': at(0, 10, 0), 'target': <num>[0, 0, 0],
      },
      <String, dynamic>{
        'id': 8, 'kind': 'point', 'colour': 0xffb060, 'intensity': 3, 'distance': 9, 'decay': 1.6,
        'visible': true, 'world': at(1, 2, 3),
      },
      <String, dynamic>{
        'id': 9, 'kind': 'point', 'colour': 0xffffff, 'intensity': 0, 'visible': true, 'world': identity,
      },
    ];
    await FlutterFramePipeline(native).draw(SceneFrame.fromJson(<String, dynamic>{
      'camera': <String, dynamic>{'orthographic': true, 'projection': identity, 'world': identity},
      'background': 0,
      'fog': null,
      'nodes': nodes,
    }));
    final lights = ((calls.singleWhere((call) => call.method == 'sceneFrame').arguments as Map)['lights'] as List)
        .cast<Map>();
    List<double> channels(Object? values) => (values as List).cast<num>().map((v) => v.toDouble()).toList();

    // every one of them, in the frame's order, carrying what it came with
    expect(lights.map((light) => light['id']), <int>[1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(lights.map((light) => light['kind']).where((kind) => kind == 'directional'), hasLength(3));
    for (final (index, light) in lights.indexed) {
      for (final key in nodes[index].keys) {
        expect(light[key], nodes[index][key], reason: '${light['id']} $key');
      }
    }
    // and each with its own radiance, for the bridge to add to the others of its kind
    final grey = _linear(0x80);
    expect(channels(lights[0]['linear']), closeToList(<double>[.25, .25, .25]));
    expect(channels(lights[1]['linear']), closeToList(<double>[grey * 2, grey * 2, grey * 2]));
    expect(channels(lights[2]['linear']), closeToList(<double>[1, 1, 1]));
    expect(channels(lights[2]['linearGround']), closeToList(<double>[0, 0, 0]));
    expect(channels(lights[3]['linear']), closeToList(<double>[grey * .5, grey * .5, grey * .5]));
    expect(channels(lights[3]['linearGround']), closeToList(<double>[.5, .5, .5]));
    expect(channels(lights[4]['linear']), closeToList(<double>[2.6, 2.6, 2.6]));
    expect(channels(lights[5]['linear']), closeToList(<double>[grey, grey, grey]));
    expect(channels(lights[6]['linear']), closeToList(<double>[9, 9, 9]));
    expect(channels(lights[7]['linear']),
        closeToList(<double>[3, _linear(0xb0) * 3, _linear(0x60) * 3]));
    expect(channels(lights[8]['linear']), closeToList(<double>[0, 0, 0]));
    // a directional light keeps what the bridge needs to point it and to decide its shadow
    expect(lights[4]['castShadow'], isTrue);
    expect(lights[5]['castShadow'], isFalse);
    // no mesh came with the lights, so none was uploaded
    expect(calls.where((call) => call.method == 'putMesh'), isEmpty);
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
            'id': 1,
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
            'id': 2,
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
          'id': 3, 'kind': 'mesh', 'geometryId': 'water-geometry', 'world': identity,
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

  test('the season a frame carries colours only what names it, and a new season re-uploads only that', () async {
    const channel = MethodChannel('world.ai/season-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 11 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    final pipeline = FlutterFramePipeline(native);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    Map<String, dynamic> ground(int id, List<String> effects) => <String, dynamic>{
      'id': id, 'kind': 'mesh', 'world': identity, 'visible': true, 'castShadow': true, 'receiveShadow': true,
      'material': <String, dynamic>{'intent': 'lit', 'colour': 0xffffff, 'vertexColours': true,
        'opacity': 1, 'transparent': false, 'depthWrite': true, 'side': 'front', 'effects': effects},
      'attributes': <String, dynamic>{
        'position': <String, dynamic>{'size': 3, 'values': <num>[0, 0, 0, 1, 0, 0, 0, 0, 1]},
        'normal': <String, dynamic>{'size': 3, 'values': <num>[0, 1, 0, 0, 1, 0, 0, 1, 0]},
        'color': <String, dynamic>{'size': 3, 'values': <num>[0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25, 1]},
      },
      'indices': <int>[0, 1, 2],
    };
    SceneFrame frame(Map<String, dynamic>? season) => SceneFrame.fromJson(<String, dynamic>{
      'camera': <String, dynamic>{'orthographic': true, 'projection': identity, 'world': identity},
      'background': 0,
      'fog': null,
      'season': season,
      // the country's ground, which the season reaches, and something it does not
      'nodes': <Map<String, dynamic>>[ground(7, <String>['season']), ground(8, <String>[])],
    });
    List<double> colour(MethodCall upload) {
      final vertices = (upload.arguments as Map)['vertices'] as Float32List;
      return <double>[vertices[6], vertices[7], vertices[8]];
    }

    // winter, as `seasonLook` says it: mix(colour * multiply, snow, frost), snow taken to linear
    const winter = <String, dynamic>{'multiply': <num>[0.88, 0.94, 1.06], 'frost': 0.5, 'snow': 0xf2f6ff};
    await pipeline.draw(frame(winter));
    var uploads = calls.where((call) => call.method == 'putMesh').toList();
    expect(uploads, hasLength(2));
    final snow = <double>[_linear(0xf2), _linear(0xf6), _linear(0xff)];
    const multiply = <double>[0.88, 0.94, 1.06], source = <double>[0.5, 0.25, 1];
    for (var channel = 0; channel < 3; channel++) {
      expect(colour(uploads[0])[channel],
          closeTo(source[channel] * multiply[channel] * 0.5 + snow[channel] * 0.5, 1e-6));
      expect(colour(uploads[1])[channel], closeTo(source[channel], 1e-6));
    }

    // the season turning is a new upload of the ground and nothing else
    calls.clear();
    const autumn = <String, dynamic>{'multiply': <num>[1.35, 0.82, 0.42], 'frost': 0, 'snow': 0xf2f6ff};
    await pipeline.draw(frame(autumn));
    uploads = calls.where((call) => call.method == 'putMesh').toList();
    expect(uploads, hasLength(1));
    expect((uploads.single.arguments as Map)['meshId'], 'scene:7');
    for (var channel = 0; channel < 3; channel++) {
      expect(colour(uploads.single)[channel], closeTo(source[channel] * <double>[1.35, 0.82, 0.42][channel], 1e-6));
    }

    // and no season is the ground untinted
    calls.clear();
    await pipeline.draw(frame(null));
    uploads = calls.where((call) => call.method == 'putMesh').toList();
    expect(uploads, hasLength(1));
    for (var channel = 0; channel < 3; channel++) {
      expect(colour(uploads.single)[channel], closeTo(source[channel], 1e-6));
    }
    await native.dispose();
  });

  test('a node leaving the middle of the frame leaves every mesh after it where it was', () async {
    const channel = MethodChannel('world.ai/stable-id-test');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'create' ? 12 : null;
        });
    final native = await NativeWorldRenderer.create(width: 320, height: 180, channel: channel);
    final pipeline = FlutterFramePipeline(native);
    const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // three chunks of ground and a prop batch's body and glow, each named as SceneGraph names them
    Map<String, dynamic> piece(int id, num x, {int? part}) => <String, dynamic>{
      'id': id, 'part': ?part, 'kind': 'mesh', 'world': identity, 'visible': true,
      'castShadow': false, 'receiveShadow': true,
      'material': <String, dynamic>{'intent': 'lit', 'colour': 0xffffff, 'opacity': 1,
        'transparent': false, 'depthWrite': true, 'side': 'front', 'effects': <String>[]},
      'attributes': <String, dynamic>{
        'position': <String, dynamic>{'size': 3, 'values': <num>[x, 0, 0, x + 1, 0, 0, x, 0, 1]},
      },
      'indices': <int>[0, 1, 2],
    };
    SceneFrame frame(List<Map<String, dynamic>> nodes) => SceneFrame.fromJson(<String, dynamic>{
      'camera': <String, dynamic>{'orthographic': true, 'projection': identity, 'world': identity},
      'nodes': <Object?>[
        <String, dynamic>{'id': 40, 'kind': 'ambient', 'colour': 0xffffff, 'intensity': 1, 'visible': true},
        ...nodes,
      ],
    });
    final chunks = <Map<String, dynamic>>[
      piece(41, 0), piece(42, 2), piece(43, 4), piece(44, 6, part: 0), piece(44, 8, part: 1),
    ];
    await pipeline.draw(frame(chunks));
    final first = calls.where((call) => call.method == 'putMesh').map((call) => (call.arguments as Map)['meshId']).toList();
    // five meshes, five names, the batch's two pieces apart
    expect(first.toSet(), hasLength(5));

    // the second chunk unloads
    calls.clear();
    await pipeline.draw(frame(<Map<String, dynamic>>[chunks[0], ...chunks.skip(2)]));
    expect(calls.where((call) => call.method == 'putMesh'), isEmpty);
    expect(calls.where((call) => call.method == 'removeMesh').map((call) => (call.arguments as Map)['meshId']),
        <Object?>[first[1]]);

    // and a node without its name is refused, not keyed by where it happens to stand
    await expectLater(
      pipeline.draw(frame(<Map<String, dynamic>>[<String, dynamic>{...chunks[0]}..remove('id')])),
      throwsFormatException,
    );
    await native.dispose();
  });

  /*
   * Every test above draws a frame somebody wrote. This one draws a frame the game wrote.
   *
   * `test/fixtures/interior_frame.json` is the general store in Crossroads Town, seed 3, as
   * `chore playtest-record` recorded it with nothing drawn and packed it through
   * `server/flutter-packet.ts` — the bytes the Flutter feed would send a new client, before gzip.
   * It came out of a hosted CI run's `record-only` artifact rather than an editor, so when the
   * engine's description and this parser disagree, this is where it shows. Retake it the same way;
   * this one is from Checks run 36657253479, the first to record every node's own id.
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

    // Every node the game recorded has a name of its own.
    expect((recorded['nodes'] as List).every((node) => (node as Map)['id'] is num), isTrue);
    final names = <String>[for (final node in recorded['nodes'] as List) _meshName(node as Map)];
    expect(names.toSet(), hasLength(names.length));

    // One drawn piece from the middle goes, as a chunk unloading would: the rest stay as they are.
    final uploaded = uploads.map((mesh) => mesh['meshId']).toSet();
    final drawn = <int>[
      for (final (at, node) in (recorded['nodes'] as List).indexed)
        if (uploaded.contains(_meshName(node as Map))) at,
    ];
    expect(drawn, hasLength(uploads.length));
    final middle = drawn[drawn.length ~/ 2];
    calls.clear();
    await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{
      'frame': <String, dynamic>{
        ...recorded,
        'nodes': <Object?>[
          for (final (at, node) in (recorded['nodes'] as List).indexed)
            if (at != middle) node,
        ],
      },
    }, geometryCache: cache));
    expect(calls.where((call) => call.method == 'putMesh'), isEmpty);
    expect(calls.where((call) => call.method == 'removeMesh'), hasLength(1));
    // and coming back is the one upload
    calls.clear();
    await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{'frame': recorded}, geometryCache: cache));
    expect(calls.where((call) => call.method == 'putMesh'), hasLength(1));
    expect(calls.where((call) => call.method == 'removeMesh'), isEmpty);
    calls.clear();

    // A season reaches only what names it: the props' cuttable bodies, recorded under a spring
    // sky. Taking the season away puts back up exactly those, untinted.
    final seasoned = <String>{
      for (final node in recorded['nodes'] as List)
        if (((node as Map)['material'] as Map?)?['effects'] case final List effects
            when effects.contains('season'))
          _meshName(node),
    };
    expect(recorded['season'], isNotNull);
    expect(seasoned, isNotEmpty);
    await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{
      'frame': <String, dynamic>{...recorded, 'season': null},
    }, geometryCache: cache));
    final untinted = <Object?, List<double>>{
      for (final call in calls.where((call) => call.method == 'putMesh'))
        (call.arguments as Map)['meshId']: ((call.arguments as Map)['vertices'] as Float32List).toList(),
    };
    expect(untinted.keys.toSet(), seasoned);
    calls.clear();
    await pipeline.draw(SceneFrame.fromJson(<String, dynamic>{
      'frame': <String, dynamic>{
        ...recorded,
        'season': <String, dynamic>{'multiply': <num>[0.88, 0.94, 1.06], 'frost': 0.5, 'snow': 0xf2f6ff},
      },
    }, geometryCache: cache));
    final tinted = calls.where((call) => call.method == 'putMesh').map((call) => call.arguments as Map).toList();
    expect(tinted.map((mesh) => mesh['meshId']).toSet(), untinted.keys.toSet());
    final snowRed = _linear(0xf2);
    for (final mesh in tinted) {
      final before = untinted[mesh['meshId']]!;
      final after = mesh['vertices'] as Float32List;
      expect(after.length, before.length);
      var moved = 0.0, wrong = 0.0;
      for (var at = 0; at < after.length; at += RenderMesh.floatsPerVertex) {
        // where it is and what it is made of stay; its colour is winter's
        moved = math.max(moved, (after[at] - before[at]).abs() + (after[at + 9] - before[at + 9]).abs());
        wrong = math.max(wrong, (after[at + 6] - (before[at + 6] * 0.88 * 0.5 + snowRed * 0.5)).abs());
      }
      expect(moved, 0, reason: '${mesh['meshId']}');
      expect(wrong, lessThan(1e-5), reason: '${mesh['meshId']}');
    }
    expect(calls.where((call) => call.method == 'removeMesh'), isEmpty);
    await native.dispose();
  });
}

/// What `FlutterFramePipeline` names a node's native mesh.
String _meshName(Map<dynamic, dynamic> node) =>
    'scene:${node['id']}${node['part'] == null ? '' : '.${node['part']}'}';

/// One sRGB channel as linear light, the way both renderers take an authored hex.
double _linear(int channel) {
  final c = channel / 255;
  return c <= .04045 ? c / 12.92 : math.pow((c + .055) / 1.055, 2.4).toDouble();
}

Matcher closeToList(List<double> expected) => predicate<List<double>>(
  (actual) =>
      actual.length == expected.length &&
      List.generate(actual.length, (index) => (actual[index] - expected[index]).abs())
          .every((difference) => difference < 0.00001),
  'is within 0.00001 of $expected',
);

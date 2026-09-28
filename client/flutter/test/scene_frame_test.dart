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
}
